/**
 * Demand dimensions.
 *
 * Which dimensions a dataset actually populates is a property of the data, not
 * an assumption: a dimension with no values is reported as unavailable rather
 * than rendered as an empty breakdown.
 */
import type { DemandDimension } from "@/lib/query/filters";
import { bucketise, totalQuantity, type DemandFact } from "@/lib/demand/series";
import type { TimeGrain } from "@/lib/domain/time-grain";

export const DIMENSION_LABELS: Record<DemandDimension, string> = {
  product: "Product / SKU",
  category: "Category",
  supplier: "Supplier",
  channel: "Channel",
  customer: "Customer",
  location: "Location",
  region: "Region",
  state_province: "State / province",
};

/** The key and display label a fact contributes to a dimension. */
export function dimensionKey(
  fact: DemandFact,
  dimension: DemandDimension,
): { key: string; label: string } | null {
  switch (dimension) {
    case "product":
      return { key: fact.sku, label: fact.name || fact.sku };
    case "category":
      return fact.category ? { key: fact.category, label: fact.category } : null;
    case "supplier":
      return fact.supplierCode ? { key: fact.supplierCode, label: fact.supplierName } : null;
    case "channel":
      return fact.channelCode
        ? { key: fact.channelCode, label: fact.channelName ?? fact.channelCode }
        : null;
    case "customer":
      return fact.customerRef
        ? { key: fact.customerRef, label: fact.customerName ?? fact.customerRef }
        : null;
    case "location":
      return fact.locationCode
        ? { key: fact.locationCode, label: fact.locationName ?? fact.locationCode }
        : null;
    case "region":
      return fact.region ? { key: fact.region, label: fact.region } : null;
    case "state_province":
      return fact.stateProvince ? { key: fact.stateProvince, label: fact.stateProvince } : null;
  }
}

export interface DimensionAvailability {
  dimension: DemandDimension;
  label: string;
  available: boolean;
  /** Share of facts that carry a value for this dimension, 0–100. */
  coveragePct: number;
  reason: string | null;
}

export function assessDimensions(facts: DemandFact[]): DimensionAvailability[] {
  const total = facts.length;
  return (Object.keys(DIMENSION_LABELS) as DemandDimension[]).map((dimension) => {
    const withValue = total === 0 ? 0 : facts.filter((f) => dimensionKey(f, dimension)).length;
    const coveragePct = total === 0 ? 0 : Math.round((withValue / total) * 100);
    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      available: withValue > 0,
      coveragePct,
      reason:
        withValue > 0
          ? null
          : total === 0
            ? "No demand data matches the current filters."
            : "The ingested data carries no values for this dimension.",
    };
  });
}

export interface DimensionRow {
  key: string;
  label: string;
  quantity: number;
  priorQuantity: number | null;
  changePct: number | null;
  sharePct: number;
}

/** Aggregates facts by dimension member, with an optional comparison window. */
export function breakdown(
  facts: DemandFact[],
  priorFacts: DemandFact[],
  dimension: DemandDimension,
): DimensionRow[] {
  const current = new Map<string, { label: string; quantity: number }>();
  for (const f of facts) {
    const k = dimensionKey(f, dimension);
    if (!k) continue;
    const entry = current.get(k.key) ?? { label: k.label, quantity: 0 };
    entry.quantity += f.quantity;
    current.set(k.key, entry);
  }
  const prior = new Map<string, number>();
  for (const f of priorFacts) {
    const k = dimensionKey(f, dimension);
    if (!k) continue;
    prior.set(k.key, (prior.get(k.key) ?? 0) + f.quantity);
  }
  const grand = [...current.values()].reduce((s, e) => s + e.quantity, 0);
  return [...current.entries()]
    .map(([key, entry]) => {
      const priorQuantity = prior.has(key) ? prior.get(key)! : null;
      return {
        key,
        label: entry.label,
        quantity: entry.quantity,
        priorQuantity,
        changePct:
          priorQuantity == null || priorQuantity === 0
            ? null
            : Math.round(((entry.quantity - priorQuantity) / priorQuantity) * 1000) / 10,
        sharePct: grand === 0 ? 0 : Math.round((entry.quantity / grand) * 1000) / 10,
      };
    })
    .sort((a, b) => b.quantity - a.quantity);
}

/** Per-member series, used where a member's own trend matters. */
export function memberSeries(
  facts: DemandFact[],
  dimension: DemandDimension,
  key: string,
  grain: TimeGrain,
) {
  const subset = facts.filter((f) => dimensionKey(f, dimension)?.key === key);
  const buckets = bucketise(subset, grain);
  return { buckets, total: totalQuantity(buckets) };
}