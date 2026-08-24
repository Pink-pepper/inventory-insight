/**
 * Supply plan assembly.
 *
 * Answers three questions per SKU, using only numbers that already exist:
 * what supply is required (the shortfall of the projected position against
 * the engine's target stock), when it is required (the first period the
 * projection crosses the reorder point), and what could prevent fulfilment
 * (missing lead times, unscheduled inbound, MOQ effects, excess elsewhere).
 *
 * Pure composition: demand baseline from src/lib/demand, stock targets from
 * the existing engine output, receipts from open purchase orders. No writes,
 * no Supabase, no React.
 */
import type { OpenSupplyLine, RecommendationRow } from "@/lib/data/repository";
import type { InventoryPosition, LeadTimeSource, RecommendationAction } from "@/lib/domain/model";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import { DEFAULT_ENGINE_CONFIG, resolveEngineConfig } from "@/lib/engine/inventory-engine";
import { buildSeries, type DemandFact } from "@/lib/demand/series";
import { computeBaseline } from "@/lib/demand/baseline";
import { filterFactsByAttributes } from "@/lib/demand/plan";
import { applyPlanningFilter, withinRange, type PlanningFilter } from "@/lib/query/filters";
import { explainSupplyRow, type SupplyExplanation } from "./explain";
import { computeNetRequirement } from "./netting";
import { futureMonthStarts, projectPosition, type ProjectionPoint } from "./projection";

export type SupplyRiskFlag =
  | "stockout_before_receipt"
  | "lead_time_missing"
  | "eta_unknown"
  | "moq_over_order"
  | "excess_suppressed"
  | "no_demand_baseline";

export interface ExcessLocation {
  location: string;
  onHand: number;
  /** Days of cover at the SKU's average daily demand; null when demand is zero. */
  coverDays: number | null;
}

export interface SupplyPlanRow {
  sku: string;
  name: string;
  category: string;
  supplierName: string;
  supplierCode: string;
  leadTimeDays: number | null;
  leadTimeSource: LeadTimeSource;
  minOrderQty: number;
  unitCost: number;
  onHand: number;
  /** Per-location stock positions, for distribution analysis and detail views. */
  locations: InventoryPosition[];
  avgDailyDemand: number;
  safetyStockDays: number;
  /** Aggregate on-order from inventory positions, as recorded. */
  onOrder: number;
  /** Outstanding PO quantity with an expected date, phased into the projection. */
  scheduledInbound: number;
  /** Inbound quantity without any usable ETA (undated POs plus the unaccounted on-order remainder). */
  unscheduledOnOrder: number;
  earliestEta: string | null;
  plannedPerPeriod: number | null;
  horizonPeriods: number;
  projection: ProjectionPoint[] | null;
  lowPoint: number | null;
  firstStockout: string | null;
  firstBelowSafety: string | null;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  engineAction: RecommendationAction;
  blocked: boolean;
  netRequirement: number | null;
  suggestedQty: number | null;
  requiredByPeriod: string | null;
  orderByDate: string | null;
  riskFlags: SupplyRiskFlag[];
  excessLocations: ExcessLocation[];
  explanation: SupplyExplanation;
}

export interface SupplyPlanSummary {
  skuCount: number;
  requiringAction: number;
  blocked: number;
  stockoutInHorizon: number;
  /** Σ suggestedQty × recorded unit cost, over rows needing action. */
  suggestedSpend: number;
  /** False when at least one action row has no recorded unit cost. */
  spendComplete: boolean;
  noOpenPos: boolean;
  horizonStart: string | null;
  horizonPeriods: number;
  excessLocationOpportunities: number;
}

export interface SupplyPlanInput {
  facts: DemandFact[];
  engineRows: RecommendationRow[];
  openSupply: OpenSupplyLine[];
  policy: PlanningPolicy;
  filter: PlanningFilter;
}

/** First day of the month after the given bucket-start date. */
function monthAfter(periodStart: string): string {
  const d = new Date(`${periodStart.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildSupplyPlan({ facts, engineRows, openSupply, policy, filter }: SupplyPlanInput) {
  const cfg = resolveEngineConfig(policy);
  const horizonPeriods = Math.max(1, Math.min(12, Math.ceil(cfg.reviewPeriodDays / cfg.daysPerMonth)));

  const scopedFacts = filterFactsByAttributes(facts, filter).filter((f) => withinRange(f.date, filter));
  const scopedRows = applyPlanningFilter(
    engineRows.map((r) => ({ ...r, locationCodes: r.locations.map((l) => l.location) })),
    filter,
  );

  // One shared projection timeline so every row's "when" is comparable.
  const lastPeriod = buildSeries(scopedFacts, "month").coverage.lastPeriod;
  const horizonStart = lastPeriod ? monthAfter(lastPeriod) : null;
  const periods = horizonStart ? futureMonthStarts(horizonStart, horizonPeriods) : [];

  const supplyBySku = new Map<string, OpenSupplyLine[]>();
  for (const line of openSupply) {
    const list = supplyBySku.get(line.sku) ?? [];
    list.push(line);
    supplyBySku.set(line.sku, list);
  }

  const rows: SupplyPlanRow[] = scopedRows.map((row) => {
    const series = buildSeries(
      scopedFacts.filter((f) => f.sku === row.sku),
      "month",
    );
    const baseline = computeBaseline(series.buckets, series.coverage, {
      demandWindowMonths: policy.demandWindowMonths ?? DEFAULT_ENGINE_CONFIG.demandWindowMonths,
      planningHorizonDays: policy.planningHorizonDays ?? cfg.reviewPeriodDays,
      demandGrowthPct: policy.demandGrowthPct,
    });
    const planned = baseline.plannedPerPeriod;

    const lines = supplyBySku.get(row.sku) ?? [];
    const scheduled = lines.filter((l) => l.expectedAt != null);
    const scheduledInbound = scheduled.reduce((s, l) => s + l.outstanding, 0);
    const undatedPo = lines.filter((l) => l.expectedAt == null).reduce((s, l) => s + l.outstanding, 0);
    const totalOutstanding = scheduledInbound + undatedPo;
    // Convention: the recorded on-order aggregate is assumed to include any
    // imported purchase orders. Only the unaccounted remainder, plus undated
    // PO lines, is reported as unscheduled — never double counted.
    const unscheduledOnOrder = Math.max(0, row.onOrder - totalOutstanding) + undatedPo;
    const earliestEta = scheduled.map((l) => l.expectedAt!).sort()[0] ?? null;

    let projection: ProjectionPoint[] | null = null;
    let lowPoint: number | null = null;
    let firstStockout: string | null = null;
    let firstBelowSafety: string | null = null;
    let firstReceiptPeriod: string | null = null;
    let triggerPeriod: string | null = null;
    if (planned != null && periods.length > 0) {
      const proj = projectPosition({
        onHand: row.onHand,
        plannedPerPeriod: planned,
        periods,
        receipts: scheduled.map((l) => ({ expectedAt: l.expectedAt!, quantity: l.outstanding })),
        safetyStock: row.safetyStock,
        reorderPoint: row.reorderPoint,
      });
      projection = proj.points;
      lowPoint = proj.lowPoint;
      firstStockout = proj.firstStockout;
      firstBelowSafety = proj.firstBelowSafety;
      firstReceiptPeriod = proj.firstReceiptPeriod;
      triggerPeriod = proj.firstBelowReorder ?? proj.firstStockout;
    }

    const canNet = !row.blocked && projection != null && lowPoint != null;
    const net = canNet
      ? computeNetRequirement({
          targetStock: row.targetStock,
          lowPoint: lowPoint!,
          triggerPeriod,
          leadTimeDays: row.leadTimeDays,
          minOrderQty: row.minOrderQty,
          orderMultiple: cfg.orderMultiple,
        })
      : null;
    const netRequirement = net?.netRequirement ?? null;
    const suggestedQty = net ? (net.netRequirement > 0 ? net.suggestedQty : 0) : null;

    const riskFlags: SupplyRiskFlag[] = [];
    if (planned == null) riskFlags.push("no_demand_baseline");
    if (row.leadTimeDays == null) riskFlags.push("lead_time_missing");
    if (unscheduledOnOrder > 0) riskFlags.push("eta_unknown");
    if (firstStockout && (firstReceiptPeriod == null || firstReceiptPeriod > firstStockout)) {
      riskFlags.push("stockout_before_receipt");
    }
    if (net?.moqApplied) riskFlags.push("moq_over_order");
    // EXCESS suppresses immediate replenishment only while the projection
    // stays sufficient — a future shortfall still nets out above.
    if (row.action === "EXCESS" && netRequirement === 0) riskFlags.push("excess_suppressed");

    // Procurement avoidance: locations holding far more than their own cover
    // while the aggregate position needs replenishment.
    const excessLocations: ExcessLocation[] = [];
    if ((netRequirement ?? 0) > 0 && row.locations.length > 1) {
      const safetyDays =
        row.avgDailyDemand > 0 ? row.safetyStock / row.avgDailyDemand : row.safetyStockDays;
      const thresholdDays = (row.leadTimeDays ?? 0) + safetyDays + cfg.excessCoverThresholdDays;
      for (const loc of row.locations) {
        if (loc.onHand <= 0) continue;
        const coverDays = row.avgDailyDemand > 0 ? loc.onHand / row.avgDailyDemand : null;
        if (coverDays == null || coverDays > thresholdDays) {
          excessLocations.push({
            location: loc.location,
            onHand: loc.onHand,
            coverDays: coverDays == null ? null : Math.round(coverDays),
          });
        }
      }
    }

    const explanation = explainSupplyRow({
      onHand: row.onHand,
      scheduledInbound,
      unscheduledOnOrder,
      earliestEta,
      plannedPerPeriod: planned,
      horizonPeriods,
      safetyStock: row.safetyStock,
      reorderPoint: row.reorderPoint,
      targetStock: row.targetStock,
      lowPoint,
      netRequirement,
      suggestedQty,
      requiredByPeriod: net?.requiredByPeriod ?? null,
      orderByDate: net?.orderByDate ?? null,
      minOrderQty: row.minOrderQty,
      leadTimeDays: row.leadTimeDays,
      riskFlags,
      excessLocationCount: excessLocations.length,
    });

    return {
      sku: row.sku,
      name: row.name,
      category: row.category,
      supplierName: row.supplierName,
      supplierCode: row.supplierCode,
      leadTimeDays: row.leadTimeDays,
      leadTimeSource: row.leadTimeSource,
      minOrderQty: row.minOrderQty,
      unitCost: row.unitCost,
      onHand: row.onHand,
      locations: row.locations,
      avgDailyDemand: row.avgDailyDemand,
      safetyStockDays: row.safetyStockDays,
      onOrder: row.onOrder,
      scheduledInbound,
      unscheduledOnOrder,
      earliestEta,
      plannedPerPeriod: planned,
      horizonPeriods,
      projection,
      lowPoint,
      firstStockout,
      firstBelowSafety,
      safetyStock: row.safetyStock,
      reorderPoint: row.reorderPoint,
      targetStock: row.targetStock,
      engineAction: row.action,
      blocked: row.blocked,
      netRequirement,
      suggestedQty,
      requiredByPeriod: net?.requiredByPeriod ?? null,
      orderByDate: net?.orderByDate ?? null,
      riskFlags,
      excessLocations,
      explanation,
    };
  });

  rows.sort((a, b) => {
    const aAct = (a.suggestedQty ?? 0) > 0 ? 0 : 1;
    const bAct = (b.suggestedQty ?? 0) > 0 ? 0 : 1;
    if (aAct !== bAct) return aAct - bAct;
    if (aAct === 0) return (b.suggestedQty ?? 0) - (a.suggestedQty ?? 0);
    const aStock = a.firstStockout ?? "9999";
    const bStock = b.firstStockout ?? "9999";
    if (aStock !== bStock) return aStock.localeCompare(bStock);
    return a.sku.localeCompare(b.sku);
  });

  const actionRows = rows.filter((r) => (r.suggestedQty ?? 0) > 0);
  const summary: SupplyPlanSummary = {
    skuCount: rows.length,
    requiringAction: actionRows.length,
    blocked: rows.filter((r) => r.blocked).length,
    stockoutInHorizon: rows.filter((r) => r.firstStockout != null).length,
    suggestedSpend: Math.round(
      actionRows.reduce((s, r) => s + (r.suggestedQty ?? 0) * r.unitCost, 0),
    ),
    spendComplete: actionRows.every((r) => r.unitCost > 0),
    noOpenPos: openSupply.length === 0,
    horizonStart,
    horizonPeriods,
    excessLocationOpportunities: rows.reduce((s, r) => s + r.excessLocations.length, 0),
  };

  return { rows, summary };
}

export type SupplyPlan = ReturnType<typeof buildSupplyPlan>;
