import {
  ENTITY_DEFINITIONS,
  FIELD_ALIASES,
  definitionFor,
  type ColumnMapping,
  type EntityDefinition,
  type EntityKind,
} from "./mapping";
import { profileSheet, type ColumnProfile, type ColumnType } from "./profile";
import { cell, type SheetTable } from "./sheet-table";
import {
  columnValues,
  findRelationships,
  keyOverlap,
  normaliseKey,
  type KeySet,
} from "./relationships";
import { parseDate } from "./validate";

/**
 * Workbook classification: decides what each sheet most likely contains, maps
 * its columns to canonical fields, detects cross-sheet relationships and
 * duplicate sources, and assigns a disposition so the UI can auto-approve the
 * obvious sheets and surface only genuine exceptions.
 */

export type DataRole =
  | "master"
  | "transactional"
  | "aggregate"
  | "snapshot"
  | "mixed"
  | "contextual"
  | "unknown";

export type MappingConfidence = "high" | "medium" | "low" | "unresolved";

/** auto: pre-approved · review: complete but needs a glance · blocked: required
 *  columns missing · ignored: reference/notes, excluded. */
export type Disposition = "auto" | "review" | "blocked" | "ignored";

export interface SheetClassification {
  sheetName: string;
  kind: EntityKind;
  role: DataRole;
  confidence: MappingConfidence;
  mapping: ColumnMapping;
  /** Per-field evidence, e.g. "'Invoice Date' → transaction date (date values)". */
  fieldReasons: string[];
  /** Plain-language verdict for the sheet as a whole. */
  reason: string;
  unmappedHeaders: string[];
  missingRequired: string[];
  relationships: string[];
  /** Name of a richer sheet covering the same data (duplicate source). */
  duplicateSource: string | null;
  disposition: Disposition;
  rowCount: number;
}

export interface WorkbookAnalysis {
  sheets: SheetClassification[];
  summary: { total: number; auto: number; review: number; blocked: number; ignored: number };
  /** Records per detected entity (auto + review sheets). */
  entities: { kind: EntityKind; label: string; records: number }[];
  /** Distinct demand months visible across detected demand sheets. */
  demandMonths: number;
}

const ROLE_BY_KIND: Partial<Record<EntityKind, DataRole>> = {
  products: "master",
  suppliers: "master",
  customers: "master",
  channels: "master",
  inventory: "snapshot",
  transactions: "transactional",
  purchase_orders: "transactional",
  sales_monthly: "aggregate",
  combined: "mixed",
};

const DATE_FIELDS = new Set(["as_of", "month", "transaction_date", "ordered_at", "expected_at", "received_at"]);
const NUMERIC_FIELDS = new Set([
  "unit_cost", "unit_price", "lead_time_days", "moq", "reliability", "safety_stock_days",
  "on_hand", "on_order", "units_sold", "revenue", "cogs", "quantity",
  "original_amount", "received_quantity",
]);
const ID_FIELDS = new Set(["sku", "supplier_code", "customer_ref", "channel_code", "po_ref", "source_ref"]);

const FIELD_LABEL: Record<string, string> = {
  sku: "SKU",
  product_name: "product name",
  category: "category",
  unit_cost: "unit cost",
  unit_price: "unit price",
  supplier_name: "supplier name",
  supplier_code: "supplier code",
  lead_time_days: "lead time",
  moq: "minimum order quantity",
  reliability: "reliability",
  safety_stock_days: "safety stock days",
  on_hand: "stock on hand",
  on_order: "stock on order",
  as_of: "snapshot date",
  location: "location",
  region: "region",
  state_province: "state/province",
  country: "country",
  month: "month",
  units_sold: "units sold",
  revenue: "revenue",
  cogs: "COGS",
  transaction_date: "transaction date",
  quantity: "quantity",
  customer_ref: "customer reference",
  customer_name: "customer name",
  segment: "segment",
  channel_code: "channel code",
  channel_name: "channel name",
  currency_code: "currency",
  original_amount: "original amount",
  source_ref: "source reference",
  po_ref: "PO number",
  po_status: "PO status",
  approval_status: "approval status",
  ordered_at: "order date",
  expected_at: "expected date",
  received_quantity: "received quantity",
  received_at: "received date",
  buyer: "buyer",
};

function typeAdjustment(field: string, type: ColumnType): number {
  if (type === "empty") return 0;
  if (DATE_FIELDS.has(field)) {
    if (type === "date") return 1;
    if (type === "number") return -0.5; // could be Excel serials
    return -2;
  }
  if (NUMERIC_FIELDS.has(field)) {
    if (type === "number") return 1;
    if (type === "date") return -2;
    return -1;
  }
  if (ID_FIELDS.has(field)) {
    if (type === "identifier") return 1;
    if (type === "text") return 0.5;
    if (type === "number") return -0.5; // numeric SKUs exist
    return -2;
  }
  // names / descriptive fields
  if (type === "text") return 1;
  if (type === "identifier") return 0.5;
  return -2;
}

function patternBonus(field: string, col: ColumnProfile): number {
  if (field === "currency_code") {
    return col.samples.length > 0 && col.samples.every((s) => /^[A-Za-z]{3}$/.test(s.trim())) ? 2 : 0;
  }
  if (field === "month") {
    return col.samples.some((s) => /^\d{4}[-/]\d{1,2}/.test(s.trim()) || /^[A-Za-z]{3,9}[- /]\d{4}$/.test(s.trim()))
      ? 1
      : 0;
  }
  if (field === "sku" && (col.idPrefix !== null || col.uniqueRatio >= 0.9)) return 1;
  if ((field === "customer_ref" || field === "supplier_code" || field === "channel_code" || field === "po_ref") && col.idPrefix)
    return 0.5;
  if (field === "reliability" && col.samples.every((s) => {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 1;
  })) return 1;
  return 0;
}

interface FieldMatch {
  field: string;
  column: number;
  header: string;
  tier: "high" | "medium";
  score: number;
  reason: string;
}

interface EntityScore {
  def: EntityDefinition;
  score: number;
  mapping: ColumnMapping;
  matches: FieldMatch[];
  missingRequired: string[];
}

/** Header evidence: 3 = exact canonical or alias, 1.5 = containment. Reverse
 *  containment (alias contains the header) requires a 5+ char header so bare
 *  "code"/"name"/"qty" never auto-map to a specific field. */
function headerScore(field: string, col: ColumnProfile): number {
  if (col.key === "") return 0;
  if (col.key === field) return 3;
  const aliases = aliasList(field);
  if (aliases.includes(col.key)) return 3;
  for (const alias of aliases) {
    if (alias.length >= 4 && col.key.includes(alias)) return 1.5;
    if (col.key.length >= 5 && alias.includes(col.key)) return 1.5;
  }
  return 0;
}

function aliasList(field: string): string[] {
  return FIELD_ALIASES[field] ?? [];
}

function scoreEntity(sheet: SheetTable, profile: ColumnProfile[], def: EntityDefinition): EntityScore {
  const fields = [...def.required, ...def.optional];
  const matches: FieldMatch[] = [];
  const usedColumns = new Set<number>();

  for (const field of fields) {
    let best: { col: ColumnProfile; header: number; total: number } | null = null;
    for (const col of profile) {
      if (col.header.trim() === "") continue;
      const hs = headerScore(field, col);
      if (hs < 1.5) continue;
      const total = hs + typeAdjustment(field, col.type) + patternBonus(field, col);
      if (!best || total > best.total) best = { col, header: hs, total };
    }
    if (!best || usedColumns.has(best.col.index)) continue;
    usedColumns.add(best.col.index);
    const conflict = typeAdjustment(field, best.col.type) <= -2;
    const tier: "high" | "medium" = best.header >= 3 && !conflict ? "high" : "medium";
    const evidence =
      DATE_FIELDS.has(field) && best.col.type === "date"
        ? "date values"
        : NUMERIC_FIELDS.has(field) && best.col.type === "number"
          ? "numeric values"
          : ID_FIELDS.has(field) && best.col.type === "identifier"
            ? "code values"
            : "header match";
    matches.push({
      field,
      column: best.col.index,
      header: best.col.header,
      tier,
      score: best.total,
      reason: `'${best.col.header}' → ${FIELD_LABEL[field] ?? field} (${evidence})`,
    });
  }

  const mapping: ColumnMapping = {};
  for (const m of matches) mapping[m.field] = m.column;
  const missingRequired = def.required.filter((f) => !(f in mapping));
  const matched = matches.reduce((sum, m) => sum + m.score, 0);
  const score = missingRequired.length > 0 ? 0 : matched + def.required.length * 2;
  return { def, score, mapping, matches, missingRequired };
}

function emptyClassification(sheet: SheetTable, reason: string): SheetClassification {
  return {
    sheetName: sheet.sheetName,
    kind: "ignored",
    role: "contextual",
    confidence: "unresolved",
    mapping: {},
    fieldReasons: [],
    reason,
    unmappedHeaders: [],
    missingRequired: [],
    relationships: [],
    duplicateSource: null,
    disposition: "ignored",
    rowCount: sheet.rowCount,
  };
}

const REASON_BY_KIND: Partial<Record<EntityKind, string>> = {
  products: "Item master: one row per product with descriptive and cost columns.",
  suppliers: "Supplier master: vendor names with ordering terms.",
  customers: "Customer master: account references and names.",
  channels: "Channel master: routes to market.",
  inventory: "Stock snapshot: quantities on hand/on order per SKU.",
  transactions: "Day-level sales lines: dates, quantities and identifiers.",
  purchase_orders: "Purchase order lines: SKUs, quantities and dates.",
  sales_monthly: "Monthly sales totals per SKU.",
  combined: "Combined product, stock and demand columns in one sheet.",
};

function monthSetOf(sheet: SheetTable, monthColumn: number, dateColumn: number | null): Set<string> {
  const out = new Set<string>();
  for (const row of sheet.rows.slice(0, 10_000)) {
    const raw = cell(row, monthColumn >= 0 ? monthColumn : (dateColumn ?? -1));
    const iso = parseDate(raw);
    if (iso) out.add(iso.slice(0, 7));
  }
  return out;
}

/** Full analysis of an upload: classify, link, de-duplicate, summarise. */
export function classifyWorkbook(sheets: SheetTable[]): WorkbookAnalysis {
  const profiles = sheets.map(profileSheet);

  // Pass 1 — independent classification of each sheet.
  const results = sheets.map((sheet, i) => {
    const profile = profiles[i]!;
    if (sheet.headers.length === 0 || sheet.rows.length === 0) {
      return emptyClassification(sheet, "The sheet is empty.");
    }

    const scored = ENTITY_DEFINITIONS.map((def) => scoreEntity(sheet, profile, def));
    const valid = scored.filter((s) => s.missingRequired.length === 0 && s.score > 0);

    // Combined only wins when it genuinely carries stock AND demand columns.
    const combined = valid.find((s) => s.def.kind === "combined");
    const combinedReal =
      combined && "on_hand" in combined.mapping && "units_sold" in combined.mapping && "month" in combined.mapping;
    const candidates = valid.filter((s) => s.def.kind !== "combined");
    if (combinedReal) candidates.push(combined!);

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (!best) {
      // Nothing fully recognised: find the nearest partial match, if any.
      const partial = scored
        .filter((s) => Object.keys(s.mapping).length >= 2)
        .sort((a, b) => Object.keys(b.mapping).length - Object.keys(a.mapping).length)[0];
      if (partial && partial.score === 0) {
        const kind = partial.def.kind;
        return {
          sheetName: sheet.sheetName,
          kind,
          role: ROLE_BY_KIND[kind] ?? "unknown",
          confidence: "low" as MappingConfidence,
          mapping: partial.mapping,
          fieldReasons: partial.matches.map((m) => m.reason),
          reason: `Partially recognised as ${partial.def.label.toLowerCase()}, but required columns are missing.`,
          unmappedHeaders: unmappedHeaders(sheet, partial.mapping),
          missingRequired: partial.missingRequired,
          relationships: [],
          duplicateSource: null,
          disposition: "blocked" as Disposition,
          rowCount: sheet.rowCount,
        };
      }
      // Contextual sheets: no dates or numeric measures — notes, instructions.
      const hasMeasure = profile.some((c) => c.type === "date" || c.type === "number");
      return emptyClassification(
        sheet,
        hasMeasure
          ? "No columns matched a known entity. Review the sample and map it manually if it belongs in the model."
          : "Looks like notes or reference material — no data columns were found. Excluded from the import.",
      );
    }

    const runnerUp = candidates[1];
    const allRequiredHigh = best.def.required.every(
      (f) => best.matches.find((m) => m.field === f)?.tier === "high",
    );
    const clearWinner = !runnerUp || best.score >= runnerUp.score * 1.25;
    const confidence: MappingConfidence = allRequiredHigh && clearWinner ? "high" : "medium";
    const kind = best.def.kind;

    return {
      sheetName: sheet.sheetName,
      kind,
      role: ROLE_BY_KIND[kind] ?? "unknown",
      confidence,
      mapping: best.mapping,
      fieldReasons: best.matches.map((m) => m.reason),
      reason: REASON_BY_KIND[kind] ?? best.def.description,
      unmappedHeaders: unmappedHeaders(sheet, best.mapping),
      missingRequired: [],
      relationships: [],
      duplicateSource: null,
      disposition: (confidence === "high" ? "auto" : "review") as Disposition,
      rowCount: sheet.rowCount,
    };
  });

  // Pass 2 — cross-sheet relationships. Master sheets contribute their key
  // columns; fact sheets get unmapped identifier columns resolved by overlap.
  const byName = new Map(sheets.map((s, i) => [s.sheetName, { sheet: s, profile: profiles[i]!, result: results[i]! }]));
  const keyFieldByKind: Partial<Record<EntityKind, string>> = {
    products: "sku",
    customers: "customer_ref",
    suppliers: "supplier_code",
    channels: "channel_code",
  };
  const keySets: KeySet[] = [];
  for (const { sheet, result } of byName.values()) {
    const keyField = keyFieldByKind[result.kind];
    if (!keyField || result.disposition === "ignored" || result.disposition === "blocked") continue;
    const colIndex = result.mapping[keyField];
    if (colIndex == null) continue;
    keySets.push({
      sheetName: sheet.sheetName,
      field: keyField,
      header: sheet.headers[colIndex] ?? "",
      values: columnValues(sheet, colIndex),
    });
  }

  const FACT_KINDS = new Set<EntityKind>(["transactions", "purchase_orders", "sales_monthly", "combined", "inventory"]);
  for (const { sheet, profile, result } of byName.values()) {
    if (!FACT_KINDS.has(result.kind) || result.disposition === "ignored") continue;
    const mappedColumns = new Set(Object.values(result.mapping));
    for (const rel of findRelationships(sheet, profile, mappedColumns, keySets)) {
      if (rel.field in result.mapping) continue;
      result.mapping[rel.field] = rel.column;
      result.relationships.push(rel.description);
      result.fieldReasons.push(`'${rel.header}' → ${FIELD_LABEL[rel.field] ?? rel.field} (values match '${rel.matchesSheet}')`);
      // A relationship-completed mapping is strong evidence but never silent:
      // a blocked sheet becomes reviewable, never auto-approved.
      if (result.disposition === "blocked") {
        const def = definitionFor(result.kind);
        if (def && def.required.every((f) => f in result.mapping)) {
          result.disposition = "review";
          result.missingRequired = [];
          result.reason = `Completed by linking columns to other sheets. ${result.reason}`;
        }
      }
    }
  }

  // Pass 3 — duplicate demand sources. When transaction lines cover the same
  // SKU-months as a monthly sheet, the monthly sheet is redundant: importing
  // both would double count demand.
  const txSheets = results.filter((r) => r.kind === "transactions" && r.disposition !== "ignored");
  const monthlySheets = results.filter((r) => r.kind === "sales_monthly" && r.disposition !== "ignored");
  if (txSheets.length > 0 && monthlySheets.length > 0) {
    const txKeys = new Set<string>();
    for (const tx of txSheets) {
      const entry = byName.get(tx.sheetName)!;
      const skuCol = tx.mapping.sku;
      const dateCol = tx.mapping.transaction_date;
      if (skuCol == null || dateCol == null) continue;
      for (const row of entry.sheet.rows.slice(0, 10_000)) {
        const iso = parseDate(cell(row, dateCol));
        const sku = normaliseKey(cell(row, skuCol));
        if (iso && sku) txKeys.add(`${sku}|${iso.slice(0, 7)}`);
      }
    }
    for (const m of monthlySheets) {
      const entry = byName.get(m.sheetName)!;
      const skuCol = m.mapping.sku;
      const monthCol = m.mapping.month;
      if (skuCol == null || monthCol == null) continue;
      const keys = new Set<string>();
      for (const row of entry.sheet.rows.slice(0, 10_000)) {
        const iso = parseDate(cell(row, monthCol));
        const sku = normaliseKey(cell(row, skuCol));
        if (iso && sku) keys.add(`${sku}|${iso.slice(0, 7)}`);
      }
      if (keyOverlap(keys, txKeys) >= 0.5) {
        m.duplicateSource = txSheets[0]!.sheetName;
        m.disposition = "review";
        if (m.confidence === "high") m.confidence = "medium";
        m.reason = `Overlaps '${txSheets[0]!.sheetName}' — Ionic rebuilds monthly totals from transaction lines, so this sheet is excluded by default to avoid double counting.`;
      }
    }
  }

  const summary = { total: results.length, auto: 0, review: 0, blocked: 0, ignored: 0 };
  for (const r of results) summary[r.disposition === "auto" ? "auto" : r.disposition === "review" ? "review" : r.disposition === "blocked" ? "blocked" : "ignored"]++;

  const entityTotals = new Map<EntityKind, number>();
  const months = new Set<string>();
  for (const r of results) {
    if (r.disposition !== "auto" && r.disposition !== "review") continue;
    if (r.duplicateSource) continue;
    entityTotals.set(r.kind, (entityTotals.get(r.kind) ?? 0) + r.rowCount);
    const entry = byName.get(r.sheetName)!;
    if (r.kind === "sales_monthly" && r.mapping.month != null) {
      for (const m of monthSetOf(entry.sheet, r.mapping.month, null)) months.add(m);
    }
    if (r.kind === "transactions" && r.mapping.transaction_date != null) {
      for (const m of monthSetOf(entry.sheet, -1, r.mapping.transaction_date)) months.add(m);
    }
  }

  return {
    sheets: results,
    summary,
    entities: [...entityTotals.entries()].map(([kind, records]) => ({
      kind,
      label: definitionFor(kind)?.label ?? kind,
      records,
    })),
    demandMonths: months.size,
  };
}

function unmappedHeaders(sheet: SheetTable, mapping: ColumnMapping): string[] {
  const used = new Set(Object.values(mapping));
  return sheet.headers.filter((h, i) => h.trim() !== "" && !used.has(i));
}
