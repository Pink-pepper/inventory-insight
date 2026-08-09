/**
 * Inventory decision engine.
 *
 * Transparent, rule-based logic. No AI, no hard-coded outcomes, no UI imports.
 * Every tunable lives in ENGINE_CONFIG so the policy can be changed in one place.
 */
import type { RecommendationAction, SkuSignal } from "@/lib/domain/model";

export const ENGINE_CONFIG = {
  /** Months of history used for the demand average. */
  demandWindowMonths: 6,
  /** Days in an average month. */
  daysPerMonth: 30.44,
  /** Purchasing review cycle — how much forward demand a single order should cover. */
  reviewPeriodDays: 30,
  /** Buffer above the reorder point that triggers WATCH instead of HOLD. */
  watchBufferRatio: 1.25,
  /** Cover beyond (lead time + safety) that counts as excess inventory. */
  excessCoverThresholdDays: 90,
  /** Cover above which a SKU is flagged at stockout risk. */
  stockoutRiskCoverDays: 0,
} as const;

export interface SkuMetrics {
  avgMonthlyDemand: number;
  avgDailyDemand: number;
  demandTrendPct: number;
  daysOfCover: number;
  safetyStock: number;
  reorderPoint: number;
  netAvailable: number;
  targetStock: number;
  excessUnits: number;
  inventoryValue: number;
  excessValue: number;
}

export interface SkuRecommendation extends SkuMetrics {
  sku: string;
  action: RecommendationAction;
  recommendedQty: number;
  estimatedCost: number;
  reason: string;
  stockoutRisk: boolean;
}

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function averageMonthlyDemand(
  monthlySales: SkuSignal["monthlySales"],
  windowMonths = ENGINE_CONFIG.demandWindowMonths,
): number {
  if (monthlySales.length === 0) return 0;
  const sorted = [...monthlySales].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  const window = sorted.slice(-windowMonths);
  const total = window.reduce((sum, m) => sum + m.quantity, 0);
  return total / window.length;
}

/** Percentage change of the recent window vs the preceding window. */
export function demandTrendPct(monthlySales: SkuSignal["monthlySales"]): number {
  const sorted = [...monthlySales].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  const w = ENGINE_CONFIG.demandWindowMonths / 2;
  const recent = sorted.slice(-w);
  const prior = sorted.slice(-w * 2, -w);
  if (recent.length === 0 || prior.length === 0) return 0;
  const avg = (a: typeof recent) => a.reduce((s, m) => s + m.quantity, 0) / a.length;
  const base = avg(prior);
  if (base === 0) return 0;
  return ((avg(recent) - base) / base) * 100;
}

export function computeMetrics(signal: SkuSignal): SkuMetrics {
  const avgMonthly = averageMonthlyDemand(signal.monthlySales);
  const avgDaily = avgMonthly / ENGINE_CONFIG.daysPerMonth;
  const netAvailable = signal.onHand + signal.onOrder;
  const daysOfCover = avgDaily > 0 ? signal.onHand / avgDaily : signal.onHand > 0 ? Infinity : 0;
  const safetyStock = avgDaily * signal.safetyStockDays;
  const reorderPoint = avgDaily * signal.leadTimeDays + safetyStock;
  const targetStock =
    avgDaily * (signal.leadTimeDays + ENGINE_CONFIG.reviewPeriodDays + signal.safetyStockDays);
  const excessThreshold =
    avgDaily *
    (signal.leadTimeDays + signal.safetyStockDays + ENGINE_CONFIG.excessCoverThresholdDays);
  const excessUnits = Math.max(0, netAvailable - excessThreshold);
  const inventoryValue = signal.onHand * signal.unitCost;

  return {
    avgMonthlyDemand: round(avgMonthly, 1),
    avgDailyDemand: round(avgDaily, 3),
    demandTrendPct: round(demandTrendPct(signal.monthlySales), 1),
    daysOfCover: Number.isFinite(daysOfCover) ? round(daysOfCover, 1) : 9999,
    safetyStock: Math.ceil(safetyStock),
    reorderPoint: Math.ceil(reorderPoint),
    netAvailable,
    targetStock: Math.ceil(targetStock),
    excessUnits: Math.round(excessUnits),
    inventoryValue: round(inventoryValue),
    excessValue: round(excessUnits * signal.unitCost),
  };
}

/** Rounds an order quantity up to respect the supplier MOQ. */
export function applyMoq(rawQty: number, moq: number): number {
  if (rawQty <= 0) return 0;
  const unit = Math.max(1, moq);
  return Math.ceil(rawQty / unit) * unit;
}

export function classify(signal: SkuSignal, m: SkuMetrics): RecommendationAction {
  if (m.avgDailyDemand <= 0) {
    return signal.onHand > 0 ? "EXCESS" : "HOLD";
  }
  if (m.netAvailable <= m.reorderPoint) return "REORDER";
  if (m.excessUnits > 0) return "EXCESS";
  if (m.netAvailable <= m.reorderPoint * ENGINE_CONFIG.watchBufferRatio) return "WATCH";
  return "HOLD";
}

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function explain(
  signal: SkuSignal,
  m: SkuMetrics,
  action: RecommendationAction,
  qty: number,
): string {
  const cover = m.daysOfCover >= 9999 ? "no measurable demand" : `${Math.round(m.daysOfCover)} days of cover`;
  const moqNote =
    qty > 0 && qty > Math.max(0, m.targetStock - m.netAvailable)
      ? ` The recommended quantity is rounded up to respect the supplier minimum order quantity of ${signal.minOrderQty} units.`
      : qty > 0
        ? ` The recommended quantity respects the supplier MOQ of ${signal.minOrderQty} units.`
        : "";

  switch (action) {
    case "REORDER":
      return (
        `Reorder ${qty} units. Current stock provides approximately ${Math.round(m.daysOfCover)} days of cover ` +
        `while supplier lead time is ${signal.leadTimeDays} days. Average demand is ${m.avgMonthlyDemand} units per month, ` +
        `so the reorder point of ${m.reorderPoint} units (lead-time demand plus a ${signal.safetyStockDays}-day safety buffer of ` +
        `${m.safetyStock} units) has been reached with ${m.netAvailable} units available including stock on order. ` +
        `Without action the system estimates a stockout before the next replenishment arrives. ` +
        `Ordering to the target position of ${m.targetStock} units costs approximately ${money(qty * signal.unitCost)}.` +
        moqNote
      );
    case "WATCH":
      return (
        `Monitor this SKU. ${m.netAvailable} units available give ${cover}, which is still above the reorder point of ` +
        `${m.reorderPoint} units but within ${Math.round((ENGINE_CONFIG.watchBufferRatio - 1) * 100)}% of it. ` +
        `At the current run rate of ${m.avgMonthlyDemand} units per month and a ${signal.leadTimeDays}-day lead time, ` +
        `this SKU is expected to hit its reorder point shortly. No purchase is required today.`
      );
    case "EXCESS":
      if (m.avgDailyDemand <= 0) {
        return (
          `Hold and review. There has been no recorded demand in the last ${ENGINE_CONFIG.demandWindowMonths} months, ` +
          `yet ${signal.onHand} units remain on hand tying up ${money(m.inventoryValue)} of working capital. ` +
          `Consider discontinuation, promotion or return to supplier rather than replenishment.`
        );
      }
      return (
        `Do not reorder. ${m.netAvailable} units available provide ${cover} against a ${signal.leadTimeDays}-day lead time and a ` +
        `${signal.safetyStockDays}-day safety buffer. Approximately ${m.excessUnits} units are surplus to the ` +
        `${ENGINE_CONFIG.excessCoverThresholdDays}-day forward requirement, representing about ${money(m.excessValue)} of ` +
        `excess working capital. Redeploy, promote or run this stock down before purchasing again.`
      );
    default:
      return (
        `No action required. ${m.netAvailable} units available give ${cover}, comfortably above the reorder point of ` +
        `${m.reorderPoint} units for a ${signal.leadTimeDays}-day lead time at ${m.avgMonthlyDemand} units per month of demand. ` +
        `The next review will re-evaluate as demand changes.`
      );
  }
}

export function evaluateSku(signal: SkuSignal): SkuRecommendation {
  const metrics = computeMetrics(signal);
  const action = classify(signal, metrics);
  const rawQty = action === "REORDER" ? Math.max(0, metrics.targetStock - metrics.netAvailable) : 0;
  const recommendedQty = applyMoq(rawQty, signal.minOrderQty);
  const estimatedCost = round(recommendedQty * signal.unitCost);
  const stockoutRisk =
    metrics.avgDailyDemand > 0 && metrics.daysOfCover < signal.leadTimeDays;

  return {
    ...metrics,
    sku: signal.sku,
    action,
    recommendedQty,
    estimatedCost,
    stockoutRisk,
    reason: explain(signal, metrics, action, recommendedQty),
  };
}

export function evaluateAll(signals: SkuSignal[]): SkuRecommendation[] {
  return signals.map(evaluateSku);
}