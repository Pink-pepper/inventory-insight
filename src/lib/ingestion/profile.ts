import { cell, type SheetTable } from "./sheet-table";
import { headerKey } from "./mapping";
import { isMissingToken, parseDate } from "./validate";

/**
 * Column profiling: what the VALUES in each column look like, independent of
 * the header text. Classification combines both signals, so a "Data" sheet
 * with cryptic headers can still be recognised from its content.
 */

export type ColumnType = "date" | "number" | "identifier" | "boolean" | "text" | "empty";

export interface ColumnProfile {
  index: number;
  header: string;
  /** Normalised header, comparable with alias keys. */
  key: string;
  type: ColumnType;
  /** Share of non-empty sampled cells matching the dominant type (0..1). */
  dominance: number;
  /** Non-empty cells in the sample. */
  nonEmpty: number;
  /** Distinct values seen (capped). */
  distinct: number;
  /** distinct / nonEmpty — near 1 for keys, low for categories. */
  uniqueRatio: number;
  /** Shared letter prefix of identifier values ("SKU", "CUS"), when consistent. */
  idPrefix: string | null;
  /** Share of numeric values below zero — consumption/adjustment signal. */
  negativeShare: number;
  /** Values are month-period shaped (2026-09, Sep-2026) rather than day dates. */
  monthStyle: boolean;
  /** Values look like ranges ("14–45", "10-35%") — never collapsed to a scalar. */
  rangeLike: boolean;
  /** Dominant values are qualitative words (low/moderate/high…). */
  qualitative: boolean;
  /** Up to 5 example values. */
  samples: string[];
}

const SAMPLE_ROWS = 500;
const DISTINCT_CAP = 10_000;

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}/,
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
  new RegExp(`^\\d{1,2}[- ]${MONTH}[a-z]*[- ]\\d{2,4}$`, "i"),
  new RegExp(`^${MONTH}[a-z]* \\d{1,2},? \\d{4}$`, "i"),
  new RegExp(`^${MONTH}[a-z]*[- /]\\d{4}$`, "i"),
  /^\d{4}[-/]\d{1,2}$/,
];

/** Month-period shapes only: "2026-09", "Sep-2026", "Sep 2026". */
const MONTH_PERIOD_PATTERNS = [
  /^\d{4}[-/]\d{1,2}$/,
  new RegExp(`^${MONTH}[a-z]*[- /]\\d{4}$`, "i"),
  new RegExp(`^\\d{4}[- ]${MONTH}[a-z]*$`, "i"),
];

/** Textual date shapes only — bare numbers are quantities until a header says otherwise. */
export function looksLikeDateString(value: string): boolean {
  const v = value.trim();
  return DATE_PATTERNS.some((p) => p.test(v));
}

/** True when a value is a month-period without a day component. */
export function looksLikeMonthPeriod(value: string): boolean {
  const v = value.trim();
  return MONTH_PERIOD_PATTERNS.some((p) => p.test(v));
}

export function looksLikeNumber(value: string): boolean {
  const t = value.trim();
  if (!/[0-9]/.test(t)) return false;
  const negated = /^\((.*)\)$/.exec(t);
  const inner = negated ? negated[1]! : t;
  const body = inner.replace(/[^0-9eE+\-.]/g, "");
  if (body === "" || body === "-" || body === ".") return false;
  // Stripping must preserve most of the cell: "SKU-0001" leaving "0001"
  // behind is an identifier, not a number.
  if (body.length / inner.trim().length < 0.7) return false;
  return Number.isFinite(Number(body));
}

/**
 * Ranges and tolerances: "14–45", "10-35%", "±5", "4–8x", "18 to 60".
 * A plain negative number is NOT a range.
 */
export function looksLikeRange(value: string): boolean {
  const v = value.trim();
  if (/^±/.test(v)) return true;
  if (/^\d+(\.\d+)?\s*(to|–|—|\.\.)\s*\d+(\.\d+)?\s*(%|x|days?|months?|weeks?)?$/i.test(v)) return true;
  // "14-45" style only when clearly two magnitudes, not a date or negative.
  if (/^\d+(\.\d+)?-\d+(\.\d+)?\s*(%|x)?$/.test(v) && !looksLikeDateString(v)) return true;
  return false;
}

const QUALITATIVE_TOKENS = new Set([
  "low", "moderate", "medium", "high", "very_low", "very_high", "aggressive",
  "conservative", "slow", "fast", "stable", "volatile", "seasonal",
]);

export function isQualitative(value: string): boolean {
  return QUALITATIVE_TOKENS.has(value.trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

/** Coded identifiers: letters plus digits, no spaces — SKU-0001, CUS-042, PO1002. */
const ID_PATTERN = /^[A-Za-z]{1,8}[-_./]?\d[\dA-Za-z]*$/;

function idPrefixOf(value: string): string | null {
  const m = /^([A-Za-z]{1,8})[-_./]?\d/.exec(value.trim());
  return m ? m[1]!.toUpperCase() : null;
}

const BOOLEAN_TOKENS = new Set(["yes", "no", "true", "false", "y", "n"]);

/** Profiles every column of a sheet from a bounded row sample. */
export function profileSheet(sheet: SheetTable): ColumnProfile[] {
  const rows = sheet.rows.slice(0, SAMPLE_ROWS);
  return sheet.headers.map((header, index) => {
    const counts: Record<Exclude<ColumnType, "empty">, number> = {
      date: 0,
      number: 0,
      identifier: 0,
      boolean: 0,
      text: 0,
    };
    const distinct = new Set<string>();
    const prefixes = new Map<string, number>();
    let nonEmpty = 0;
    let numericCount = 0;
    let negativeCount = 0;
    let dateCount = 0;
    let monthPeriodCount = 0;
    let rangeCount = 0;
    let qualitativeCount = 0;

    for (const row of rows) {
      const v = cell(row, index).trim();
      if (v === "" || isMissingToken(v)) continue;
      nonEmpty++;
      if (distinct.size < DISTINCT_CAP) distinct.add(v);
      if (BOOLEAN_TOKENS.has(v.toLowerCase())) {
        counts.boolean++;
      } else if (looksLikeDateString(v)) {
        counts.date++;
        dateCount++;
        if (looksLikeMonthPeriod(v)) monthPeriodCount++;
      } else if (ID_PATTERN.test(v) && !looksLikeNumber(v)) {
        counts.identifier++;
        const prefix = idPrefixOf(v);
        if (prefix) prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
      } else if (looksLikeNumber(v)) {
        counts.number++;
        numericCount++;
        if (parseDate(v) && /^\d+(\.\d+)?$/.test(v)) {
          // Bare Excel serial — still numeric for our purposes.
        }
        const parsed = Number(v.replace(/[^0-9eE+\-.]/g, ""));
        if (Number.isFinite(parsed) && (parsed < 0 || /^\(.*\)$/.test(v))) negativeCount++;
      } else if (looksLikeRange(v)) {
        counts.text++;
        rangeCount++;
      } else {
        counts.text++;
        if (isQualitative(v)) qualitativeCount++;
      }
    }

    const [dominantType, dominantCount] = (Object.entries(counts) as [ColumnType, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0] ?? ["text", 0];
    const topPrefix = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      index,
      header,
      key: headerKey(header),
      type: nonEmpty === 0 ? "empty" : dominantType,
      dominance: nonEmpty === 0 ? 0 : dominantCount / nonEmpty,
      nonEmpty,
      distinct: distinct.size,
      uniqueRatio: nonEmpty === 0 ? 0 : distinct.size / nonEmpty,
      idPrefix:
        dominantType === "identifier" && topPrefix && nonEmpty > 0 && topPrefix[1] / nonEmpty >= 0.6
          ? topPrefix[0]
          : null,
      negativeShare: numericCount === 0 ? 0 : negativeCount / numericCount,
      monthStyle: dateCount > 0 && monthPeriodCount / dateCount >= 0.6,
      rangeLike: nonEmpty > 0 && rangeCount / nonEmpty >= 0.3,
      qualitative: nonEmpty > 0 && qualitativeCount / nonEmpty >= 0.5,
      samples: [...distinct].slice(0, 5),
    };
  });
}
