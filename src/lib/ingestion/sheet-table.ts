/**
 * The neutral tabular shape every source adapter produces. Nothing downstream
 * of a source adapter knows whether the bytes came from a CSV file or a
 * worksheet inside an Excel workbook.
 */
export interface SheetTable {
  sheetName: string;
  headers: string[];
  rows: string[][];
  /** Rows present in the source, which may exceed the rows retained. */
  rowCount: number;
  /** True when the source was larger than the ingestion limits allow. */
  truncated: boolean;
}

/** Ingestion guard rails. Bound work and stored value sizes regardless of input. */
export const LIMITS = {
  maxBytes: 5_000_000,
  maxSheets: 30,
  maxRowsPerSheet: 50_000,
  maxColumns: 200,
  maxSkus: 20_000,
  maxIssues: 500,
  maxText: 120,
  maxNumber: 1e9,
} as const;

export function emptySheet(sheetName: string): SheetTable {
  return { sheetName, headers: [], rows: [], rowCount: 0, truncated: false };
}

/** Reads a cell by header index, tolerating short rows. */
export function cell(row: string[], index: number): string {
  return index < 0 ? "" : (row[index] ?? "");
}