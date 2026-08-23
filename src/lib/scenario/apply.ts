/**
 * Scenario input transformation.
 *
 * Produces the adjusted COPIES a scenario run feeds to the existing engines:
 * an overridden planning policy, adjusted SKU signals, and ETA-shifted open
 * supply. The live objects are never mutated — the baseline pass of the same
 * run uses the untouched inputs, which is what makes the two comparable.
 *
 * Pure: no DB, no React, no writes of any kind.
 */
import type { LoadedSku, OpenSupplyLine } from "@/lib/data/repository";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import type { ScenarioAssumptions } from "./assumptions";

/**
 * Policy-level overrides. Only fields consumed AFTER signals are loaded belong
 * here: demand window, horizon and growth (the demand baseline) and the order
 * multiple (netting). Safety stock, lead time and MOQ are resolved into the
 * signals at load time, so scenario overrides for them happen in
 * `applyScenarioSignals` instead — where the live cascade has already run.
 */
export function applyScenarioPolicy(
  policy: PlanningPolicy,
  a: ScenarioAssumptions,
): PlanningPolicy {
  return {
    ...policy,
    demandWindowMonths: a.demandWindowMonths ?? policy.demandWindowMonths,
    planningHorizonDays: a.planningHorizonDays ?? policy.planningHorizonDays,
    demandGrowthPct: a.demandGrowthPct ?? policy.demandGrowthPct,
    orderMultiple: a.orderMultiple ?? policy.orderMultiple,
  };
}

/** Signal-level overrides, applied uniformly to every SKU in scope. */
export function applyScenarioSignals(
  signals: LoadedSku[],
  a: ScenarioAssumptions,
): LoadedSku[] {
  const leadBySupplier = new Map(
    (a.supplierLeadTimes ?? []).map((s) => [s.supplierCode, s.leadTimeDays]),
  );
  const costBySupplier = new Map(
    (a.supplierCostChanges ?? []).map((c) => [c.supplierCode, c.changePct]),
  );
  const delta = a.leadTimeDeltaDays ?? 0;
  const moqPct = a.minOrderQtyChangePct ?? 0;

  return signals.map((s) => {
    let leadTimeDays = s.leadTimeDays;
    // An explicit per-supplier declaration wins over the org-wide shift and
    // may fill a value the live data does not have — the planner asserted it.
    const declared = leadBySupplier.get(s.supplierCode);
    if (declared != null) {
      leadTimeDays = declared;
    } else if (delta !== 0 && leadTimeDays != null) {
      leadTimeDays = Math.max(1, leadTimeDays + delta);
    }

    const minOrderQty =
      moqPct !== 0 ? Math.max(1, Math.ceil(s.minOrderQty * (1 + moqPct / 100))) : s.minOrderQty;

    const costPct = costBySupplier.get(s.supplierCode);
    const unitCost =
      costPct != null ? Math.round(s.unitCost * (1 + costPct / 100) * 100) / 100 : s.unitCost;

    const safetyStockDays = a.safetyStockDays ?? s.safetyStockDays;

    if (
      leadTimeDays === s.leadTimeDays &&
      minOrderQty === s.minOrderQty &&
      unitCost === s.unitCost &&
      safetyStockDays === s.safetyStockDays
    ) {
      return s;
    }
    return { ...s, leadTimeDays, minOrderQty, unitCost, safetyStockDays };
  });
}

const DAY_MS = 86_400_000;

/** Shifts every scheduled ETA later by the assumed delay. Undated lines are untouched. */
export function applyScenarioOpenSupply(
  lines: OpenSupplyLine[],
  a: ScenarioAssumptions,
): OpenSupplyLine[] {
  const delay = a.etaDelayDays ?? 0;
  if (delay <= 0) return lines;
  return lines.map((l) => {
    if (l.expectedAt == null) return l;
    const shifted = new Date(Date.parse(`${l.expectedAt}T00:00:00Z`) + delay * DAY_MS);
    return { ...l, expectedAt: shifted.toISOString().slice(0, 10) };
  });
}
