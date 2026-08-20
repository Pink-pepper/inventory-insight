/**
 * Transparent demand baseline.
 *
 * Trailing average of the observed history, optionally adjusted by the
 * organisation's growth setting, projected across the configured planning
 * horizon. Nothing statistical is inferred and no forecast confidence is
 * claimed: every number here can be recomputed by hand from the inputs.
 */
import type { TimeGrain } from "@/lib/domain/time-grain";
import type { DemandBucket, SeriesCoverage } from "@/lib/demand/series";

/** Average calendar days in one bucket of each grain. */
export const DAYS_PER_PERIOD: Record<TimeGrain, number> = {
  day: 1,
  week: 7,
  month: 30.44,
  quarter: 91.31,
  year: 365.25,
};

const MONTHS_PER_PERIOD: Record<TimeGrain, number> = {
  day: 1 / 30.44,
  week: 7 / 30.44,
  month: 1,
  quarter: 3,
  year: 12,
};

export type VariabilityLabel = "stable" | "variable" | "volatile";

export interface Variability {
  /** Coefficient of variation of the historical buckets, as a percentage. */
  cvPct: number;
  label: VariabilityLabel;
  /** The thresholds used, so the label is never a black box. */
  thresholds: { stableBelowPct: number; volatileAbovePct: number };
}

export interface BaselineAssumptions {
  method: "trailing_average";
  grain: TimeGrain;
  /** Months of history the policy asked for. */
  demandWindowMonths: number;
  /** Buckets that window equates to at the active grain. */
  periodsRequested: number;
  /** Buckets actually available and used. */
  periodsUsed: number;
  windowFrom: string | null;
  windowTo: string | null;
  growthPct: number;
  growthApplied: boolean;
  planningHorizonDays: number;
  horizonPeriods: number;
}

export interface DemandBaseline {
  sufficient: boolean;
  /** Average demand per bucket over the trailing window. */
  perPeriod: number | null;
  /** Baseline after the growth adjustment. */
  plannedPerPeriod: number | null;
  /** Planned demand across the whole planning horizon. */
  plannedTotal: number | null;
  historicalTotal: number;
  variability: Variability | null;
  assumptions: BaselineAssumptions;
  limitations: string[];
}

/** Policy inputs the baseline actually consumes. */
export interface BaselinePolicy {
  demandWindowMonths: number;
  planningHorizonDays: number;
  demandGrowthPct: number | null;
}

const VARIABILITY = { stableBelowPct: 25, volatileAbovePct: 60 };

export function observedVariability(buckets: DemandBucket[]): Variability | null {
  if (buckets.length < 3) return null;
  const values = buckets.map((b) => b.quantity);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return null;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cvPct = (Math.sqrt(variance) / mean) * 100;
  const label: VariabilityLabel =
    cvPct < VARIABILITY.stableBelowPct
      ? "stable"
      : cvPct > VARIABILITY.volatileAbovePct
        ? "volatile"
        : "variable";
  return { cvPct: Math.round(cvPct * 10) / 10, label, thresholds: VARIABILITY };
}

/** How many buckets of `grain` a window of months corresponds to. */
export function periodsForMonths(months: number, grain: TimeGrain): number {
  return Math.max(1, Math.round(months / MONTHS_PER_PERIOD[grain]));
}

export function computeBaseline(
  buckets: DemandBucket[],
  coverage: SeriesCoverage,
  policy: BaselinePolicy,
): DemandBaseline {
  const grain = coverage.grain;
  const periodsRequested = periodsForMonths(policy.demandWindowMonths, grain);
  const window = buckets.slice(-periodsRequested);
  const periodsUsed = window.length;
  const horizonPeriods =
    Math.round((policy.planningHorizonDays / DAYS_PER_PERIOD[grain]) * 100) / 100;
  const growthPct = policy.demandGrowthPct ?? 0;

  const assumptions: BaselineAssumptions = {
    method: "trailing_average",
    grain,
    demandWindowMonths: policy.demandWindowMonths,
    periodsRequested,
    periodsUsed,
    windowFrom: window[0]?.period ?? null,
    windowTo: window[window.length - 1]?.period ?? null,
    growthPct,
    growthApplied: growthPct !== 0,
    planningHorizonDays: policy.planningHorizonDays,
    horizonPeriods,
  };

  const limitations: string[] = [];
  if (coverage.note) limitations.push(coverage.note);

  // Two observations is the minimum that can describe a trend at all. Below
  // that no baseline is produced rather than projecting a single period.
  if (periodsUsed < 2) {
    limitations.push(
      periodsUsed === 0
        ? "No demand history is available for this selection, so no baseline can be produced."
        : "Only one historical period is available. At least two are required before a baseline is produced.",
    );
    return {
      sufficient: false,
      perPeriod: null,
      plannedPerPeriod: null,
      plannedTotal: null,
      historicalTotal: window.reduce((s, b) => s + b.quantity, 0),
      variability: null,
      assumptions,
      limitations,
    };
  }

  if (periodsUsed < periodsRequested) {
    limitations.push(
      `The policy asks for ${policy.demandWindowMonths} months of history (${periodsRequested} ${grain} periods) but only ${periodsUsed} are available. The average uses what exists.`,
    );
  }

  const historicalTotal = window.reduce((s, b) => s + b.quantity, 0);
  const perPeriod = historicalTotal / periodsUsed;
  const plannedPerPeriod = perPeriod * (1 + growthPct / 100);

  return {
    sufficient: true,
    perPeriod: Math.round(perPeriod * 100) / 100,
    plannedPerPeriod: Math.round(plannedPerPeriod * 100) / 100,
    plannedTotal: Math.round(plannedPerPeriod * horizonPeriods * 100) / 100,
    historicalTotal,
    variability: observedVariability(window),
    assumptions,
    limitations,
  };
}

/** Projected buckets following the last historical period, for charting. */
export function projectionPoints(
  baseline: DemandBaseline,
  lastPeriod: string | null,
  grain: TimeGrain,
  count: number,
): { period: string; planned: number }[] {
  if (!baseline.sufficient || baseline.plannedPerPeriod == null || !lastPeriod) return [];
  const points: { period: string; planned: number }[] = [];
  const d = new Date(`${lastPeriod}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    switch (grain) {
      case "day":
        d.setUTCDate(d.getUTCDate() + 1);
        break;
      case "week":
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case "month":
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case "quarter":
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case "year":
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
    }
    points.push({ period: d.toISOString().slice(0, 10), planned: baseline.plannedPerPeriod });
  }
  return points;
}