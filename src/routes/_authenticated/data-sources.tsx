import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Database as DatabaseIcon, Plug, Loader2 } from "lucide-react";
import { AppShell, useWorkspace } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getAuditLog, ingestDataset } from "@/lib/ionic.functions";
import { num } from "@/lib/format";
import type { IngestionIssue, IngestionStats } from "@/lib/connectors/types";

export const Route = createFileRoute("/_authenticated/data-sources")({
  head: () => ({
    meta: [
      { title: "Data sources & connectors — Ionic" },
      {
        name: "description",
        content:
          "Upload a CSV extract or load the demo dataset. Every source maps into Ionic's canonical inventory model.",
      },
      { property: "og:title", content: "Data sources & connectors — Ionic" },
      {
        property: "og:description",
        content: "CSV upload today, ERP connectors next — all normalized into one internal model.",
      },
    ],
  }),
  component: DataSourcesPage,
});

const PLANNED = ["Odoo", "SAP Business One", "Microsoft Dynamics", "NetSuite", "Custom API"];

const TEMPLATE = `sku,product_name,category,supplier,supplier_lead_time_days,min_order_qty,unit_cost,on_hand,on_order,safety_stock_days,period_month,units_sold
SKU-1001,Hex Bolt M8,Fasteners,Northwind Supply,21,100,1.85,420,0,14,2025-01-01,310`;

function DataSourcesPage() {
  const ingest = useServerFn(ingestDataset);
  const auditFn = useServerFn(getAuditLog);
  const queryClient = useQueryClient();
  const { data: workspace } = useWorkspace();
  const { data: auditLog } = useQuery({ queryKey: ["audit"], queryFn: () => auditFn() });
  const [busy, setBusy] = useState<"demo" | "csv" | null>(null);
  const [issues, setIssues] = useState<IngestionIssue[]>([]);
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(kind: "demo" | "csv", payload: { filename?: string; content?: string } = {}) {
    setBusy(kind);
    setIssues([]);
    setStats(null);
    try {
      const res = await ingest({ data: { source: kind, ...payload } });
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
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onFile(file: File): Promise<void> {
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Please choose a .csv file.");
      return;
    }
    if (file.size > 5_000_000) {
      toast.error("File exceeds the 5 MB limit.");
      return;
    }
    const content = await file.text();
    await run("csv", { filename: file.name, content });
  }

  return (
    <AppShell
      title="Data Sources"
      description="Connect the systems that describe your stock. Everything is normalized into Ionic's canonical model."
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel p-5">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">CSV upload</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              One row per SKU per month. Column names are matched flexibly (for example{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">qty_on_hand</code>,{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">stock</code> and{" "}
              <code className="rounded-sm bg-muted px-1 py-0.5 text-xs">on_hand</code> all map to the
              same canonical field).
            </p>
            <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
              {TEMPLATE}
            </pre>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <Button
              className="mt-4"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
            >
              {busy === "csv" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Upload CSV
            </Button>
          </section>

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
              <Button size="sm" variant="outline" onClick={() => run("demo")} disabled={busy !== null}>
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