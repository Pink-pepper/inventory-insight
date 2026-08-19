import { csvToSheets } from "./csv-source";
import { xlsxToSheets, looksLikeXlsx, WorkbookError } from "./xlsx-source";
import { LIMITS, type SheetTable } from "./sheet-table";
import { suggestSheet, type ColumnMapping, type EntityKind } from "./mapping";

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
}

export interface UploadInspection {
  format: UploadFormat;
  filename: string;
  sheets: SheetPreview[];
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

/** Sheets → the preview and suggested mapping shown in the import step. */
export function inspectSheets(filename: string, format: UploadFormat, sheets: SheetTable[]): UploadInspection {
  return {
    format,
    filename,
    sheets: sheets.slice(0, LIMITS.maxSheets).map((sheet) => {
      const suggestion = suggestSheet(sheet);
      return {
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, SAMPLE_ROWS),
        rowCount: sheet.rowCount,
        truncated: sheet.truncated,
        suggestedKind: suggestion.kind,
        suggestedMapping: suggestion.mapping,
        unmappedHeaders: suggestion.unmappedHeaders,
      };
    }),
  };
}