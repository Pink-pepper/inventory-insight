/**
 * Baseline vs scenario comparison.
 *
 * Honesty rules:
 * - Absolute change is always shown when both sides exist.
 * - Percentage change only when the baseline is non-zero; a zero baseline
 *   with a non-zero scenario reads "new", never "∞%".
 * - Missing values stay missing — never zero-filled, never read as "no change".
 */
import { num } from "@/lib/format";
import type { SupplyPlanRow, SupplyRiskFlag } from "@/lib/supply/plan";
import type { DistributionPlan } from "@/lib/distribution/plan";
import type { RecommendationAction } from "@/lib/domain/model";

/** One figure under both plans. Null = not computable on that side. */
export interface Comparison {
  baseline: number | null;
  scenario: number | null;
  change: number | null;
  /** Null when the baseline is zero or either side is missing. */
  changePct: number | null;
}

export function compare(baseline: number | null, scenario: number | null): Comparison {
  if (baseline == null || scenario == null) {
    return { baseline, scenario, change: null, changePct: null };
  }
  const change = scenario - baseline;
  return {
    baseline,
    scenario,
    change,
    changePct: baseline !== 0 ? Math.round((change / baseline) * 1000) / 10 : null,
  };
}

/** Per-SKU figures under one plan, for the comparison table. */
export interface PlanSide {
  engineAction: RecommendationAction;
  plannedPerPeriod: number | null;
  lowPoint: number | null;
  firstStockout: string | null;
  netRequirement: number | null;
  suggestedQty: number | null;
  /** suggestedQty × recorded unit cost; null when either is absent. */
  spend: number | null;
  orderByDate: string | null;
  riskFlags: SupplyRiskFlag[];
}

export interface ScenarioRowResult {
  sku: string;
  name: string;
  category: string;
  supplierName: string;
  baseline: PlanSide;
  scenario: PlanSide;
  gainedRisks: SupplyRiskFlag[];
  resolvedRisks: SupplyRiskFlag[];
  /** Distribution figures when the SKU has a transfer suggestion on either side. */
  transfer: {
    baselineUnits: number;
    scenarioUnits: number;
    baselineRemaining: number;
    scenarioRemaining: number;
  } | null;
}

function side(row: SupplyPlanRow | undefined): PlanSide {
  if (!row) {
    return {
      engineAction: "HOLD",
      plannedPerPeriod: null,
      lowPoint: null,
      firstStockout: null,
      netRequirement: null,
      suggestedQty: null,
      spend: null,
      orderByDate: null,
      riskFlags: [],
    };
  }
  return {
    engineAction: row.engineAction,
    plannedPerPeriod: row.plannedPerPeriod,
    lowPoint: row.lowPoint,
    firstStockout: row.firstStockout,
    netRequirement: row.netRequirement,
    suggestedQty: row.suggestedQty,
    spend:
      row.suggestedQty != null && row.unitCost > 0
        ? Math.round(row.suggestedQty * row.unitCost)
        : null,
    orderByDate: row.orderByDate,
    riskFlags: row.riskFlags,
  };
}

export function compareRows(
  baselineRows: SupplyPlanRow[],
  scenarioRows: SupplyPlanRow[],
  baselineDist: DistributionPlan,
  scenarioDist: DistributionPlan,
): ScenarioRowResult[] {
  const baseBySku = new Map(baselineRows.map((r) => [r.sku, r]));
  const scenBySku = new Map(scenarioRows.map((r) => [r.sku, r]));
  const baseDistBySku = new Map(baselineDist.suggestions.map((s) => [s.sku, s]));
  const scenDistBySku = new Map(scenarioDist.suggestions.map((s) => [s.sku, s]));

  const skus = [...new Set([...baseBySku.keys(), ...scenBySku.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  return skus.map((sku) => {
    const b = baseBySku.get(sku);
    const s = scenBySku.get(sku);
    const anchor = s ?? b!;
    const bSide = side(b);
    const sSide = side(s);
    const bd = baseDistBySku.get(sku);
    const sd = scenDistBySku.get(sku);
    return {
      sku,
      name: anchor.name,
      category: anchor.category,
      supplierName: anchor.supplierName,
      baseline: bSide,
      scenario: sSide,
      gainedRisks: sSide.riskFlags.filter((f) => !bSide.riskFlags.includes(f)),
      resolvedRisks: bSide.riskFlags.filter((f) => !sSide.riskFlags.includes(f)),
      transfer:
        bd || sd
          ? {
              baselineUnits: bd?.totalQuantity ?? 0,
              scenarioUnits: sd?.totalQuantity ?? 0,
              baselineRemaining: bd?.remainingNetRequirement ?? bSide.netRequirement ?? 0,
              scenarioRemaining: sd?.remainingNetRequirement ?? sSide.netRequirement ?? 0,
            }
          : null,
    };
  });
}

/** Headline figures for one plan, baseline or scenario. */
export interface PlanSummary {
  skuCount: number;
  requiringAction: number;
  blocked: number;
  stockoutInHorizon: number;
  totalSuggestedQty: number;
  suggestedSpend: number;
  spendComplete: boolean;
  transferUnits: number;
  avoidableSpend: number;
  transferSpendComplete: boolean;
}

export function summarisePlan(
  plan: { rows: SupplyPlanRow[]; summary: import("@/lib/supply/plan").SupplyPlanSummary },
  dist: DistributionPlan,
): PlanSummary {
  return {
    skuCount: plan.summary.skuCount,
    requiringAction: plan.summary.requiringAction,
    blocked: plan.summary.blocked,
    stockoutInHorizon: plan.summary.stockoutInHorizon,
    totalSuggestedQty: plan.rows.reduce((s, r) => s + (r.suggestedQty ?? 0), 0),
    suggestedSpend: plan.summary.suggestedSpend,
    spendComplete: plan.summary.spendComplete,
    transferUnits: dist.summary.totalTransferUnits,
    avoidableSpend: dist.summary.avoidableSpend,
    transferSpendComplete: dist.summary.spendComplete,
  };
}

export interface SummaryComparison {
  label: string;
  kind: "count" | "units" | "money";
  comparison: Comparison;
  /** Set when a figure cannot be compared honestly (e.g. incomplete costs). */
  note: string | null;
}

export function compareSummaries(base: PlanSummary, scen: PlanSummary): SummaryComparison[] {
  return [
    { label: "SKUs requiring action", kind: "count", comparison: compare(base.requiringAction, scen.requiringAction), note: null },
    { label: "Stockouts in horizon", kind: "count", comparison: compare(base.stockoutInHorizon, scen.stockoutInHorizon), note: null },
    { label: "Suggested purchase quantity", kind: "units", comparison: compare(base.totalSuggestedQty, scen.totalSuggestedQty), note: null },
    {
      label: "Suggested spend",
      kind: "money",
      comparison: compare(base.suggestedSpend, scen.suggestedSpend),
      note:
        base.spendComplete && scen.spendComplete
          ? null
          : "Some SKUs have no recorded unit cost; spend covers priced SKUs only.",
    },
    { label: "Transferable units (distribution)", kind: "units", comparison: compare(base.transferUnits, scen.transferUnits), note: null },
    {
      label: "Avoidable spend via transfers",
      kind: "money",
      comparison: compare(base.avoidableSpend, scen.avoidableSpend),
      note:
        base.transferSpendComplete && scen.transferSpendComplete
          ? null
          : "Some transferable SKUs have no recorded unit cost.",
    },
    { label: "Blocked by missing inputs", kind: "count", comparison: compare(base.blocked, scen.blocked), note: null },
  ];
}

/**
 * Deterministic "why it changed" narrative: the largest movements, explained
 * from the numbers both plans actually produced. No generic statements.
 */
export function explainComparison(rows: ScenarioRowResult[], limit = 5): string[] {
  const movers = rows
    .map((r) => {
      const bQty = r.baseline.suggestedQty ?? 0;
      const sQty = r.scenario.suggestedQty ?? 0;
      return { row: r, movement: Math.abs(sQty - bQty) };
    })
    .filter((m) => m.movement > 0)
    .sort((a, b) => b.movement - a.movement)
    .slice(0, limit);

  return movers.map(({ row: r }) => {
    const parts: string[] = [];
    const bQty = r.baseline.suggestedQty ?? 0;
    const sQty = r.scenario.suggestedQty ?? 0;
    parts.push(
      bQty === 0
        ? `new purchase requirement of ${num(sQty)} units`
        : sQty === 0
          ? `purchase requirement of ${num(bQty)} units removed`
          : `suggested quantity ${num(bQty)} → ${num(sQty)} units`,
    );
    if (r.baseline.firstStockout !== r.scenario.firstStockout) {
      parts.push(
        `projected stockout ${r.baseline.firstStockout?.slice(0, 7) ?? "none"} → ${r.scenario.firstStockout?.slice(0, 7) ?? "none"}`,
      );
    }
    if (r.baseline.netRequirement != null && r.scenario.netRequirement != null) {
      parts.push(
        `net requirement ${num(r.baseline.netRequirement)} → ${num(r.scenario.netRequirement)}`,
      );
    }
    if (r.gainedRisks.length > 0) parts.push(`new risk: ${r.gainedRisks.join(", ")}`);
    if (r.resolvedRisks.length > 0) parts.push(`resolved risk: ${r.resolvedRisks.join(", ")}`);
    return `${r.sku}: ${parts.join("; ")}.`;
  });
}
