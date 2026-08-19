/**
 * Time-grain utilities.
 *
 * No derived period data is stored: buckets and comparison windows are always
 * computed from a date. Shared by any future planning service so day / week /
 * month / quarter / year analysis stays consistent.
 */

export type TimeGrain = "day" | "week" | "month" | "quarter" | "year";

export interface DateRange {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, inclusive. */
  to: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const parse = (date: string) => new Date(`${date.slice(0, 10)}T00:00:00Z`);

/** Start of the bucket a date falls into, as an ISO date. */
export function bucketStart(date: string, grain: TimeGrain): string {
  const d = parse(date);
  switch (grain) {
    case "day":
      return iso(d);
    case "week": {
      // ISO week: Monday start.
      const day = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - day);
      return iso(d);
    }
    case "month":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case "quarter":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
    case "year":
      return iso(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
  }
}

/** End of the bucket a date falls into, inclusive. */
export function bucketEnd(date: string, grain: TimeGrain): string {
  const start = parse(bucketStart(date, grain));
  switch (grain) {
    case "day":
      return iso(start);
    case "week":
      start.setUTCDate(start.getUTCDate() + 6);
      return iso(start);
    case "month":
      return iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)));
    case "quarter":
      return iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0)));
    case "year":
      return iso(new Date(Date.UTC(start.getUTCFullYear(), 11, 31)));
  }
}

export function bucketRange(date: string, grain: TimeGrain): DateRange {
  return { from: bucketStart(date, grain), to: bucketEnd(date, grain) };
}

/** Shifts a range back by whole periods — the basis for YoY / QoQ / MoM / WoW. */
export function shiftRange(range: DateRange, grain: TimeGrain, periods = 1): DateRange {
  const shift = (value: string) => {
    const d = parse(value);
    switch (grain) {
      case "day":
        d.setUTCDate(d.getUTCDate() - periods);
        break;
      case "week":
        d.setUTCDate(d.getUTCDate() - periods * 7);
        break;
      case "month":
        d.setUTCMonth(d.getUTCMonth() - periods);
        break;
      case "quarter":
        d.setUTCMonth(d.getUTCMonth() - periods * 3);
        break;
      case "year":
        d.setUTCFullYear(d.getUTCFullYear() - periods);
        break;
    }
    return iso(d);
  };
  return { from: shift(range.from), to: shift(range.to) };
}

/** The comparison window for a range: previous period at the same grain. */
export function comparisonRange(range: DateRange, grain: TimeGrain): DateRange {
  return shiftRange(range, grain, 1);
}

/** Same window one year earlier, whatever the grain. */
export function yearOverYearRange(range: DateRange): DateRange {
  return shiftRange(range, "year", 1);
}

/** Percentage change between two comparable totals; null when there is no base. */
export function periodChangePct(current: number, prior: number): number | null {
  if (!prior) return null;
  return ((current - prior) / prior) * 100;
}