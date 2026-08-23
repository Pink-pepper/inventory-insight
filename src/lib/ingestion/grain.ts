import { cell, type SheetTable } from "./sheet-table";
import type { ColumnProfile } from "./profile";
import { parseDate } from "./validate";

/**
 * Dataset grain inference: what ONE ROW of a sheet represents.
 *
 * The same columns (SKU + date + quantity) appear in sales transactions,
 * monthly aggregates, inventory snapshots, consumption logs and forecasts.
 * Grain disambiguates them using identifier cardinality, date frequency and
 * duplication patterns — not headers or sheet names.
 */

export type Grain =
  | "master" // one row per entity (product, customer, …)
  | "transaction" // day-grain event lines
  | "periodic" // one row per entity per period (aggregate or forecast)
  | "snapshot" // state at one or few points in time
  | "series" // dated rows per entity, repetition unknown
  | "freeform" // parameter lists, notes, unstructured rows
  | "unknown";

export interface GrainInfo {
  grain: Grain;
  /** Plain-language row meaning, e.g. "one row per SKU and month". */
  key: string;
  /** Day-level dates, month-period values, or no usable date column. */
  periodStyle: "day" | "month" | "none";
  distinctPeriods: number;
  /** Share of parsed periods strictly after the current month (null if undated). */
  futureShare: number | null;
  /** Share of identifier+period key combinations that repeat. */
  duplicateKeyShare: number;
}

const MAX_SCAN = 20_000;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** The most identifier-like column: dominant identifier type, then low-unique text codes. */
export function primaryIdentifier(profile: ColumnProfile[]): ColumnProfile | null {
  const candidates = profile.filter(
    (c) => c.nonEmpty >= 3 && (c.type === "identifier" || (c.type === "text" && c.idPrefix)),
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.dominance - a.dominance || b.nonEmpty - a.nonEmpty)[0]!;
}

/** The most date-like column, preferring dominant typed columns. */
export function primaryDate(profile: ColumnProfile[]): ColumnProfile | null {
  const candidates = profile.filter((c) => c.type === "date" && c.dominance >= 0.6 && c.nonEmpty >= 3);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.dominance - a.dominance || b.nonEmpty - a.nonEmpty)[0]!;
}

/** Infers the grain of a sheet from its profile and values. */
export function inferGrain(sheet: SheetTable, profile: ColumnProfile[]): GrainInfo {
  const idCol = primaryIdentifier(profile);
  const dateCol = primaryDate(profile);

  const none: GrainInfo = {
    grain: "unknown",
    key: "row meaning unclear",
    periodStyle: "none",
    distinctPeriods: 0,
    futureShare: null,
    duplicateKeyShare: 0,
  };
  if (sheet.rows.length === 0) return none;

  if (!dateCol) {
    if (idCol) {
      return {
        grain: idCol.uniqueRatio >= 0.98 ? "master" : "freeform",
        key:
          idCol.uniqueRatio >= 0.98
            ? `one row per ${idCol.header || "entity"}`
            : `repeated ${idCol.header || "identifier"} values without a date`,
        periodStyle: "none",
        distinctPeriods: 0,
        futureShare: null,
        duplicateKeyShare: idCol.uniqueRatio >= 0.98 ? 0 : 1 - idCol.uniqueRatio,
      };
    }
    return { ...none, grain: "freeform", key: "no identifier or date column" };
  }

  // Parse the date column once; classify periods and duplicates.
  const months = new Set<string>();
  const days = new Set<string>();
  const keys = new Set<string>();
  let parsed = 0;
  let future = 0;
  let duplicateKeys = 0;
  const now = currentMonth();

  for (const row of sheet.rows.slice(0, MAX_SCAN)) {
    const iso = parseDate(cell(row, dateCol.index));
    if (!iso) continue;
    parsed++;
    const month = iso.slice(0, 7);
    months.add(month);
    days.add(iso);
    if (month > now) future++;
    if (idCol) {
      const id = cell(row, idCol.index).trim().toUpperCase();
      if (id !== "") {
        const key = `${id}|${dateCol.monthStyle ? month : iso}`;
        if (keys.has(key)) duplicateKeys++;
        else keys.add(key);
      }
    }
  }

  if (parsed < 3) {
    return idCol
      ? { ...none, grain: "freeform", key: `date column '${dateCol.header}' mostly unparseable` }
      : none;
  }

  const futureShare = future / parsed;
  const duplicateKeyShare = keys.size === 0 ? 0 : duplicateKeys / (keys.size + duplicateKeys);
  const periodStyle: GrainInfo["periodStyle"] = dateCol.monthStyle ? "month" : "day";
  const idLabel = idCol?.header || "entity";
  const periodLabel = periodStyle === "month" ? "month" : "date";

  // Snapshot: very few distinct dates relative to row volume.
  if (days.size <= 3 && sheet.rows.length >= days.size * 2) {
    return {
      grain: "snapshot",
      key: `state at ${days.size === 1 ? "a single date" : `${days.size} dates`} per ${idLabel}`,
      periodStyle,
      distinctPeriods: months.size,
      futureShare,
      duplicateKeyShare,
    };
  }

  if (periodStyle === "month" || days.size <= months.size * 2) {
    return {
      grain: "periodic",
      key: `one row per ${idLabel} and ${periodLabel}${duplicateKeyShare > 0.05 ? " (with duplicates)" : ""}`,
      periodStyle: "month",
      distinctPeriods: months.size,
      futureShare,
      duplicateKeyShare,
    };
  }

  if (idCol) {
    return {
      grain: duplicateKeyShare >= 0.5 ? "transaction" : "series",
      key: `dated rows per ${idLabel}${duplicateKeyShare >= 0.5 ? ", many sharing a date" : ""}`,
      periodStyle: "day",
      distinctPeriods: months.size,
      futureShare,
      duplicateKeyShare,
    };
  }

  return {
    grain: "series",
    key: "dated rows",
    periodStyle: "day",
    distinctPeriods: months.size,
    futureShare,
    duplicateKeyShare,
  };
}

export type TimeOrientation = "historical" | "current_state" | "forward" | "policy" | "not_dated";

/** Time orientation from grain signals: where the data sits relative to today. */
export function orientationOf(grain: GrainInfo, kind: string): TimeOrientation {
  if (kind === "planning_policy") return "policy";
  if (grain.futureShare == null) return "not_dated";
  if (grain.futureShare >= 0.6) return "forward";
  if (grain.grain === "snapshot") return "current_state";
  if (grain.futureShare <= 0.05) return "historical";
  return "historical";
}
