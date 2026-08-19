import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { importUpload, inspectUpload } from "@/lib/ionic.functions";
import {
  ENTITY_DEFINITIONS,
  FIELD_ALIASES,
  definitionFor,
  type ColumnMapping,
  type EntityKind,
} from "@/lib/ingestion/mapping";
import { num } from "@/lib/format";

interface SheetPreview {
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  truncated: boolean;
  suggestedKind: EntityKind;
  suggestedMapping: ColumnMapping;
  unmappedHeaders: string[];
}

interface Inspection {
  format: "csv" | "xlsx";
  filename: string;
  sheets: SheetPreview[];
}

interface SheetChoice {
  kind: EntityKind;
  mapping: ColumnMapping;
}

interface ImportIssue {
  sheet: string | null;
  row: number;
  field: string;
  message: string;
  severity: "error" | "warning";
}

interface ImportOutcome {
  stats: { rowsRead: number; rowsAccepted: number; rowsRejected: number; warnings: number };
  issues: ImportIssue[];
  transactions: { inserted: number; duplicates: number; unknownSkus: string[] };
  evaluated: number;
}

const NOT_MAPPED = "__none__";

function fileToPayload(file: File): Promise<{ encoding: "text" | "base64"; content: string }> {
  if (/\.csv$/i.test(file.name)) {
    return file.text().then((content) => ({ encoding: "text" as const, content }));
  }
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return { encoding: "base64" as const, content: btoa(binary) };
  });
}

/**
 * Two-step spreadsheet import: inspect, confirm what each sheet is and which
 * columns map where, then commit. Nothing is written until the user confirms.
 */
export function ImportWizard() {
  const inspect = useServerFn(inspectUpload);
  const commit = useServerFn(importUpload);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [payload, setPayload] = useState<{ encoding: "text" | "base64"; content: string } | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [choices, setChoices] = useState<Record<string, SheetChoice>>({});
  const [busy, setBusy] = useState<"inspect" | "import" | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  function reset() {
    setFile(null);
    setPayload(null);
    setInspection(null);
    setChoices({});
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(chosen: File) {
    if (!/\.(csv|xlsx)$/i.test(chosen.name)) {
      toast.error("Please choose a .csv or .xlsx file.");
      return;
    }
    if (chosen.size > 5_000_000) {
      toast.error("File exceeds the 5 MB limit.");
      return;
    }
    setBusy("inspect");
    setOutcome(null);
    try {
      const body = await fileToPayload(chosen);
      const result = (await inspect({
        data: { filename: chosen.name, encoding: body.encoding, content: body.content },
      })) as Inspection;
      setFile(chosen);
      setPayload(body);
      setInspection(result);
      setChoices(
        Object.fromEntries(
          result.sheets.map((s) => [s.sheetName, { kind: s.suggestedKind, mapping: s.suggestedMapping }]),
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The file could not be read.");
      reset();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function setKind(sheet: SheetPreview, kind: EntityKind) {
    const def = definitionFor(kind);
    // Re-derive a suggested mapping for the newly chosen entity from the sheet headers.
    const mapping: ColumnMapping = {};
    if (def) {
      const fields = [...def.required, ...def.optional];
      sheet.headers.forEach((header, index) => {
        const match = fields.find(
          (f) => f === normalise(header) || (aliasIndex[f] ?? []).includes(normalise(header)),
        );
        if (match && !(match in mapping)) mapping[match] = index;
      });
    }
    setChoices((prev) => ({ ...prev, [sheet.sheetName]: { kind, mapping } }));
  }

  function setField(sheetName: string, field: string, value: string) {
    setChoices((prev) => {
      const current = prev[sheetName];
      if (!current) return prev;
      const mapping = { ...current.mapping };
      if (value === NOT_MAPPED) delete mapping[field];
      else mapping[field] = Number(value);
      return { ...prev, [sheetName]: { ...current, mapping } };
    });
  }

  const blockers = inspection
    ? inspection.sheets.flatMap((sheet) => {
        const choice = choices[sheet.sheetName];
        if (!choice || choice.kind === "ignored") return [];
        const def = definitionFor(choice.kind);
        const missing = (def?.required ?? []).filter((f) => !(f in choice.mapping));
        return missing.length ? [`${sheet.sheetName}: ${missing.join(", ")}`] : [];
      })
    : [];
  const anySelected = inspection
    ? inspection.sheets.some((s) => (choices[s.sheetName]?.kind ?? "ignored") !== "ignored")
    : false;

  async function runImport() {
    if (!file || !payload || !inspection) return;
    setBusy("import");
    try {
      const result = (await commit({
        data: {
          filename: file.name,
          encoding: payload.encoding,
          content: payload.content,
          plans: inspection.sheets.map((s) => ({
            sheetName: s.sheetName,
            kind: choices[s.sheetName]?.kind ?? "ignored",
            mapping: choices[s.sheetName]?.mapping ?? {},
          })),
        },
      })) as unknown as ImportOutcome;
      setOutcome(result);
      await queryClient.invalidateQueries();
      toast.success(
        `Imported ${num(result.stats.rowsAccepted)} rows · ${num(result.evaluated)} SKUs evaluated`,
      );
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Spreadsheet import</h2>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Upload a <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">.csv</code> or{" "}
          <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">.xlsx</code> file. Ionic reads
          every worksheet, suggests what each one contains and shows you the mapping before
          anything is written. Formulas are read as their last calculated value; external workbook
          links are never followed.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === "inspect" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {busy === "inspect" ? "Reading file" : "Choose file"}
          </Button>
          {inspection ? (
            <span className="text-xs text-muted-foreground">
              {inspection.filename} · {inspection.format.toUpperCase()} · {inspection.sheets.length} sheet
              {inspection.sheets.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </section>

      {inspection
        ? inspection.sheets.map((sheet) => {
            const choice = choices[sheet.sheetName] ?? { kind: "ignored" as EntityKind, mapping: {} };
            const def = definitionFor(choice.kind);
            return (
              <section key={sheet.sheetName} className="panel">
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">{sheet.sheetName}</h3>
                  <span className="text-xs text-muted-foreground tabular">
                    {num(sheet.rowCount)} rows · {sheet.headers.length} columns
                  </span>
                  {sheet.truncated ? <Pill tone="watch">Truncated</Pill> : null}
                  <div className="ml-auto w-56">
                    <Select value={choice.kind} onValueChange={(v) => setKind(sheet, v as EntityKind)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignored">Do not import</SelectItem>
                        {ENTITY_DEFINITIONS.map((d) => (
                          <SelectItem key={d.kind} value={d.kind}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </header>

                {def ? (
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {[...def.required, ...def.optional].map((field) => {
                        const required = def.required.includes(field);
                        const value = choice.mapping[field];
                        return (
                          <label key={field} className="text-xs">
                            <span className="font-medium">
                              {field.replace(/_/g, " ")}
                              {required ? <span className="text-status-reorder"> *</span> : null}
                            </span>
                            <Select
                              value={value == null ? NOT_MAPPED : String(value)}
                              onValueChange={(v) => setField(sheet.sheetName, field, v)}
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NOT_MAPPED}>Not mapped</SelectItem>
                                {sheet.headers.map((header, index) =>
                                  header.trim() === "" ? null : (
                                    <SelectItem key={`${header}-${index}`} value={String(index)}>
                                      {header}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-muted">
                      <tr className="text-left uppercase tracking-wide text-muted-foreground">
                        {sheet.headers.map((h, i) => (
                          <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 font-medium">
                            {h || "—"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.sampleRows.map((row, ri) => (
                        <tr key={ri} className="border-t border-border/70">
                          {sheet.headers.map((_, ci) => (
                            <td key={ci} className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                              {row[ci] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })
        : null}

      {inspection ? (
        <section className="panel flex flex-wrap items-center gap-3 p-4">
          {blockers.length ? (
            <p className="text-xs text-status-reorder">
              Required columns are not mapped — {blockers.join(" · ")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Rows are validated again on the server; anything invalid is reported rather than guessed.
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={reset} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void runImport()}
              disabled={busy !== null || blockers.length > 0 || !anySelected}
            >
              {busy === "import" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Import
            </Button>
          </div>
        </section>
      ) : null}

      {outcome ? (
        <section className="panel p-4">
          <h3 className="text-sm font-semibold">Import result</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Metric label="Rows read" value={outcome.stats.rowsRead} />
            <Metric label="Accepted" value={outcome.stats.rowsAccepted} tone="text-status-hold" />
            <Metric label="Rejected" value={outcome.stats.rowsRejected} tone="text-status-reorder" />
            <Metric label="Warnings" value={outcome.stats.warnings} tone="text-status-watch" />
          </div>
          {outcome.transactions.inserted || outcome.transactions.duplicates ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {num(outcome.transactions.inserted)} transaction lines stored
              {outcome.transactions.duplicates
                ? ` · ${num(outcome.transactions.duplicates)} already imported previously and skipped`
                : ""}
              {outcome.transactions.unknownSkus.length
                ? ` · unknown SKUs skipped: ${outcome.transactions.unknownSkus.join(", ")}`
                : ""}
            </p>
          ) : null}
          {outcome.issues.length ? (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-muted">
                  <tr className="text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Sheet</th>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.issues.map((i, idx) => (
                    <tr key={idx} className="border-t border-border/70">
                      <td className="px-3 py-1.5 text-muted-foreground">{i.sheet ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular">{i.row}</td>
                      <td className="px-3 py-1.5 font-mono">{i.field}</td>
                      <td className="px-3 py-1.5">
                        <Pill tone={i.severity === "error" ? "reorder" : "watch"}>
                          {i.severity === "error" ? "Rejected" : "Warning"}
                        </Pill>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{i.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No validation problems were found in this file.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular ${tone ?? ""}`}>{num(value)}</p>
    </div>
  );
}

function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s.\-/]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

// Alias lookup so re-picking an entity keeps suggesting sensible columns.
const aliasIndex = FIELD_ALIASES;