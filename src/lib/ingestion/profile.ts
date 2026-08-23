import { cell, type SheetTable } from "./sheet-table";
import { headerKey } from "./mapping";
import { isMissingToken } from "./validate";

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

/** Textual date shapes only — bare numbers are quantities until a header says otherwise. */
export function looksLikeDateString(value: string): boolean {
  const v = value.trim();
  return DATE_PATTERNS.some((p) => p.test(v));
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

    for (const row of rows) {
      const v = cell(row, index).trim();
      if (v === "" || isMissingToken(v)) continue;
      nonEmpty++;
      if (distinct.size < DISTINCT_CAP) distinct.add(v);
      if (BOOLEAN_TOKENS.has(v.toLowerCase())) {
        counts.boolean++;
      } else if (looksLikeDateString(v)) {
        counts.date++;
      } else if (ID_PATTERN.test(v) && !looksLikeNumber(v)) {
        counts.identifier++;
        const prefix = idPrefixOf(v);
        if (prefix) prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
      } else if (looksLikeNumber(v)) {
        counts.number++;
      } else {
        counts.text++;
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
      samples: [...distinct].slice(0, 5),
    };
  });
}
