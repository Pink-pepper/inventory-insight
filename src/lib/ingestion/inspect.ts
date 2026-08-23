import { csvToSheets } from "./csv-source";
import { xlsxToSheets, looksLikeXlsx, WorkbookError } from "./xlsx-source";
import { LIMITS, type SheetTable } from "./sheet-table";
import type { ColumnMapping, EntityKind } from "./mapping";
import {
  classifyWorkbook,
  type DataRole,
  type Disposition,
  type MappingConfidence,
} from "./classify";

export type UploadFormat = "csv" | "xlsx";

/** What the user is shown before deciding to import. */
export interface SheetPreview {
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  truncated: boolean;
  suggestedKind: EntityKind;
  suggestedMapping: ColumnMapping;
  unmappedHeaders: string[];
  /** What the data represents in planning terms. */
  role: DataRole;
  confidence: MappingConfidence;
  /** auto: pre-approved · review: glance needed · blocked: columns missing · ignored: excluded. */
  disposition: Disposition;
  /** Plain-language verdict. */
  reason: string;
  /** Per-column evidence for the mapping. */
  fieldReasons: string[];
  /** Cross-sheet links that informed the mapping. */
  relationships: string[];
  missingRequired: string[];
  /** Set when a richer sheet covers the same data. */
  duplicateSource: string | null;
}

export interface UploadInspection {
  format: UploadFormat;
  filename: string;
  sheets: SheetPreview[];
  summary: { total: number; auto: number; review: number; blocked: number; ignored: number };
  /** Business preview: what Ionic will understand from this file. */
  entities: { kind: EntityKind; label: string; records: number }[];
  demandMonths: number;
}

const SAMPLE_ROWS = 10;

export function formatOf(filename: string, bytes?: Uint8Array): UploadFormat {
  if (/\.xlsx$/i.test(filename)) return "xlsx";
  if (bytes && looksLikeXlsx(bytes)) return "xlsx";
  return "csv";
}

/** Parses an upload into neutral sheets. Nothing is written anywhere. */
export function toSheets(format: UploadFormat, payload: { text?: string; bytes?: Uint8Array }): SheetTable[] {
  if (format === "xlsx") {
    if (!payload.bytes) throw new WorkbookError("The workbook could not be read.");
    return xlsxToSheets(payload.bytes);
  }
  return csvToSheets(payload.text ?? "");
}

/** Sheets → classification, evidence and the preview shown before import. */
export function inspectSheets(filename: string, format: UploadFormat, sheets: SheetTable[]): UploadInspection {
  const bounded = sheets.slice(0, LIMITS.maxSheets);
  const analysis = classifyWorkbook(bounded);
  return {
    format,
    filename,
    sheets: analysis.sheets.map((c, i) => ({
      sheetName: c.sheetName,
      headers: bounded[i]!.headers,
      sampleRows: bounded[i]!.rows.slice(0, SAMPLE_ROWS),
      rowCount: c.rowCount,
      truncated: bounded[i]!.truncated,
      suggestedKind: c.kind,
      suggestedMapping: c.mapping,
      unmappedHeaders: c.unmappedHeaders,
      role: c.role,
      confidence: c.confidence,
      disposition: c.disposition,
      reason: c.reason,
      fieldReasons: c.fieldReasons,
      relationships: c.relationships,
      missingRequired: c.missingRequired,
      duplicateSource: c.duplicateSource,
    })),
    summary: analysis.summary,
    entities: analysis.entities,
    demandMonths: analysis.demandMonths,
  };
}
