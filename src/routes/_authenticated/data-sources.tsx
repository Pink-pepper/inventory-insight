import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Database as DatabaseIcon, Plug, Loader2 } from "lucide-react";
import { AppShell, useWorkspace } from "@/components/app-shell";
import { ImportWizard } from "@/components/import-wizard";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  deleteImportBatch,
  getAuditLog,
  getImportBatches,
  ingestDataset,
  setImportBatchActive,
} from "@/lib/ionic.functions";
import { num } from "@/lib/format";
import type { IngestionIssue, IngestionStats } from "@/lib/connectors/types";

export const Route = createFileRoute("/_authenticated/data-sources")({
  head: () => ({
    meta: [
      { title: "Data sources & connectors — Ionic" },
      {
        name: "description",
        content:
          "Upload a CSV or Excel extract, or load the demo dataset. Every source maps into Ionic's canonical inventory model.",
      },
      { property: "og:title", content: "Data sources & connectors — Ionic" },
      {
        property: "og:description",
        content: "CSV and Excel today, ERP connectors next — all normalized into one internal model.",
      },
    ],
  }),
  component: DataSourcesPage,
});

const PLANNED = ["Odoo", "SAP Business One", "Microsoft Dynamics", "NetSuite", "Custom API"];

function DataSourcesPage() {
  const ingest = useServerFn(ingestDataset);
  const auditFn = useServerFn(getAuditLog);
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const { data: auditLog } = useQuery({ queryKey: ["audit"], queryFn: () => auditFn() });
  const [busy, setBusy] = useState<"demo" | null>(null);
  const [issues, setIssues] = useState<IngestionIssue[]>([]);
  const [stats, setStats] = useState<IngestionStats | null>(null);

  async function run() {
    setBusy("demo");
    setIssues([]);
    setStats(null);
    try {
      const res = await ingest({ data: { source: "demo" } });
      setIssues(res.issues);
      setStats(res.stats);
      await queryClient.invalidateQueries();
      toast.success(
        `Ingested ${num(res.products)} products and ${num(res.sales)} sales rows · ${num(res.evaluated)} SKUs evaluated`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ingestion failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Data Sources"
      description="Connect the systems that describe your stock. Everything is normalized into Ionic's canonical model."
    >
      <div className="space-y-4">
        <ImportWizard />

        <ImportedFiles />

        <div className="grid gap-3">
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <DatabaseIcon className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Demo dataset</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Loads a realistic distributor dataset: 50 SKUs across 5 categories, 8 suppliers with
              differing lead times and MOQs, and 12 months of seasonal sales history — including
              deliberate stockout risks and overstock positions.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => run()} disabled={busy !== null}>
                {busy === "demo" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <DatabaseIcon className="size-3.5" />
                )}
                {busy === "demo" ? "Loading" : "Load demo data"}
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/overview">Open overview</Link>
              </Button>
            </div>
          </section>
        </div>

        {stats ? (
          <section className="panel p-4">
            <h3 className="text-sm font-semibold">Import result</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rows read</p>
                <p className="mt-0.5 text-lg font-semibold tabular">{num(stats.rowsRead)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Accepted</p>
                <p className="mt-0.5 text-lg font-semibold tabular text-status-hold">
                  {num(stats.rowsAccepted)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Rejected</p>
                <p className="mt-0.5 text-lg font-semibold tabular text-status-reorder">
                  {num(stats.rowsRejected)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Warnings</p>
                <p className="mt-0.5 text-lg font-semibold tabular text-status-watch">
                  {num(stats.warnings)}
                </p>
              </div>
            </div>
            {issues.length > 0 ? (
              <div className="mt-4 max-h-72 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr className="text-left uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Field</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((i, idx) => (
                      <tr key={idx} className="border-t border-border/70">
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

        <section className="panel">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Connected sources</h2>
          </header>
          <div className="divide-y divide-border">
            {(workspace?.dataSources ?? []).map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{s.name}</span>
                <Pill tone="hold">{s.status}</Pill>
                <span className="text-xs uppercase text-muted-foreground">{s.connector}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular">
                  {num(s.rowsIngested)} rows
                  {s.errorCount ? ` · ${s.errorCount} issues` : ""}
                  {s.lastSyncAt ? ` · ${new Date(s.lastSyncAt).toLocaleString()}` : ""}
                </span>
              </div>
            ))}
            {(workspace?.dataSources ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No sources connected yet.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Planned connectors</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The ingestion layer is connector-agnostic: each integration only has to map its source
            schema onto the canonical model used by the decision engine.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PLANNED.map((p) => (
              <span
                key={p}
                className="rounded-sm border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"
              >
                {p} · coming soon
              </span>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Activity log</h2>
          </header>
          <div className="divide-y divide-border">
            {(auditLog ?? []).slice(0, 12).map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className="font-mono text-muted-foreground">{a.event}</span>
                <span className="ml-auto text-muted-foreground tabular">
                  {new Date(a.occurredAt).toLocaleString()}
                </span>
              </div>
            ))}
            {(auditLog ?? []).length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

type BatchLifecycle = "active" | "inactive" | "deleted";

interface BatchRow {
  id: string;
  filename: string;
  source: string;
  lifecycle: BatchLifecycle;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  warnings: number;
  sheets: { sheet: string; kind: string; rows: number }[];
  createdAt: string;
  transactions: number;
  purchaseOrders: number;
}

/**
 * Imported-file lifecycle: every upload is listed with what it contributed.
 * Owners/admins can deactivate an import (excluded from planning, nothing
 * deleted) and, once inactive, permanently remove its rows. Batch records are
 * always retained for audit.
 */
function ImportedFiles() {
  const fetchBatches = useServerFn(getImportBatches);
  const setActive = useServerFn(setImportBatchActive);
  const removeBatch = useServerFn(deleteImportBatch);
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["import-batches"], queryFn: () => fetchBatches() });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function toggle(batch: BatchRow, active: boolean) {
    setBusyId(batch.id);
    try {
      await setActive({ data: { batchId: batch.id, active } });
      await queryClient.invalidateQueries();
      toast.success(
        active
          ? `${batch.filename} reactivated — its rows are back in planning.`
          : `${batch.filename} deactivated — excluded from planning, nothing deleted.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the import state");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(batch: BatchRow) {
    if (confirmId !== batch.id) {
      setConfirmId(batch.id);
      return;
    }
    setConfirmId(null);
    setBusyId(batch.id);
    try {
      const res = await removeBatch({ data: { batchId: batch.id } });
      await queryClient.invalidateQueries();
      toast.success(
        `${batch.filename} deleted — ${num(res.transactions ?? 0)} transactions and ${num(res.purchaseOrders ?? 0)} purchase orders removed.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the import");
    } finally {
      setBusyId(null);
    }
  }

  const batches = data?.batches ?? [];
  const canManage = data?.canManage ?? false;

  return (
    <section className="panel">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Imported files</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Each upload stays reversible: deactivate to exclude it from planning, reactivate to bring
          it back, delete to remove its rows permanently.
        </p>
      </header>
      <div className="divide-y divide-border">
        {batches.map((b) => (
          <div key={b.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5 text-sm">
              <span className="font-medium">{b.filename}</span>
              <Pill tone={b.lifecycle === "active" ? "hold" : "watch"}>
                {b.lifecycle === "active" ? "Active" : "Inactive"}
              </Pill>
              <span className="text-xs uppercase text-muted-foreground">{b.source}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular">
                {new Date(b.createdAt).toLocaleDateString()} · {num(b.rowsAccepted)} rows accepted
                {b.warnings ? ` · ${num(b.warnings)} warnings` : ""}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {b.sheets.length} sheet{b.sheets.length === 1 ? "" : "s"}
                {b.sheets.length
                  ? ` (${b.sheets
                      .filter((s) => s.kind !== "ignored")
                      .map((s) => s.sheet)
                      .slice(0, 4)
                      .join(", ")}${b.sheets.filter((s) => s.kind !== "ignored").length > 4 ? ", …" : ""})`
                  : ""}
              </span>
              {b.transactions > 0 ? <span>{num(b.transactions)} transactions</span> : null}
              {b.purchaseOrders > 0 ? <span>{num(b.purchaseOrders)} purchase orders</span> : null}
              {b.lifecycle === "inactive" ? (
                <span className="text-status-watch">Excluded from planning and recommendations</span>
              ) : null}
            </div>
            {canManage ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {b.lifecycle === "active" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={busyId === b.id}
                    onClick={() => void toggle(b, false)}
                  >
                    {busyId === b.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Deactivate
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={busyId === b.id}
                      onClick={() => void toggle(b, true)}
                    >
                      {busyId === b.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Reactivate
                    </Button>
                    <Button
                      size="sm"
                      variant={confirmId === b.id ? "destructive" : "ghost"}
                      className="h-7 text-xs"
                      disabled={busyId === b.id}
                      onClick={() => void remove(b)}
                    >
                      {confirmId === b.id ? "Confirm permanent delete" : "Delete permanently"}
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {batches.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No files imported yet.</p>
        ) : null}
      </div>
    </section>
  );
}