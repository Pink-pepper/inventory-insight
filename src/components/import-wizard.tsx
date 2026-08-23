import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronRight, FileSpreadsheet, Loader2, Upload } from "lucide-react";
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
  FIELD_ALIASES,
  IMPORTABLE_KINDS,
  capabilityLabel,
  definitionFor,
  type ColumnMapping,
  type EntityCapability,
  type EntityKind,
} from "@/lib/ingestion/mapping";
import { num } from "@/lib/format";

type Role =
  | "master"
  | "transactional"
  | "aggregate"
  | "snapshot"
  | "mixed"
  | "forecast"
  | "policy"
  | "movement"
  | "documentation"
  | "contextual"
  | "unknown";
type Confidence = "high" | "medium" | "low" | "unresolved";
type Disposition = "auto" | "review" | "blocked" | "unsupported" | "ignored";

interface SheetPreview {
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  truncated: boolean;
  suggestedKind: EntityKind;
  suggestedMapping: ColumnMapping;
  unmappedHeaders: string[];
  role: Role;
  confidence: Confidence;
  disposition: Disposition;
  reason: string;
  fieldReasons: string[];
  relationships: string[];
  missingRequired: string[];
  duplicateSource: string | null;
  assumption: string | null;
  capability: EntityCapability | null;
  grain: string;
  grainKey: string;
  timeOrientation: "historical" | "current_state" | "forward" | "policy" | "not_dated";
}

/** A planning-policy value Ionic recognised in the workbook, awaiting a decision. */
interface PolicyProposal {
  sheet: string;
  field: string;
  label: string;
  rawValue: string;
  proposed: number | boolean | null;
  unit: string | null;
  scope: "organisation" | "specific";
  scopeRef: string | null;
  status: "ready" | "review";
  reason: string;
}

interface Inspection {
  format: "csv" | "xlsx";
  filename: string;
  sheets: SheetPreview[];
  summary: { total: number; auto: number; review: number; blocked: number; unsupported: number; ignored: number };
  entities: { kind: EntityKind; label: string; records: number }[];
  demandMonths: number;
  policyProposals: PolicyProposal[];
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
  purchaseOrders: {
    inserted: number;
    duplicates: number;
    unknownSkus: string[];
    unknownSuppliers: string[];
  };
  forecasts?: { inserted: number; duplicates: number; unknownSkus: string[] };
  movements?: { inserted: number; duplicates: number; unknownSkus: string[] };
  policyApplied?: string[];
  policySkipped?: string[];
  evaluated: number;
}

const NOT_MAPPED = "__none__";

const ROLE_LABEL: Record<Role, string> = {
  master: "Master data",
  transactional: "Transactions",
  aggregate: "Monthly totals",
  snapshot: "Stock snapshot",
  mixed: "Mixed",
  forecast: "Forward demand",
  policy: "Planning parameters",
  movement: "Stock movement",
  documentation: "Notes",
  contextual: "Reference",
  unknown: "Unknown",
};

const ORIENTATION_LABEL: Record<SheetPreview["timeOrientation"], string> = {
  historical: "historical",
  current_state: "current state",
  forward: "forward-looking",
  policy: "policy",
  not_dated: "undated",
};

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
 * Exception-based spreadsheet import: Ionic classifies every sheet, maps its
 * columns and links identifiers across sheets. High-confidence sheets are
 * pre-approved; only genuinely ambiguous or incomplete sheets ask for review.
 * Nothing is written until the user confirms.
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [policyDecisions, setPolicyDecisions] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"inspect" | "import" | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  function reset() {
    setFile(null);
    setPayload(null);
    setInspection(null);
    setChoices({});
    setExpanded({});
    setPolicyDecisions({});
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
      // High-confidence sheets are pre-approved; everything else starts as
      // excluded with its suggestion one click away.
      setChoices(
        Object.fromEntries(
          result.sheets.map((s) => [
            s.sheetName,
            s.disposition === "auto"
              ? { kind: s.suggestedKind, mapping: s.suggestedMapping }
              : { kind: "ignored" as EntityKind, mapping: {} },
          ]),
        ),
      );
      // Auto-approved sheets stay collapsed; review/blocked open for inspection.
      setExpanded(
        Object.fromEntries(result.sheets.map((s) => [s.sheetName, s.disposition !== "auto"])),
      );
      // Policy proposals: clear organisation-wide values start accepted;
      // anything ambiguous or item-specific starts as "keep existing".
      setPolicyDecisions(
        Object.fromEntries(
          (result.policyProposals ?? []).map((p) => [
            `${p.sheet}|${p.field}`,
            p.status === "ready" && p.scope === "organisation",
          ]),
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

  function acceptSuggestion(sheet: SheetPreview) {
    setChoices((prev) => ({
      ...prev,
      [sheet.sheetName]: { kind: sheet.suggestedKind, mapping: sheet.suggestedMapping },
    }));
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

  function toggleExpanded(sheetName: string) {
    setExpanded((prev) => ({ ...prev, [sheetName]: !prev[sheetName] }));
  }

  const includedCount = inspection
    ? inspection.sheets.filter((s) => (choices[s.sheetName]?.kind ?? "ignored") !== "ignored").length
    : 0;

  const blockers = inspection
    ? inspection.sheets.flatMap((sheet) => {
        const choice = choices[sheet.sheetName];
        if (!choice || choice.kind === "ignored") return [];
        const def = definitionFor(choice.kind);
        const missing = (def?.required ?? []).filter((f) => !(f in choice.mapping));
        return missing.length ? [`${sheet.sheetName}: ${missing.join(", ")}`] : [];
      })
    : [];
  const anySelected = includedCount > 0;

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
          policyDecisions: (inspection.policyProposals ?? []).map((p) => ({
            sheet: p.sheet,
            field: p.field,
            accepted: policyDecisions[`${p.sheet}|${p.field}`] ?? false,
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

  const groups: { key: Disposition | "excluded"; title: string; sheets: SheetPreview[] }[] = inspection
    ? [
        {
          key: "auto",
          title: "Recognised automatically",
          sheets: inspection.sheets.filter(
            (s) => s.disposition === "auto" && (choices[s.sheetName]?.kind ?? "ignored") !== "ignored",
          ),
        },
        {
          key: "review",
          title: "Needs review",
          sheets: inspection.sheets.filter(
            (s) =>
              s.disposition === "review" ||
              s.disposition === "blocked" ||
              (s.disposition === "auto" && (choices[s.sheetName]?.kind ?? "ignored") === "ignored") ||
              (s.disposition === "unsupported" && (choices[s.sheetName]?.kind ?? "ignored") !== "ignored"),
          ),
        },
        {
          key: "unsupported",
          title: "Recognised, not stored",
          sheets: inspection.sheets.filter(
            (s) =>
              s.disposition === "unsupported" && (choices[s.sheetName]?.kind ?? "ignored") === "ignored",
          ),
        },
        {
          key: "excluded",
          title: "Excluded",
          sheets: inspection.sheets.filter(
            (s) =>
              s.disposition === "ignored" && (choices[s.sheetName]?.kind ?? "ignored") === "ignored",
          ),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Spreadsheet import</h2>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Upload a <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">.csv</code> or{" "}
          <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">.xlsx</code> file. Ionic
          examines every worksheet — headers and values — classifies what each one contains, maps
          the columns and links identifiers across sheets. Confident mappings are pre-approved;
          you only review the exceptions. Formulas are read as their last calculated value;
          external workbook links are never followed.
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
            {busy === "inspect" ? "Analysing file" : "Choose file"}
          </Button>
          {inspection ? (
            <span className="text-xs text-muted-foreground">
              {inspection.filename} · {inspection.format.toUpperCase()} · {inspection.sheets.length} sheet
              {inspection.sheets.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </section>

      {inspection ? (
        <section className="panel p-5">
          <h3 className="text-sm font-semibold">What Ionic understood</h3>
          {inspection.entities.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {inspection.entities.map((e) => (
                <span
                  key={e.kind}
                  className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs"
                >
                  <span className="font-medium">{e.label}</span>
                  <span className="ml-1.5 text-muted-foreground tabular">{num(e.records)} records</span>
                </span>
              ))}
              {inspection.demandMonths > 0 ? (
                <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs">
                  <span className="font-medium">Demand history</span>
                  <span className="ml-1.5 text-muted-foreground tabular">
                    {inspection.demandMonths} month{inspection.demandMonths === 1 ? "" : "s"}
                  </span>
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing in this file was recognised as planning data yet.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{inspection.summary.auto} sheet{inspection.summary.auto === 1 ? "" : "s"} pre-approved</span>
            <span>{inspection.summary.review + inspection.summary.blocked} need review</span>
            {inspection.summary.unsupported > 0 ? (
              <span>{inspection.summary.unsupported} recognised, not stored</span>
            ) : null}
            <span>{inspection.summary.ignored} excluded</span>
          </div>
        </section>
      ) : null}

      {inspection && inspection.policyProposals.length > 0 ? (
        <section className="panel p-5">
          <h3 className="text-sm font-semibold">Planning parameters found in this file</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Ionic recognised planning policy values in the workbook. Accept a value to update the
            workspace planning policy, or keep what is already configured. Ranges and item-specific
            values are never applied automatically.
          </p>
          <ul className="mt-3 space-y-2">
            {inspection.policyProposals.map((p) => {
              const key = `${p.sheet}|${p.field}`;
              const accepted = policyDecisions[key] ?? false;
              const applicable = p.scope === "organisation" && p.proposed !== null;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">
                      {p.label}
                      <span className="ml-2 font-normal text-muted-foreground">
                        workbook says: {p.rawValue}
                        {p.unit ? ` ${p.unit}` : ""}
                        {p.scope === "specific" ? ` · for ${p.scopeRef}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{p.reason}</p>
                  </div>
                  {applicable ? (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant={accepted ? "default" : "outline"}
                        className="h-7 text-xs"
                        onClick={() => setPolicyDecisions((prev) => ({ ...prev, [key]: true }))}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant={accepted ? "outline" : "default"}
                        className="h-7 text-xs"
                        onClick={() => setPolicyDecisions((prev) => ({ ...prev, [key]: false }))}
                      >
                        Keep existing
                      </Button>
                    </div>
                  ) : (
                    <Pill tone="watch">Review only</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {groups.map((group) =>
        group.sheets.length === 0 ? null : (
          <section key={group.key} className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {group.title} · {group.sheets.length}
            </h3>
            {group.sheets.map((sheet) => (
              <SheetCard
                key={sheet.sheetName}
                sheet={sheet}
                choice={choices[sheet.sheetName] ?? { kind: "ignored", mapping: {} }}
                expanded={expanded[sheet.sheetName] ?? false}
                onToggle={() => toggleExpanded(sheet.sheetName)}
                onAccept={() => acceptSuggestion(sheet)}
                onKind={(kind) => setKind(sheet, kind)}
                onField={(field, value) => setField(sheet.sheetName, field, value)}
              />
            ))}
          </section>
        ),
      )}

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
              Import {includedCount > 0 ? `${includedCount} sheet${includedCount === 1 ? "" : "s"}` : ""}
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
          {outcome.purchaseOrders?.inserted || outcome.purchaseOrders?.duplicates ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {num(outcome.purchaseOrders.inserted)} purchase order lines stored
              {outcome.purchaseOrders.duplicates
                ? ` · ${num(outcome.purchaseOrders.duplicates)} already imported previously and skipped`
                : ""}
              {outcome.purchaseOrders.unknownSkus.length
                ? ` · unknown SKUs skipped: ${outcome.purchaseOrders.unknownSkus.join(", ")}`
                : ""}
              {outcome.purchaseOrders.unknownSuppliers.length
                ? ` · suppliers not matched to the supplier master: ${outcome.purchaseOrders.unknownSuppliers.join(", ")}`
                : ""}
            </p>
          ) : null}
          {(outcome.forecasts?.inserted ?? 0) > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {num(outcome.forecasts!.inserted)} forward demand records stored
              {outcome.forecasts!.duplicates
                ? ` · ${num(outcome.forecasts!.duplicates)} already imported previously and skipped`
                : ""}
            </p>
          ) : null}
          {outcome.movements?.inserted || outcome.movements?.duplicates ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {num(outcome.movements!.inserted)} movement records stored (record only — not used by planning yet)
              {outcome.movements!.duplicates
                ? ` · ${num(outcome.movements!.duplicates)} already imported previously and skipped`
                : ""}
              {outcome.movements!.unknownSkus.length
                ? ` · unknown SKUs skipped: ${outcome.movements!.unknownSkus.join(", ")}`
                : ""}
            </p>
          ) : null}
          {(outcome.policyApplied?.length ?? 0) > 0 ? (
            <p className="mt-1.5 text-xs text-status-hold">
              Planning policy updated: {outcome.policyApplied!.join(", ")}.
            </p>
          ) : null}
          {(outcome.policySkipped?.length ?? 0) > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Not applied (item-specific or ambiguous): {outcome.policySkipped!.join(", ")}.
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

function SheetCard({
  sheet,
  choice,
  expanded,
  onToggle,
  onAccept,
  onKind,
  onField,
}: {
  sheet: SheetPreview;
  choice: SheetChoice;
  expanded: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onKind: (kind: EntityKind) => void;
  onField: (field: string, value: string) => void;
}) {
  const def = definitionFor(choice.kind);
  const included = choice.kind !== "ignored";
  const suggestionAvailable =
    !included && sheet.suggestedKind !== "ignored" && sheet.disposition !== "ignored";

  return (
    <div className="panel">
      <header className="flex flex-wrap items-center gap-2.5 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1.5 text-left"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <h4 className="truncate text-sm font-semibold">{sheet.sheetName}</h4>
        </button>
        <span className="text-xs text-muted-foreground tabular">
          {num(sheet.rowCount)} rows · {sheet.headers.length} columns
        </span>
        {sheet.truncated ? <Pill tone="watch">Truncated</Pill> : null}
        <Pill tone={included ? "hold" : sheet.disposition === "blocked" ? "reorder" : sheet.disposition === "review" ? "watch" : "neutral"}>
          {included
            ? definitionFor(choice.kind)?.label ?? choice.kind
            : sheet.disposition === "ignored"
              ? "Excluded"
              : sheet.disposition === "unsupported"
                ? "Recognised, not stored"
                : "Not included"}
        </Pill>
        {included ? (
          <Pill tone="neutral">{capabilityLabel(choice.kind).badge}</Pill>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {ROLE_LABEL[sheet.role]}
          {sheet.timeOrientation !== "not_dated" && sheet.timeOrientation !== "policy"
            ? ` · ${ORIENTATION_LABEL[sheet.timeOrientation]}`
            : ""}
        </span>
        {suggestionAvailable ? (
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={onAccept}>
            <Check className="size-3.5" />
            Use suggestion: {definitionFor(sheet.suggestedKind)?.label}
          </Button>
        ) : (
          <div className="ml-auto w-56">
            <Select value={choice.kind} onValueChange={(v) => onKind(v as EntityKind)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ignored">Do not import</SelectItem>
                {IMPORTABLE_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {definitionFor(kind)?.label ?? kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      {expanded ? (
        <>
          <div className="space-y-1.5 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{sheet.reason}</p>
            <p className="text-[11px] text-muted-foreground">
              Row grain: {sheet.grainKey}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {capabilityLabel(included ? choice.kind : sheet.suggestedKind).detail}
            </p>
            {sheet.assumption && included && choice.kind === "transactions" ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-watch/40 bg-surface-muted px-3 py-2">
                <p className="text-xs text-status-watch">{sheet.assumption}</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onKind("inventory_movement")}>
                  Reclassify as Inventory movements
                </Button>
              </div>
            ) : null}
            {sheet.fieldReasons.length ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {sheet.fieldReasons.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            ) : null}
            {sheet.relationships.length ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {sheet.relationships.map((r) => (
                  <li key={r}>↳ {r}</li>
                ))}
              </ul>
            ) : null}
            {sheet.duplicateSource ? (
              <p className="text-xs text-status-watch">
                Duplicate source: also covered by '{sheet.duplicateSource}'.
              </p>
            ) : null}
            {sheet.missingRequired.length ? (
              <p className="text-xs text-status-reorder">
                Missing required columns: {sheet.missingRequired.map((f) => f.replace(/_/g, " ")).join(", ")}
              </p>
            ) : null}
          </div>

          {def && included ? (
            <div className="border-t border-border px-4 py-3">
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
                        onValueChange={(v) => onField(field, v)}
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

          <div className="max-h-64 overflow-auto border-t border-border">
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
        </>
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
