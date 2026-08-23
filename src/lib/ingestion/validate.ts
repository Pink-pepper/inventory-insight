import { LIMITS } from "./sheet-table";
import type { IngestionIssue, IssueSeverity } from "@/lib/connectors/types";

/** Where a problem was found, so the report can be grouped meaningfully. */
export interface ScopedIssue extends IngestionIssue {
  sheet: string | null;
}

/** Bounded issue collector: a pathological file cannot grow the report without limit. */
export class IssueLog {
  private items: ScopedIssue[] = [];
  warnings = 0;
  errors = 0;

  add(sheet: string | null, row: number, field: string, message: string, severity: IssueSeverity) {
    if (severity === "warning") this.warnings++;
    else this.errors++;
    if (this.items.length < LIMITS.maxIssues) this.items.push({ sheet, row, field, message, severity });
  }

  list(): ScopedIssue[] {
    return this.items;
  }
}

/** Trims a free-text cell to a storable length and strips control characters. */
export function safeText(value: string | undefined, fallback = ""): string {
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned === "" ? fallback : cleaned).slice(0, LIMITS.maxText);
}

/** Parses a numeric cell, distinguishing "absent" from "not a number". */
export function parseNumber(value: string | undefined): { value: number | null; malformed: boolean } {
  if (value == null || value.trim() === "") return { value: null, malformed: false };
  const raw = value.trim();
  // Accounting negatives: (1,234.00) means -1234
  const negated = /^\((.*)\)$/.exec(raw);
  const body = (negated ? negated[1]! : raw).replace(/[^0-9eE+\-.]/g, "");
  if (body === "" || body === "-" || body === ".") return { value: null, malformed: true };
  const parsed = Number(body);
  if (!Number.isFinite(parsed)) return { value: null, malformed: true };
  return { value: negated ? -parsed : parsed, malformed: false };
}

/** True when a numeric value exceeds the supported storage magnitude. */
export function outOfRange(value: number | null): boolean {
  return value != null && Math.abs(value) > LIMITS.maxNumber;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Parses a date cell to an ISO date. Accepts ISO strings, common written
 * dates and Excel serial numbers. Ambiguous or unparseable input returns null
 * rather than a guess.
 */
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v === "" || MISSING_TOKENS.has(v.toLowerCase())) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return isoOrNull(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Excel stores dates as a day count from 1899-12-30.
  if (/^\d+(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    if (serial >= 1 && serial <= 400_000) {
      return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
    }
    return null;
  }

  // Written month names: "23-Aug-26", "23 Aug 2026", "Aug 23 2026".
  const dMon = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2,4})$/.exec(v);
  if (dMon) {
    const month = MONTH_NAMES[dMon[2]!.slice(0, 3).toLowerCase()];
    if (month) {
      const year = Number(dMon[3]!.length === 2 ? `20${dMon[3]}` : dMon[3]);
      return isoOrNull(year, month, Number(dMon[1]));
    }
  }

  // dd/mm/yyyy and dd-mm-yyyy. Day-first is the convention outside the US and
  // is applied consistently rather than sniffed per row.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(v);
  if (dmy) {
    const year = Number(dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]);
    return isoOrNull(year, Number(dmy[2]), Number(dmy[1]));
  }

  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function isoOrNull(year: number, month: number, day: number): string | null {
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Buckets an ISO date to the first day of its month. */
export function monthOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** ISO 4217-shaped currency code, or null when the cell is not a currency code. */
export function parseCurrency(value: string | undefined): string | null {
  const v = safeText(value).toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

/**
 * Stable, order-independent fingerprint of a transaction's business fields.
 * Used for re-import detection and provenance — never to silently discard
 * genuinely distinct rows.
 */
export function rowHash(parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => (p == null ? "" : String(p))).join("\u0001");
  // FNV-1a, 64-bit via two 32-bit lanes. Deterministic and dependency-free.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}