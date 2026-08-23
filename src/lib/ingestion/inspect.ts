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
import type { Grain, GrainInfo, TimeOrientation } from "./grain";
import { extractPolicyProposals, type PolicyProposal } from "./policy-detect";

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
  /** auto · review · blocked · unsupported (recognised, no destination) · ignored. */
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
  /** What one row represents ("one row per SKU and month"). */
  grain: Grain;
  grainKey: string;
  /** Historical, current-state, forward-looking or policy data. */
  timeOrientation: TimeOrientation;
}

export interface UploadInspection {
  format: UploadFormat;
  filename: string;
  sheets: SheetPreview[];
  summary: { total: number; auto: number; review: number; blocked: number; unsupported: number; ignored: number };
  /** Business preview: what Ionic will understand from this file. */
  entities: { kind: EntityKind; label: string; records: number }[];
  demandMonths: number;
  /** Planning-policy proposals mined from parameter sheets. Nothing is
   *  applied until the user explicitly accepts a proposal at import time. */
  policyProposals: PolicyProposal[];
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
  const grainBrief = (g: GrainInfo) => ({ grain: g.grain, key: g.key });
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
      grain: grainBrief(c.grain).grain,
      grainKey: c.grain.key,
      timeOrientation: c.timeOrientation,
    })),
    summary: analysis.summary,
    entities: analysis.entities,
    demandMonths: analysis.demandMonths,
    policyProposals: analysis.sheets.flatMap((c, i) =>
      c.kind === "planning_policy" ? extractPolicyProposals(bounded[i]!, c.mapping) : [],
    ),
  };
}
