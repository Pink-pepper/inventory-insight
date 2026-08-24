/**
 * Demand plan assembly.
 *
 * Pure composition of facts + policy into the shape the workspace renders:
 * a demand series, a transparent baseline, a dimension breakdown and the
 * available filter values. Every limitation is surfaced rather than hidden.
 */
import {
  applyPlanningFilter,
  filterGrain,
  withinRange,
  type CompareMode,
  type DemandDimension,
  type PlanningFilter,
} from "@/lib/query/filters";
import { DEFAULT_ENGINE_CONFIG } from "@/lib/engine/inventory-engine";
import type { PlanningPolicy } from "@/lib/domain/planning-policy";
import { shiftRange, type DateRange, type TimeGrain } from "@/lib/domain/time-grain";
import {
  bucketise,
  buildSeries,
  totalQuantity,
  totalRevenue,
  type DemandFact,
} from "@/lib/demand/series";
import { computeBaseline, projectionPoints } from "@/lib/demand/baseline";
import { assessDimensions, breakdown } from "@/lib/demand/dimensions";

const uniq = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));

/** Values that actually exist in the workspace, so filters never offer dead ends. */
export function filterOptions(facts: DemandFact[]) {
  return {
    categories: uniq(facts.map((f) => f.category)),
    suppliers: uniq(facts.map((f) => f.supplierCode)).map((code) => ({
      code,
      name: facts.find((f) => f.supplierCode === code)?.supplierName ?? code,
    })),
    channels: uniq(facts.map((f) => f.channelCode)).map((code) => ({
      code,
      name: facts.find((f) => f.channelCode === code)?.channelName ?? code,
    })),
    customers: uniq(facts.map((f) => f.customerRef)).map((ref) => ({
      ref,
      name: facts.find((f) => f.customerRef === ref)?.customerName ?? ref,
    })),
    locations: uniq(facts.map((f) => f.locationCode)).map((code) => ({
      code,
      name: facts.find((f) => f.locationCode === code)?.locationName ?? code,
    })),
    regions: uniq(facts.map((f) => f.region)),
    statesProvinces: uniq(facts.map((f) => f.stateProvince)),
    dateRange: dataRange(facts),
  };
}

function dataRange(facts: DemandFact[]): DateRange | null {
  if (facts.length === 0) return null;
  let from = facts[0]!.date.slice(0, 10);
  let to = from;
  for (const f of facts) {
    const d = f.date.slice(0, 10);
    if (d < from) from = d;
    if (d > to) to = d;
  }
  return { from, to };
}

/** Applies the attribute part of the filter spec to flat demand facts. */
export function filterFactsByAttributes(facts: DemandFact[], filter: PlanningFilter) {
  return applyPlanningFilter(
    facts.map((f) => ({
      ...f,
      locationCodes: f.locationCode ? [f.locationCode] : [],
      regions: f.region ? [f.region] : [],
      statesProvinces: f.stateProvince ? [f.stateProvince] : [],
      countries: f.country ? [f.country] : [],
      channelCodes: f.channelCode ? [f.channelCode] : [],
      customerRefs: f.customerRef ? [f.customerRef] : [],
    })),
    filter,
  ) as DemandFact[];
}

function comparisonWindow(
  range: DateRange | null,
  grain: TimeGrain,
  mode: CompareMode,
): DateRange | null {
  if (!range || mode === "none") return null;
  return mode === "yoy" ? shiftRange(range, "year", 1) : shiftRange(range, grain, 1);
}

export interface DemandPlanInput {
  facts: DemandFact[];
  filter: PlanningFilter;
  policy: PlanningPolicy;
  dimension: DemandDimension;
}

export function buildDemandPlan({ facts, filter, policy, dimension }: DemandPlanInput) {
  const grain = filterGrain(filter);
  const compare: CompareMode = filter.compare ?? "none";
  const attributeFiltered = filterFactsByAttributes(facts, filter);
  const current = attributeFiltered.filter((f) => withinRange(f.date, filter));

  const series = buildSeries(current, grain);
  const effectiveGrain = series.coverage.grain;

  const selectedRange: DateRange | null =
    filter.from && filter.to
      ? { from: filter.from, to: filter.to }
      : dataRange(current);
  const priorRange = comparisonWindow(selectedRange, effectiveGrain, compare);
  const priorFacts = priorRange
    ? attributeFiltered.filter((f) => {
        const d = f.date.slice(0, 10);
        return (
          d >= priorRange.from && d <= priorRange.to && f.source === (series.coverage.source ?? f.source)
        );
      })
    : [];
  const priorBuckets = bucketise(priorFacts, effectiveGrain);

  const baseline = computeBaseline(series.buckets, series.coverage, {
    demandWindowMonths: policy.demandWindowMonths ?? DEFAULT_ENGINE_CONFIG.demandWindowMonths,
    planningHorizonDays: policy.planningHorizonDays ?? DEFAULT_ENGINE_CONFIG.reviewPeriodDays,
    demandGrowthPct: policy.demandGrowthPct,
  });

  const currentTotal = totalQuantity(series.buckets);
  const priorTotal = totalQuantity(priorBuckets);

  const availability = assessDimensions(series.facts);
  const requested = availability.find((a) => a.dimension === dimension);
  const activeDimension: DemandDimension = requested?.available ? dimension : "product";

  return {
    grain: effectiveGrain,
    requestedGrain: grain,
    coverage: series.coverage,
    range: selectedRange,
    priorRange,
    compare,
    buckets: series.buckets,
    priorBuckets,
    projection: projectionPoints(
      baseline,
      series.coverage.lastPeriod,
      effectiveGrain,
      Math.max(1, Math.min(12, Math.ceil(baseline.assumptions.horizonPeriods))),
    ),
    totals: {
      quantity: currentTotal,
      revenue: totalRevenue(series.buckets),
      priorQuantity: priorRange ? priorTotal : null,
      changePct:
        priorRange && priorTotal > 0
          ? Math.round(((currentTotal - priorTotal) / priorTotal) * 1000) / 10
          : null,
      skus: new Set(series.facts.map((f) => f.sku)).size,
    },
    baseline,
    dimension: activeDimension,
    dimensionFellBack: activeDimension !== dimension,
    availability,
    rows: breakdown(series.facts, priorFacts, activeDimension),
    /** Per-SKU direction, reused by the inventory workspace. */
    skuDirection: skuDirection(series.buckets.length > 0 ? series.facts : [], priorFacts),
  };
}

export type DemandPlan = ReturnType<typeof buildDemandPlan>;

function skuDirection(current: DemandFact[], prior: DemandFact[]) {
  const sum = (facts: DemandFact[]) => {
    const map = new Map<string, number>();
    for (const f of facts) map.set(f.sku, (map.get(f.sku) ?? 0) + f.quantity);
    return map;
  };
  const now = sum(current);
  const before = sum(prior);
  return [...now.entries()].map(([sku, quantity]) => {
    const priorQuantity = before.has(sku) ? before.get(sku)! : null;
    return {
      sku,
      quantity,
      priorQuantity,
      changePct:
        priorQuantity == null || priorQuantity === 0
          ? null
          : Math.round(((quantity - priorQuantity) / priorQuantity) * 1000) / 10,
    };
  });
}