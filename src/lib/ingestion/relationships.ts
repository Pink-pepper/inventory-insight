import { cell, type SheetTable } from "./sheet-table";
import type { ColumnProfile } from "./profile";

/**
 * Cross-sheet relationship detection: identifier columns in one sheet whose
 * values live in a key column of another sheet reveal foreign keys even when
 * the header is unhelpful ("Code", "Ref", column B).
 */

export interface KeySet {
  sheetName: string;
  /** Canonical field the key column maps to (sku, customer_ref, ...). */
  field: string;
  header: string;
  values: Set<string>;
}

export interface RelationshipFinding {
  sheetName: string;
  column: number;
  header: string;
  /** Canonical field assigned to the column. */
  field: string;
  /** Key set that supplied the match. */
  matchesSheet: string;
  matchesField: string;
  matchesHeader: string;
  /** Share of the column's distinct values found in the key set (0..1). */
  overlap: number;
  /** Plain-language explanation for the review UI. */
  description: string;
}

const MAX_KEY_VALUES = 20_000;

export function normaliseKey(value: string): string {
  return value.trim().toUpperCase();
}

/** Collects the values of one column, bounded. */
export function columnValues(sheet: SheetTable, column: number, cap = MAX_KEY_VALUES): Set<string> {
  const out = new Set<string>();
  for (const row of sheet.rows) {
    const v = normaliseKey(cell(row, column));
    if (v !== "") {
      out.add(v);
      if (out.size >= cap) break;
    }
  }
  return out;
}

/**
 * Finds unmapped identifier-ish columns whose values overlap a master key set.
 * A column is linked when at least 30% (and at least 3) of its distinct values
 * appear in the key set — strong evidence it references that master.
 */
export function findRelationships(
  sheet: SheetTable,
  profile: ColumnProfile[],
  alreadyMapped: Set<number>,
  keySets: KeySet[],
): RelationshipFinding[] {
  const findings: RelationshipFinding[] = [];
  for (const col of profile) {
    if (alreadyMapped.has(col.index)) continue;
    if (col.header.trim() === "" || col.nonEmpty === 0) continue;
    if (col.type !== "identifier" && !(col.type === "text" && col.idPrefix)) continue;

    const values = columnValues(sheet, col.index, 5_000);
    if (values.size < 3) continue;

    let best: { set: KeySet; hits: number } | null = null;
    for (const set of keySets) {
      if (set.sheetName === sheet.sheetName) continue;
      let hits = 0;
      for (const v of values) if (set.values.has(v)) hits++;
      if (hits >= 3 && (!best || hits > best.hits)) best = { set, hits };
    }
    if (!best) continue;
    const overlap = best.hits / values.size;
    if (overlap < 0.3) continue;

    findings.push({
      sheetName: sheet.sheetName,
      column: col.index,
      header: col.header,
      field: best.set.field,
      matchesSheet: best.set.sheetName,
      matchesField: best.set.field,
      matchesHeader: best.set.header,
      overlap,
      description: `'${col.header}' shares ${Math.round(overlap * 100)}% of its values with '${best.set.header}' in sheet '${best.set.sheetName}'`,
    });
  }
  return findings;
}

/** Overlap between two (key) sets as a share of the smaller set. */
export function keyOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hits = 0;
  for (const v of small) if (large.has(v)) hits++;
  return hits / small.size;
}
