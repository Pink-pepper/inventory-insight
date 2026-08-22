/**
 * Plain-language construction of the supply plan explanation.
 *
 * Every number quoted here already exists on the computed row — this module
 * only arranges them into words, so the explanation can never disagree with
 * the table.
 */
import { num } from "@/lib/format";
import type { SupplyRiskFlag } from "./plan";

export interface SupplyExplanation {
  inputs: string[];
  method: string[];
  output: string;
  limitations: string[];
}

const RISK_TEXT: Record<SupplyRiskFlag, string> = {
  stockout_before_receipt: "The projected position goes negative before the first scheduled receipt lands.",
  lead_time_missing: "No supplier lead time is known, so no order-by date can be calculated.",
  eta_unknown: "Inbound stock exists without an expected date and cannot be phased into the projection.",
  moq_over_order: "The minimum order quantity or order multiple raises the order above the strict net requirement.",
  excess_suppressed: "The engine marks this SKU as excess; no procurement is suggested while the projected position stays sufficient.",
  no_demand_baseline: "There is not enough demand history to project, so no net requirement can be computed.",
};

export function riskText(flag: SupplyRiskFlag): string {
  return RISK_TEXT[flag];
}

export function explainSupplyRow(input: {
  onHand: number;
  scheduledInbound: number;
  unscheduledOnOrder: number;
  earliestEta: string | null;
  plannedPerPeriod: number | null;
  horizonPeriods: number;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  lowPoint: number | null;
  netRequirement: number | null;
  suggestedQty: number | null;
  requiredByPeriod: string | null;
  orderByDate: string | null;
  minOrderQty: number;
  leadTimeDays: number | null;
  riskFlags: SupplyRiskFlag[];
  excessLocationCount: number;
}): SupplyExplanation {
  const inputs = [
    `On hand ${num(input.onHand)} units, with ${num(input.scheduledInbound)} scheduled on purchase orders` +
      (input.earliestEta ? ` (earliest ETA ${input.earliestEta})` : "") +
      ` and ${num(input.unscheduledOnOrder)} further on-order units without an ETA.`,
    input.plannedPerPeriod != null
      ? `Planned demand ${num(input.plannedPerPeriod)} units per month across a ${input.horizonPeriods}-period horizon.`
      : "No demand baseline: history is insufficient to project demand.",
    `Safety stock ${num(input.safetyStock)}, reorder point ${num(input.reorderPoint)}, target stock ${num(input.targetStock)} — all from the existing engine under the active planning policy.`,
  ];

  const method = [
    "Project month by month: previous position minus planned demand plus receipts scheduled into that month. Past-due receipts are assumed to land in the first projected period.",
    "Net requirement = max(0, target stock − lowest projected position). The suggested order is the net requirement rounded up to the minimum order quantity and order multiple.",
    input.orderByDate
      ? `Order-by date = the period the position first crosses the reorder point (${input.requiredByPeriod}) minus the lead time of ${input.leadTimeDays} days.`
      : "An order-by date needs both a reorder-point crossing and a known lead time; at least one is absent.",
  ];

  const output =
    input.netRequirement == null
      ? "No net requirement can be computed for this SKU."
      : input.netRequirement <= 0
        ? "Scheduled supply and current stock cover the planning horizon; no purchase is suggested."
        : `Buy ${num(input.suggestedQty ?? input.netRequirement)} units` +
          (input.orderByDate ? ` by ${input.orderByDate}` : "") +
          (input.requiredByPeriod ? ` to cover the need that first occurs in ${input.requiredByPeriod.slice(0, 7)}` : "") +
          ".";

  const limitations = input.riskFlags.map(riskText);
  if (input.excessLocationCount > 0) {
    limitations.push(
      `${input.excessLocationCount} location(s) hold stock far beyond their own requirement while the aggregate position needs replenishment — redistribution may avoid this purchase.`,
    );
  }
  return { inputs, method, output, limitations };
}
