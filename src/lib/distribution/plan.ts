/**
 * Distribution planning: internal transfer suggestions.
 *
 * Given that the supply plan says a SKU needs replenishment, this module asks
 * the prior question: is the shortfall already sitting in another location?
 * It compares each location's stock against that location's OWN cover-based
 * requirement (its measured demand × lead time, safety and one review period)
 * and suggests moving the excess to locations whose local stock falls short.
 *
 * Honesty rules:
 * - Location-level demand exists only in day-grain transactions. Monthly
 *   facts carry no location, so they contribute nothing here — when no
 *   transactions exist the module returns no suggestions and says why.
 * - A location with no recorded demand for the SKU contributes its stock as
 *   transferable, with an explicit note; its demand is never invented.
 * - Transfers only ever reduce the purchase requirement computed by the
 *   supply plan; they never create a requirement that was not already there.
 *
 * Pure composition over the supply plan output. No writes, no Supabase, no React.
 */
import type { OpenSupplyLine } from "@/lib/data/repository";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import { DEFAULT_ENGINE_CONFIG, resolveEngineConfig } from "@/lib/engine/inventory-engine";
import type { DemandFact } from "@/lib/demand/series";
import { filterFactsByAttributes } from "@/lib/demand/plan";
import type { SupplyPlanRow } from "@/lib/supply/plan";
import { withinRange, type PlanningFilter } from "@/lib/query/filters";

/** One stock movement between two locations. */
export interface TransferLeg {
  fromLocation: string;
  toLocation: string;
  quantity: number;
}

/** Per-location stock/demand balance behind a suggestion, for transparency. */
export interface LocationBalance {
  location: string;
  onHand: number;
  /** Outstanding PO quantity addressed to this location with an ETA. */
  scheduledInbound: number;
  /** Average daily demand measured at this location; null when no history exists. */
  avgDailyDemand: number | null;
  /** Stock the location keeps for itself; null when demand is unmeasured. */
  keepQty: number | null;
  excess: number;
  need: number;
}

export interface TransferSuggestion {
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  /** Purchase requirement before transfers (from the supply plan). */
  netRequirement: number;
  legs: TransferLeg[];
  totalQuantity: number;
  /** Purchase requirement remaining after the suggested transfers. */
  remainingNetRequirement: number;
  balances: LocationBalance[];
  notes: string[];
}

export interface DistributionPlanSummary {
  skuCount: number;
  /** SKUs whose purchase requirement can be at least partly met internally. */
  skusWithOpportunity: number;
  totalTransferUnits: number;
  /** Σ transferred qty × recorded unit cost — purchasing outlay avoided. */
  avoidableSpend: number;
  /** False when at least one suggested SKU has no recorded unit cost. */
  spendComplete: boolean;
  /** True when no day-grain transactions exist, so location demand cannot be measured. */
  noLocationDemand: boolean;
}

export interface DistributionPlanInput {
  supplyRows: SupplyPlanRow[];
  facts: DemandFact[];
  openSupply: OpenSupplyLine[];
  policy: PlanningPolicy;
  filter: PlanningFilter;
}

const MAX_LEGS_PER_SKU = 10;

export function buildDistributionPlan({ supplyRows, facts, openSupply, policy, filter }: DistributionPlanInput) {
  const cfg = resolveEngineConfig(policy);
  const windowMonths = Math.max(1, policy.demandWindowMonths ?? DEFAULT_ENGINE_CONFIG.demandWindowMonths);

  const scopedFacts = filterFactsByAttributes(facts, filter).filter((f) => withinRange(f.date, filter));
  const transactionFacts = scopedFacts.filter((f) => f.source === "transactions");

  const factsBySkuLocation = new Map<string, DemandFact[]>();
  for (const f of transactionFacts) {
    if (!f.locationCode) continue;
    const key = `${f.sku}${f.locationCode}`;
    const list = factsBySkuLocation.get(key) ?? [];
    list.push(f);
    factsBySkuLocation.set(key, list);
  }

  // POs addressed to a receiving location count toward that location's cover.
  const inboundBySkuLocation = new Map<string, number>();
  for (const line of openSupply) {
    if (!line.locationCode || line.expectedAt == null) continue;
    const key = `${line.sku}${line.locationCode}`;
    inboundBySkuLocation.set(key, (inboundBySkuLocation.get(key) ?? 0) + line.outstanding);
  }

  const suggestions: TransferSuggestion[] = [];

  for (const row of supplyRows) {
    if ((row.netRequirement ?? 0) <= 0 || row.blocked) continue;

    // The location universe: everywhere the SKU has an inventory position,
    // plus anywhere transactions recorded demand for it.
    const locationSet = new Set<string>(row.locations.map((l) => l.location));
    for (const f of transactionFacts) {
      if (f.sku === row.sku && f.locationCode) locationSet.add(f.locationCode);
    }
    const locations = [...locationSet];
    if (locations.length < 2) continue;

    // Demand window end: the latest observed transaction for the SKU.
    const skuFactDates = transactionFacts.filter((f) => f.sku === row.sku).map((f) => f.date);
    const windowEnd = skuFactDates.sort().at(-1) ?? null;

    const coverDays = (row.leadTimeDays ?? 0) + row.safetyStockDays;
    const keepDays = coverDays + cfg.reviewPeriodDays;
    const notes: string[] = [];

    const balances: LocationBalance[] = locations.map((location) => {
      const position = row.locations.find((l) => l.location === location);
      const onHand = position?.onHand ?? 0;
      const scheduledInbound = inboundBySkuLocation.get(`${row.sku}${location}`) ?? 0;

      let avgDailyDemand: number | null = null;
      const localFacts = factsBySkuLocation.get(`${row.sku}${location}`) ?? [];
      if (localFacts.length > 0 && windowEnd) {
        const endMs = Date.parse(`${windowEnd}T00:00:00Z`);
        const startMs = endMs - windowMonths * cfg.daysPerMonth * 86_400_000;
        const inWindow = localFacts.filter((f) => Date.parse(`${f.date}T00:00:00Z`) >= startMs);
        const days = Math.max(1, (endMs - startMs) / 86_400_000);
        avgDailyDemand = inWindow.reduce((s, f) => s + f.quantity, 0) / days;
      }

      let keepQty: number | null = null;
      let excess = 0;
      let need = 0;
      if (avgDailyDemand == null) {
        // No measured demand at this location: it cannot be a destination, and
        // its stock is treated as transferable — stated, not assumed silently.
        if (onHand > 0) {
          excess = onHand + scheduledInbound;
          notes.push(`${location}: no demand recorded here; stock treated as transferable.`);
        }
      } else {
        keepQty = Math.ceil(avgDailyDemand * keepDays);
        const coverFloor = Math.ceil(avgDailyDemand * coverDays);
        excess = Math.max(0, onHand + scheduledInbound - keepQty);
        need = Math.max(0, coverFloor - (onHand + scheduledInbound));
      }
      return { location, onHand, scheduledInbound, avgDailyDemand, keepQty, excess, need };
    });

    const sources = balances.filter((b) => b.excess > 0).sort((a, b) => b.excess - a.excess);
    const destinations = balances.filter((b) => b.need > 0).sort((a, b) => b.need - a.need);
    if (sources.length === 0 || destinations.length === 0) continue;

    const legs: TransferLeg[] = [];
    let remaining = row.netRequirement!;
    const sourceExcess = new Map(sources.map((s) => [s.location, s.excess]));

    for (const dest of destinations) {
      if (remaining <= 0 || legs.length >= MAX_LEGS_PER_SKU) break;
      let destNeed = dest.need;
      for (const src of sources) {
        if (remaining <= 0 || destNeed <= 0 || legs.length >= MAX_LEGS_PER_SKU) break;
        if (src.location === dest.location) continue;
        const available = sourceExcess.get(src.location) ?? 0;
        const qty = Math.floor(Math.min(available, destNeed, remaining));
        if (qty <= 0) continue;
        legs.push({ fromLocation: src.location, toLocation: dest.location, quantity: qty });
        sourceExcess.set(src.location, available - qty);
        destNeed -= qty;
        remaining -= qty;
      }
    }

    if (legs.length === 0) continue;

    const totalQuantity = legs.reduce((s, l) => s + l.quantity, 0);
    if (remaining > 0) {
      notes.push(`${remaining.toLocaleString("en-US")} unit(s) still require purchasing after the suggested transfers.`);
    }
    suggestions.push({
      sku: row.sku,
      name: row.name,
      category: row.category,
      unitCost: row.unitCost,
      netRequirement: row.netRequirement!,
      legs,
      totalQuantity,
      remainingNetRequirement: remaining,
      balances,
      notes,
    });
  }

  suggestions.sort((a, b) => b.totalQuantity * b.unitCost - a.totalQuantity * a.unitCost);

  const summary: DistributionPlanSummary = {
    skuCount: supplyRows.length,
    skusWithOpportunity: suggestions.length,
    totalTransferUnits: suggestions.reduce((s, t) => s + t.totalQuantity, 0),
    avoidableSpend: Math.round(suggestions.reduce((s, t) => s + t.totalQuantity * t.unitCost, 0)),
    spendComplete: suggestions.every((t) => t.unitCost > 0),
    noLocationDemand: transactionFacts.every((f) => !f.locationCode),
  };

  return { suggestions, summary };
}

export type DistributionPlan = ReturnType<typeof buildDistributionPlan>;
