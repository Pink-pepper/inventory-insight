/**
 * Business plan.
 *
 * An annual revenue and gross-profit target, plus contribution lines by
 * supplier, product or customer. The same lines are used whether the operator
 * works bottom-up (seed from the Demand Book and landed economics, then
 * adjust) or top-down (allocate a target by share, then reconcile). The
 * reconciliation gap between the lines and the targets is always visible.
 */

export type PlanDirection = "bottom_up" | "top_down";

export type PlanLineSource = "manual" | "demand_book" | "allocation";

export interface BusinessPlanLine {
  id: string;
  planId: string;
  supplierId: string | null;
  supplierName: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  customerId: string | null;
  customerName: string | null;
  label: string | null;
  expectedQuantity: number;
  expectedRevenue: number;
  expectedGrossProfit: number;
  source: PlanLineSource;
  notes: string | null;
}

export interface BusinessPlanRecord {
  id: string;
  name: string;
  planYear: number;
  direction: PlanDirection;
  revenueTarget: number;
  grossProfitTarget: number;
  currencyCode: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lines: BusinessPlanLine[];
}

export const lineMargin = (l: BusinessPlanLine): number | null =>
  l.expectedRevenue > 0 ? (l.expectedGrossProfit / l.expectedRevenue) * 100 : null;

export interface PlanReconciliation {
  plannedRevenue: number;
  plannedGrossProfit: number;
  revenueGap: number;
  grossProfitGap: number;
  revenueCoveragePct: number | null;
  grossProfitCoveragePct: number | null;
  marginPct: number | null;
}

/** The gap the plan screen always shows: lines versus targets. */
export function reconcile(plan: BusinessPlanRecord): PlanReconciliation {
  const plannedRevenue = plan.lines.reduce((s, l) => s + l.expectedRevenue, 0);
  const plannedGrossProfit = plan.lines.reduce((s, l) => s + l.expectedGrossProfit, 0);
  return {
    plannedRevenue,
    plannedGrossProfit,
    revenueGap: plan.revenueTarget - plannedRevenue,
    grossProfitGap: plan.grossProfitTarget - plannedGrossProfit,
    revenueCoveragePct: plan.revenueTarget > 0 ? (plannedRevenue / plan.revenueTarget) * 100 : null,
    grossProfitCoveragePct:
      plan.grossProfitTarget > 0 ? (plannedGrossProfit / plan.grossProfitTarget) * 100 : null,
    marginPct: plannedRevenue > 0 ? (plannedGrossProfit / plannedRevenue) * 100 : null,
  };
}

export type PlanDimension = "supplier" | "product" | "customer";

export interface DimensionRollup {
  key: string;
  label: string;
  revenue: number;
  grossProfit: number;
  quantity: number;
  sharePct: number;
}

export function rollup(plan: BusinessPlanRecord, dimension: PlanDimension): DimensionRollup[] {
  const total = plan.lines.reduce((s, l) => s + l.expectedRevenue, 0);
  const buckets = new Map<string, DimensionRollup>();
  for (const l of plan.lines) {
    const key =
      dimension === "supplier"
        ? (l.supplierId ?? "none")
        : dimension === "product"
          ? (l.productId ?? "none")
          : (l.customerId ?? "none");
    const label =
      dimension === "supplier"
        ? (l.supplierName ?? "Unassigned supplier")
        : dimension === "product"
          ? (l.productName ?? l.sku ?? "Unassigned product")
          : (l.customerName ?? "Unassigned customer");
    const b = buckets.get(key) ?? { key, label, revenue: 0, grossProfit: 0, quantity: 0, sharePct: 0 };
    b.revenue += l.expectedRevenue;
    b.grossProfit += l.expectedGrossProfit;
    b.quantity += l.expectedQuantity;
    buckets.set(key, b);
  }
  const rows = [...buckets.values()];
  for (const r of rows) r.sharePct = total > 0 ? (r.revenue / total) * 100 : 0;
  return rows.sort((a, b) => b.revenue - a.revenue);
}

/**
 * Top-down: spread an annual target across existing lines in proportion to the
 * revenue already on them, holding each line's margin. Lines without revenue
 * receive an equal share of whatever is left, so nothing silently disappears.
 */
export function allocateTopDown(
  lines: BusinessPlanLine[],
  revenueTarget: number,
): BusinessPlanLine[] {
  if (lines.length === 0) return lines;
  const total = lines.reduce((s, l) => s + l.expectedRevenue, 0);
  if (total <= 0) {
    const each = revenueTarget / lines.length;
    return lines.map((l) => ({ ...l, expectedRevenue: each, expectedGrossProfit: 0 }));
  }
  return lines.map((l) => {
    const share = l.expectedRevenue / total;
    const revenue = revenueTarget * share;
    const margin = l.expectedRevenue > 0 ? l.expectedGrossProfit / l.expectedRevenue : 0;
    const scale = l.expectedRevenue > 0 ? revenue / l.expectedRevenue : 0;
    return {
      ...l,
      expectedRevenue: revenue,
      expectedGrossProfit: revenue * margin,
      expectedQuantity: l.expectedQuantity * scale,
      source: "allocation" as PlanLineSource,
    };
  });
}
