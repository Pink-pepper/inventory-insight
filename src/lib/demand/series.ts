/**
 * Demand series construction.
 *
 * Pure functions over demand facts. No React, no Supabase. Facts are never
 * invented and never split: a monthly fact stays a monthly fact, so day and
 * week grains are only produced when day-grain transactions actually exist.
 */
import { bucketStart, type TimeGrain } from "@/lib/domain/time-grain";

export type DemandSource = "transactions" | "monthly";

/** One demand observation, already flattened out of storage. */
export interface DemandFact {
  sku: string;
  name: string;
  category: string;
  supplierCode: string;
  supplierName: string;
  /** ISO date of the observation. Monthly facts carry the first of the month. */
  date: string;
  quantity: number;
  revenue: number | null;
  cogs: number | null;
  channelCode: string | null;
  channelName: string | null;
  customerRef: string | null;
  customerName: string | null;
  locationCode: string | null;
  locationName: string | null;
  region: string | null;
  stateProvince: string | null;
  country: string | null;
  source: DemandSource;
}

export interface DemandBucket {
  /** ISO date of the bucket start. */
  period: string;
  quantity: number;
  revenue: number | null;
  cogs: number | null;
}

export interface SeriesCoverage {
  requestedGrain: TimeGrain;
  /** The grain actually used. Differs from the request only on a downgrade. */
  grain: TimeGrain;
  source: DemandSource | null;
  downgraded: boolean;
  /** Plain-language reason for a downgrade or for an empty series. */
  note: string | null;
  periods: number;
  firstPeriod: string | null;
  lastPeriod: string | null;
}

export interface DemandSeries {
  buckets: DemandBucket[];
  coverage: SeriesCoverage;
  /** The facts that produced the series, after source selection. */
  facts: DemandFact[];
}

const DAY_GRAINS: TimeGrain[] = ["day", "week"];

export function bucketise(facts: DemandFact[], grain: TimeGrain): DemandBucket[] {
  const map = new Map<string, DemandBucket>();
  for (const f of facts) {
    const period = bucketStart(f.date, grain);
    const current = map.get(period) ?? { period, quantity: 0, revenue: null, cogs: null };
    current.quantity += f.quantity;
    if (f.revenue != null) current.revenue = (current.revenue ?? 0) + f.revenue;
    if (f.cogs != null) current.cogs = (current.cogs ?? 0) + f.cogs;
    map.set(period, current);
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Chooses the only defensible source for the requested grain and buckets it.
 * Monthly facts are never distributed across days or weeks to satisfy a finer
 * grain — the grain is downgraded and the reason is reported instead.
 */
export function buildSeries(facts: DemandFact[], requestedGrain: TimeGrain): DemandSeries {
  const transactions = facts.filter((f) => f.source === "transactions");
  const monthly = facts.filter((f) => f.source === "monthly");

  let grain = requestedGrain;
  let source: DemandSource | null = null;
  let used: DemandFact[] = [];
  let note: string | null = null;
  let downgraded = false;

  if (DAY_GRAINS.includes(requestedGrain)) {
    if (transactions.length > 0) {
      source = "transactions";
      used = transactions;
    } else if (monthly.length > 0) {
      grain = "month";
      source = "monthly";
      used = monthly;
      downgraded = true;
      note =
        `No day-grain transactions match this selection, so ${requestedGrain} demand cannot be measured. ` +
        "The series falls back to the stored monthly demand; monthly totals are not split into shorter periods.";
    }
  } else if (monthly.length > 0) {
    source = "monthly";
    used = monthly;
  } else if (transactions.length > 0) {
    source = "transactions";
    used = transactions;
  }

  if (used.length === 0) {
    return {
      buckets: [],
      facts: [],
      coverage: {
        requestedGrain,
        grain: requestedGrain,
        source: null,
        downgraded: false,
        note: "No demand history matches the current filters.",
        periods: 0,
        firstPeriod: null,
        lastPeriod: null,
      },
    };
  }

  const buckets = bucketise(used, grain);
  return {
    buckets,
    facts: used,
    coverage: {
      requestedGrain,
      grain,
      source,
      downgraded,
      note,
      periods: buckets.length,
      firstPeriod: buckets[0]?.period ?? null,
      lastPeriod: buckets[buckets.length - 1]?.period ?? null,
    },
  };
}

/** Total demand across a set of buckets. */
export const totalQuantity = (buckets: DemandBucket[]) =>
  buckets.reduce((sum, b) => sum + b.quantity, 0);

export const totalRevenue = (buckets: DemandBucket[]) =>
  buckets.reduce<number | null>(
    (sum, b) => (b.revenue == null ? sum : (sum ?? 0) + b.revenue),
    null,
  );