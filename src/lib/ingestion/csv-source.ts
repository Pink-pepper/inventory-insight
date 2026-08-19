import { LIMITS, type SheetTable } from "./sheet-table";

/** RFC4180-style line splitter, tolerant of quoted commas and escaped quotes. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** CSV text → a single neutral sheet. Parsing only: no mapping, no validation. */
export function csvToSheets(text: string, sheetName = "CSV"): SheetTable[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [{ sheetName, headers: [], rows: [], rowCount: 0, truncated: false }];
  const headers = splitLine(lines[0]!).slice(0, LIMITS.maxColumns);
  const dataLines = lines.slice(1);
  const truncated = dataLines.length > LIMITS.maxRowsPerSheet;
  const rows = (truncated ? dataLines.slice(0, LIMITS.maxRowsPerSheet) : dataLines).map((l) =>
    splitLine(l).slice(0, LIMITS.maxColumns),
  );
  return [{ sheetName, headers, rows, rowCount: dataLines.length, truncated }];
}