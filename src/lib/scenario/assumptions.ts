/**
 * Scenario assumptions: the controlled "what-if" overlay.
 *
 * An assumption set only ever contains overrides — null/absent means "keep the
 * live policy or recorded value". The set is validated by Zod at every
 * boundary (client form, server function input, stored JSONB read-back) so a
 * scenario can never smuggle an out-of-range parameter into the engines.
 *
 * Only controls the existing engines actually consume are offered. Stored-
 * but-unconsumed policy fields (seasonality, variability, alternative demand
 * methods) and data Ionic does not have (FX, tariffs) are deliberately absent.
 */
import { z } from "zod";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";

export const scenarioAssumptionsSchema = z.object({
  /** Replaces the policy's demand growth adjustment, percent. */
  demandGrowthPct: z.number().min(-100).max(1000).nullable().optional(),
  /** Replaces the policy's demand window, months of history. */
  demandWindowMonths: z.number().int().min(1).max(60).nullable().optional(),
  /** Replaces the policy's planning horizon (review period), days. */
  planningHorizonDays: z.number().int().min(1).max(730).nullable().optional(),
  /** Overrides the safety stock buffer for every SKU in scope, days. */
  safetyStockDays: z.number().int().min(0).max(365).nullable().optional(),
  /** Replaces the policy's order multiple. */
  orderMultiple: z.number().int().min(1).max(1_000_000).nullable().optional(),
  /**
   * Org-wide lead-time shift applied to every KNOWN lead time, clamped to a
   * minimum of 1 day. A SKU without any lead time stays without one — the
   * scenario never invents one implicitly.
   */
  leadTimeDeltaDays: z.number().int().min(-365).max(365).nullable().optional(),
  /** Absolute lead-time declarations per supplier; may fill a missing value. */
  supplierLeadTimes: z
    .array(
      z.object({
        supplierCode: z.string().min(1).max(120),
        leadTimeDays: z.number().int().min(0).max(730),
      }),
    )
    .max(200)
    .nullable()
    .optional(),
  /** Percentage change applied to every SKU's minimum order quantity. */
  minOrderQtyChangePct: z.number().min(-100).max(1000).nullable().optional(),
  /**
   * Supplier cost changes, percent per supplier. Costs are recorded in a
   * single currency; Ionic has no FX rates, so cost assumptions only ever
   * move spend figures within that currency.
   */
  supplierCostChanges: z
    .array(
      z.object({
        supplierCode: z.string().min(1).max(120),
        changePct: z.number().min(-100).max(1000),
      }),
    )
    .max(200)
    .nullable()
    .optional(),
  /** Delivery delay: every scheduled PO ETA shifts this many days later. */
  etaDelayDays: z.number().int().min(0).max(365).nullable().optional(),
});

export type ScenarioAssumptions = z.infer<typeof scenarioAssumptionsSchema>;

export const EMPTY_ASSUMPTIONS: ScenarioAssumptions = {};

/** True when at least one override is set — an empty scenario is not runnable. */
export function hasAssumptions(a: ScenarioAssumptions): boolean {
  return (
    a.demandGrowthPct != null ||
    a.demandWindowMonths != null ||
    a.planningHorizonDays != null ||
    a.safetyStockDays != null ||
    a.orderMultiple != null ||
    a.leadTimeDeltaDays != null ||
    (a.supplierLeadTimes?.length ?? 0) > 0 ||
    a.minOrderQtyChangePct != null ||
    (a.supplierCostChanges?.length ?? 0) > 0 ||
    (a.etaDelayDays ?? 0) > 0
  );
}

const fmtPct = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

/**
 * The "what changed" panel: each set assumption rendered against the live
 * value it replaces. Pure description — no calculation happens here.
 */
export function describeAssumptions(
  a: ScenarioAssumptions,
  policy: PlanningPolicy,
): string[] {
  const lines: string[] = [];
  const arrow = (from: string, to: string) => `${from} → ${to}`;

  if (a.demandGrowthPct != null) {
    lines.push(
      `Demand growth: ${arrow(fmtPct(policy.demandGrowthPct ?? 0), fmtPct(a.demandGrowthPct))}`,
    );
  }
  if (a.demandWindowMonths != null) {
    lines.push(
      `Demand window: ${arrow(`${policy.demandWindowMonths ?? 6} months`, `${a.demandWindowMonths} months`)}`,
    );
  }
  if (a.planningHorizonDays != null) {
    lines.push(
      `Planning horizon: ${arrow(`${policy.planningHorizonDays ?? 30} days`, `${a.planningHorizonDays} days`)}`,
    );
  }
  if (a.safetyStockDays != null) {
    lines.push(
      `Safety stock: ${arrow(`${policy.safetyStockDays ?? 0} days (policy)`, `${a.safetyStockDays} days for every SKU in scope`)}`,
    );
  }
  if (a.orderMultiple != null) {
    lines.push(
      `Order multiple: ${arrow(`${policy.orderMultiple ?? 1}`, `${a.orderMultiple}`)}`,
    );
  }
  if (a.leadTimeDeltaDays != null && a.leadTimeDeltaDays !== 0) {
    lines.push(
      `Lead times: ${a.leadTimeDeltaDays > 0 ? "+" : ""}${a.leadTimeDeltaDays} days on every known lead time (minimum 1 day)`,
    );
  }
  for (const s of a.supplierLeadTimes ?? []) {
    lines.push(`Lead time for supplier ${s.supplierCode}: set to ${s.leadTimeDays} days`);
  }
  if (a.minOrderQtyChangePct != null && a.minOrderQtyChangePct !== 0) {
    lines.push(`Minimum order quantities: ${fmtPct(a.minOrderQtyChangePct)}`);
  }
  for (const c of a.supplierCostChanges ?? []) {
    lines.push(`Unit costs from supplier ${c.supplierCode}: ${fmtPct(c.changePct)}`);
  }
  if ((a.etaDelayDays ?? 0) > 0) {
    lines.push(`Inbound deliveries: every scheduled ETA moves ${a.etaDelayDays} day(s) later`);
  }
  return lines;
}
