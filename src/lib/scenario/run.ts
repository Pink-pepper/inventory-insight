/**
 * Scenario execution.
 *
 * One run = the existing planning chain executed twice over the SAME loaded
 * facts: once with the live policy and recorded inputs (baseline — identical
 * to what the Supply and Distribution workspaces show), once with the
 * scenario's transformed copies. The engines are never edited and never
 * duplicated; scenario configuration flows in through their existing
 * arguments.
 *
 * Strictly read-only: nothing here persists anything. The caller (server
 * function) stores the returned snapshot into scenario_runs — the only table
 * a scenario run is allowed to write.
 */
import type { LoadedSku, OpenSupplyLine } from "@/lib/data/repository";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import { evaluateAll, resolveEngineConfig } from "@/lib/engine/inventory-engine";
import type { DemandFact } from "@/lib/demand/series";
import { buildSupplyPlan, type SupplyPlan } from "@/lib/supply/plan";
import { buildDistributionPlan, type DistributionPlan } from "@/lib/distribution/plan";
import type { PlanningFilter } from "@/lib/query/filters";
import {
  applyScenarioOpenSupply,
  applyScenarioPolicy,
  applyScenarioSignals,
} from "./apply";
import { describeAssumptions, type ScenarioAssumptions } from "./assumptions";
import {
  compareRows,
  compareSummaries,
  explainComparison,
  summarisePlan,
  type PlanSummary,
  type ScenarioRowResult,
  type SummaryComparison,
} from "./compare";

/** Per-SKU row results are capped so a run snapshot stays bounded. */
export const RUN_ROW_CAP = 2000;

export interface ScenarioRunInput {
  facts: DemandFact[];
  signals: LoadedSku[];
  openSupply: OpenSupplyLine[];
  /** The organisation's effective live policy (defaults when unconfigured). */
  policy: PlanningPolicy;
  /** Scenario scope — applied identically to both passes. */
  filter: PlanningFilter;
  assumptions: ScenarioAssumptions;
}

export interface ScenarioRunResult {
  assumptionLines: string[];
  baselineSummary: PlanSummary;
  scenarioSummary: PlanSummary;
  summaryComparison: SummaryComparison[];
  rows: ScenarioRowResult[];
  /** True when row results exceeded RUN_ROW_CAP and were truncated. */
  rowsTruncated: boolean;
  explanation: string[];
  horizonStart: string | null;
  horizonPeriods: number;
}

/** Mirrors buildRecommendationView's join: engine output + the signal it ran on. */
function evaluateJoined(signals: LoadedSku[], policy: PlanningPolicy) {
  const results = evaluateAll(signals, resolveEngineConfig(policy));
  const bySku = new Map(signals.map((s) => [s.sku, s]));
  return results.map((r) => ({ ...r, ...bySku.get(r.sku)! }));
}

export function executeScenario({
  facts,
  signals,
  openSupply,
  policy,
  filter,
  assumptions,
}: ScenarioRunInput): ScenarioRunResult {
  // Baseline pass: untouched inputs, live policy. Identical to the live pages.
  const baselineRows = evaluateJoined(signals, policy);
  const baselinePlan: SupplyPlan = buildSupplyPlan({
    facts,
    engineRows: baselineRows,
    openSupply,
    policy,
    filter,
  });
  const baselineDist: DistributionPlan = buildDistributionPlan({
    supplyRows: baselinePlan.rows,
    facts,
    openSupply,
    policy,
    filter,
  });

  // Scenario pass: transformed copies; the live objects are unchanged.
  const scenarioPolicy = applyScenarioPolicy(policy, assumptions);
  const scenarioSignals = applyScenarioSignals(signals, assumptions);
  const scenarioSupply = applyScenarioOpenSupply(openSupply, assumptions);
  const scenarioRows = evaluateJoined(scenarioSignals, scenarioPolicy);
  const scenarioPlan: SupplyPlan = buildSupplyPlan({
    facts,
    engineRows: scenarioRows,
    openSupply: scenarioSupply,
    policy: scenarioPolicy,
    filter,
  });
  const scenarioDist: DistributionPlan = buildDistributionPlan({
    supplyRows: scenarioPlan.rows,
    facts,
    openSupply: scenarioSupply,
    policy: scenarioPolicy,
    filter,
  });

  const allRows = compareRows(baselinePlan.rows, scenarioPlan.rows, baselineDist, scenarioDist);
  const rowsTruncated = allRows.length > RUN_ROW_CAP;
  // When truncating, keep the rows that moved — a truncated snapshot must
  // still show the scenario's effect, not an arbitrary prefix.
  const rows = rowsTruncated
    ? [...allRows]
        .sort(
          (a, b) =>
            Math.abs((b.scenario.suggestedQty ?? 0) - (b.baseline.suggestedQty ?? 0)) -
            Math.abs((a.scenario.suggestedQty ?? 0) - (a.baseline.suggestedQty ?? 0)),
        )
        .slice(0, RUN_ROW_CAP)
    : allRows;

  const baselineSummary = summarisePlan(baselinePlan, baselineDist);
  const scenarioSummary = summarisePlan(scenarioPlan, scenarioDist);

  return {
    assumptionLines: describeAssumptions(assumptions, policy),
    baselineSummary,
    scenarioSummary,
    summaryComparison: compareSummaries(baselineSummary, scenarioSummary),
    rows,
    rowsTruncated,
    explanation: explainComparison(allRows),
    horizonStart: scenarioPlan.summary.horizonStart,
    horizonPeriods: scenarioPlan.summary.horizonPeriods,
  };
}
