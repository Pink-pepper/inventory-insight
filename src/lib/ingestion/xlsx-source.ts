import { unzipSync, strFromU8 } from "fflate";
import { LIMITS, type SheetTable } from "./sheet-table";

/**
 * Minimal, dependency-light .xlsx reader.
 *
 * Deliberately narrow: it unzips the package and reads cell values only. It
 * never evaluates formulas, never resolves external workbook links, and never
 * touches the filesystem, so it is safe in the serverless worker runtime.
 */

export class WorkbookError extends Error {}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** True when the bytes start with a ZIP local-file header (every .xlsx does). */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((b, i) => bytes[i] === b);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(xmlFragment: string): string {
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlFragment)) !== null) out += m[1];
  return decodeEntities(out);
}

function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textOf(m[1]!));
  return out;
}

interface SheetRef {
  name: string;
  path: string;
}

function workbookSheets(workbookXml: string, relsXml: string | undefined): SheetRef[] {
  // Relationship attributes appear in any order, so each tag is read as a whole.
  const relTarget = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let r: RegExpExecArray | null;
  while ((r = relRe.exec(relsXml ?? "")) !== null) {
    const id = /\bId="([^"]+)"/.exec(r[1]!)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(r[1]!)?.[1];
    if (id && target) relTarget.set(id, target);
  }

  const sheets: SheetRef[] = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let s: RegExpExecArray | null;
  while ((s = sheetRe.exec(workbookXml)) !== null) {
    const attrs = s[1]!;
    const name = decodeEntities(/name="([^"]*)"/.exec(attrs)?.[1] ?? "Sheet");
    const rid = /r:id="([^"]*)"/.exec(attrs)?.[1] ?? "";
    let target = relTarget.get(rid) ?? "";
    if (!target) continue;
    if (target.startsWith("/")) target = target.slice(1);
    else if (!target.startsWith("xl/")) target = `xl/${target}`;
    sheets.push({ name, path: target });
  }
  return sheets;
}

function parseSheet(name: string, xml: string, strings: string[]): SheetTable {
  const grid: string[][] = [];
  let truncated = false;
  let rowCount = 0;

  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    rowCount++;
    if (grid.length >= LIMITS.maxRowsPerSheet + 1) {
      truncated = true;
      continue;
    }
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      const attrs = cellMatch[0]!;
      const body = cellMatch[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "s") {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        value = strings[idx] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else if (type === "e") {
        // Formula error cells are surfaced as empty; validation reports the gap.
        value = "";
      } else {
        // For formula cells only the cached <v> result is read; the formula in
        // <f> is ignored entirely.
        value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
        if (type === "b") value = value === "1" ? "TRUE" : "FALSE";
      }
      const col = ref ? columnIndex(ref) : cells.length;
      if (col < 0 || col >= LIMITS.maxColumns) continue;
      while (cells.length < col) cells.push("");
      cells[col] = value.trim();
    }
    grid.push(cells);
  }

  const headers = (grid.shift() ?? []).map((h) => h.trim());
  const rows = grid.filter((r) => r.some((c) => c !== ""));
  return {
    sheetName: name,
    headers,
    rows,
    rowCount: Math.max(0, rowCount - 1),
    truncated,
  };
}

/** .xlsx bytes → one neutral sheet per worksheet. Parsing only. */
export function xlsxToSheets(bytes: Uint8Array): SheetTable[] {
  if (!looksLikeXlsx(bytes)) {
    throw new WorkbookError("This file is not a valid .xlsx workbook.");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new WorkbookError("The workbook could not be opened. It may be corrupt or password protected.");
  }
  const read = (path: string): string | undefined => {
    const file = files[path];
    return file ? strFromU8(file) : undefined;
  };

  const workbookXml = read("xl/workbook.xml");
  if (!workbookXml) {
    throw new WorkbookError("The workbook is missing its worksheet index and cannot be read.");
  }
  const strings = sharedStrings(read("xl/sharedStrings.xml"));
  const refs = workbookSheets(workbookXml, read("xl/_rels/workbook.xml.rels")).slice(0, LIMITS.maxSheets);
  if (refs.length === 0) throw new WorkbookError("The workbook contains no readable worksheets.");

  const sheets: SheetTable[] = [];
  for (const ref of refs) {
    const xml = read(ref.path);
    if (!xml) continue;
    sheets.push(parseSheet(ref.name, xml, strings));
  }
  if (sheets.length === 0) throw new WorkbookError("The workbook contains no readable worksheets.");
  return sheets;
}