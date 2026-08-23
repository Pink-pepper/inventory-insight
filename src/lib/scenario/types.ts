/**
 * Scenario domain records — the shapes the UI consumes. Storage rows are
 * mapped into these at the repository boundary; the UI never sees raw columns.
 */
import type { PlanningFilter } from "@/lib/query/filters";
import type { ScenarioAssumptions } from "./assumptions";
import type { ScenarioRunResult } from "./run";

export type ScenarioStatus = "draft" | "active" | "archived";

export interface ScenarioRecord {
  id: string;
  name: string;
  description: string | null;
  status: ScenarioStatus;
  /** The scope the run applies, validated against the shared filter spec. */
  scope: PlanningFilter;
  assumptions: ScenarioAssumptions;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Latest run version, when the scenario has been run at least once. */
  latestVersion: number | null;
  latestRunAt: string | null;
}

/** A run's identity plus its headline figures, for history listings. */
export interface ScenarioRunSummaryRecord {
  id: string;
  scenarioId: string;
  version: number;
  baselineSummary: ScenarioRunResult["baselineSummary"];
  scenarioSummary: ScenarioRunResult["scenarioSummary"];
  createdBy: string;
  createdAt: string;
}

/** The full immutable snapshot of one run. */
export interface ScenarioRunRecord extends ScenarioRunSummaryRecord {
  assumptions: ScenarioAssumptions;
  scope: PlanningFilter;
  result: ScenarioRunResult;
  /** What the run read, so its numbers stay explainable later. */
  inputProvenance: {
    factCount: number;
    skuCount: number;
    openPoCount: number;
    lastRecommendationRunAt: string | null;
    executedAt: string;
  };
}
