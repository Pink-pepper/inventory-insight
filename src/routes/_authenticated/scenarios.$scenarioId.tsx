/**
 * Scenario workspace: edit the definition, run it against current data, and
 * inspect any recorded run. A run is an immutable snapshot — selecting an
 * older version shows exactly what was computed then, against the inputs that
 * existed then.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { FlaskConical, Play, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, Loading, TableSkeleton, useProductLabel } from "@/components/app-shell";
import { ScenarioForm, type ScenarioFormValues } from "@/components/scenario-form";
import { Pill, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getScenario, getScenarioRun, runScenario, updateScenario } from "@/lib/ionic.functions";
import { money, num } from "@/lib/format";
import type { Comparison, ScenarioRowResult, SummaryComparison } from "@/lib/scenario/compare";
import { riskText } from "@/lib/supply/explain";

export const Route = createFileRoute("/_authenticated/scenarios/$scenarioId")({
  head: () => ({
    meta: [
      { title: "Scenario — Ionic" },
      { name: "description", content: "Scenario definition, runs, and baseline comparison." },
      { property: "og:title", content: "Scenario — Ionic" },
      { property: "og:description", content: "Scenario definition, runs, and baseline comparison." },
    ],
  }),
  component: ScenarioDetailPage,
});

function ScenarioDetailPage() {
  const { scenarioId } = Route.useParams();
  const detailFn = useServerFn(getScenario);
  const runFn = useServerFn(getScenarioRun);
  const executeFn = useServerFn(runScenario);
  const updateFn = useServerFn(updateScenario);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["scenario", scenarioId],
    queryFn: () => detailFn({ data: { scenarioId } }),
  });

  const latestRunId = data?.runs[0]?.id ?? null;
  const activeRunId = selectedRunId ?? latestRunId;

  const runQuery = useQuery({
    queryKey: ["scenario-run", activeRunId],
    queryFn: () => runFn({ data: { runId: activeRunId! } }),
    enabled: activeRunId != null,
  });

  // A freshly recorded run becomes the selected one once its snapshot loads.
  useEffect(() => {
    setSelectedRunId(null);
  }, [scenarioId]);

  const runMutation = useMutation({
    mutationFn: () => executeFn({ data: { scenarioId } }),
    onSuccess: async ({ runId, version }) => {
      await queryClient.invalidateQueries({ queryKey: ["scenario", scenarioId] });
      setSelectedRunId(runId);
      toast.success(`Run v${version} recorded`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The scenario run failed."),
  });

  const updateMutation = useMutation({
    mutationFn: (values: ScenarioFormValues) =>
      updateFn({
        data: {
          scenarioId,
          patch: {
            name: values.name,
            description: values.description,
            scope: values.scope,
            assumptions: values.assumptions,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scenario", scenarioId] });
      await queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      setEditing(false);
      toast.success("Scenario updated — run it again to compare under the new assumptions");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the scenario."),
  });

  const statusMutation = useMutation({
    mutationFn: (status: "draft" | "active" | "archived") =>
      updateFn({ data: { scenarioId, patch: { status } } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scenario", scenarioId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change the status."),
  });

  return (
    <AppShell
      title={data?.scenario.name ?? "Scenario"}
      description={data?.scenario.description ?? "Scenario definition and run results."}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/scenarios">All scenarios</Link>
          </Button>
          {data ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 size-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                disabled={runMutation.isPending}
                onClick={() => runMutation.mutate()}
              >
                <Play className="mr-1 size-3.5" />
                {runMutation.isPending ? "Running…" : "Run scenario"}
              </Button>
            </>
          ) : null}
        </div>
      }
    >
      {isLoading ? (
        <Loading label="Loading scenario" />
      ) : isError ? (
        <EmptyState
          title="Could not load the scenario"
          body={error instanceof Error ? error.message : "The scenario query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? null : (
        <div className="space-y-4">
          <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <span className="flex items-center gap-2">
              <FlaskConical className="size-4 text-muted-foreground" />
              <Pill tone={data.scenario.status === "active" ? "hold" : data.scenario.status === "draft" ? "watch" : "neutral"}>
                {data.scenario.status}
              </Pill>
            </span>
            <span className="text-xs text-muted-foreground">
              Created {new Date(data.scenario.createdAt).toLocaleDateString()}
            </span>
            <span className="text-xs text-muted-foreground">
              {data.runs.length} run{data.runs.length === 1 ? "" : "s"} recorded
            </span>
            <span className="ml-auto flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Status:</span>
              {(["draft", "active", "archived"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={statusMutation.isPending || data.scenario.status === s}
                  onClick={() => statusMutation.mutate(s)}
                  className={`rounded-sm px-2 py-0.5 capitalize ${
                    data.scenario.status === s
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </span>
          </div>

          {data.runs.length > 0 ? (
            <div className="panel px-4 py-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Run history
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRunId(r.id)}
                    className={`rounded-sm border px-2.5 py-1 text-xs ${
                      r.id === activeRunId
                        ? "border-primary bg-accent font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-surface-muted"
                    }`}
                  >
                    v{r.version} · {new Date(r.createdAt).toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {runQuery.isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : runQuery.isError ? (
            <EmptyState
              title="Could not load the run"
              body={
                runQuery.error instanceof Error
                  ? runQuery.error.message
                  : "The run snapshot did not load."
              }
              action={
                <Button size="sm" onClick={() => void runQuery.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : runQuery.data ? (
            <RunResultView run={runQuery.data.run} />
          ) : (
            <EmptyState
              title="Never run"
              body="Run the scenario to compute both plans side by side: the live baseline and the same data under this scenario's assumptions. Nothing you run here changes live recommendations."
              action={
                <Button size="sm" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
                  <Play className="mr-1 size-3.5" /> Run now
                </Button>
              }
            />
          )}
        </div>
      )}

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit scenario</DialogTitle>
            <DialogDescription>
              Changing assumptions never alters runs already recorded — run again to create a new
              version.
            </DialogDescription>
          </DialogHeader>
          {data ? (
            <ScenarioForm
              initial={{
                name: data.scenario.name,
                description: data.scenario.description,
                scope: data.scenario.scope,
                assumptions: data.scenario.assumptions,
              }}
              options={data.options}
              policy={data.policy}
              submitting={updateMutation.isPending}
              submitLabel="Save changes"
              onSubmit={(values) => updateMutation.mutate(values)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ChangeCell({ comparison, kind }: { comparison: Comparison; kind: "count" | "units" | "money" }) {
  const fmt = (v: number | null) =>
    v == null ? "—" : kind === "money" ? money(v) : num(v);
  const c = comparison;
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular">{fmt(c.baseline)}</td>
      <td className="px-3 py-2.5 text-right tabular">{fmt(c.scenario)}</td>
      <td className="px-3 py-2.5 text-right tabular">
        {c.change == null || c.change === 0 ? (
          <span className="text-muted-foreground">no change</span>
        ) : (
          <span className={c.change > 0 ? "text-status-reorder" : "text-status-hold"}>
            {c.change > 0 ? "+" : "−"}
            {fmt(Math.abs(c.change))}
            {c.changePct != null ? (
              <span className="ml-1 text-[11px] text-muted-foreground">
                ({c.changePct > 0 ? "+" : ""}
                {c.changePct}%)
              </span>
            ) : null}
          </span>
        )}
      </td>
    </>
  );
}

function RunResultView({ run }: { run: import("@/lib/scenario/types").ScenarioRunRecord }) {
  const result = run.result;
  const label = useProductLabel();
  return (
    <div className="space-y-4">
      <div className="panel px-4 py-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Run v{run.version} — assumptions under test
        </h2>
        {result.assumptionLines.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No assumptions (pure baseline run).</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {result.assumptionLines.map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Executed {new Date(run.inputProvenance.executedAt).toLocaleString()} against{" "}
          {num(run.inputProvenance.skuCount)} SKUs, {num(run.inputProvenance.factCount)} demand
          facts and {num(run.inputProvenance.openPoCount)} open purchase orders
          {result.horizonStart
            ? ` · horizon ${result.horizonStart.slice(0, 7)} +${result.horizonPeriods - 1} month(s)`
            : ""}
          . This snapshot is frozen; later data changes do not alter it.
        </p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-muted">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Metric</th>
              <th className="px-3 py-2 text-right font-medium">Baseline</th>
              <th className="px-3 py-2 text-right font-medium">Scenario</th>
              <th className="px-3 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {result.summaryComparison.map((m: SummaryComparison) => (
              <tr key={m.label} className="border-t border-border/70 align-top">
                <td className="px-3 py-2.5">
                  <span className="font-medium text-foreground">{m.label}</span>
                  {m.note ? (
                    <span className="block text-[11px] text-status-watch">{m.note}</span>
                  ) : null}
                </td>
                <ChangeCell comparison={m.comparison} kind={m.kind} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.explanation.length > 0 ? (
        <div className="panel px-4 py-3.5">
          <h2 className="text-sm font-semibold text-foreground">Why the plan moved</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {result.explanation.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.rowsTruncated ? (
        <div className="panel border-l-2 border-l-status-watch px-4 py-3 text-sm text-muted-foreground">
          The run covered more SKUs than a snapshot can hold; this table keeps the rows that moved
          most.
        </div>
      ) : null}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-surface-muted">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 text-right font-medium">Suggested qty</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 font-medium">Stockout</th>
              <th className="px-3 py-2 font-medium">Risk change</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r: ScenarioRowResult) => (
              <tr key={r.sku} className="border-t border-border/70 align-top">
                <td className="px-3 py-2.5">
                  <span className="font-medium text-foreground">{label(r.sku, r.name)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.category} · {r.supplierName}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <StatusBadge action={r.baseline.engineAction} />
                    <span className="text-muted-foreground">→</span>
                    <StatusBadge action={r.scenario.engineAction} />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  {fmtQty(r.baseline.suggestedQty)} → {fmtQty(r.scenario.suggestedQty)}
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  {r.baseline.spend != null || r.scenario.spend != null
                    ? `${r.baseline.spend != null ? money(r.baseline.spend) : "—"} → ${
                        r.scenario.spend != null ? money(r.scenario.spend) : "—"
                      }`
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {r.baseline.firstStockout?.slice(0, 7) ?? "none"} →{" "}
                  {r.scenario.firstStockout?.slice(0, 7) ?? "none"}
                </td>
                <td className="max-w-[300px] px-3 py-2.5 text-xs">
                  {r.gainedRisks.map((f) => (
                    <span key={f} className="mb-0.5 block text-status-reorder">
                      + {riskText(f)}
                    </span>
                  ))}
                  {r.resolvedRisks.map((f) => (
                    <span key={f} className="mb-0.5 block text-status-hold">
                      − resolved: {riskText(f)}
                    </span>
                  ))}
                  {r.gainedRisks.length === 0 && r.resolvedRisks.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel px-4 py-4">
        <h2 className="text-sm font-semibold text-foreground">How to read this run</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            Baseline is the live plan recomputed at run time from the same data — the same numbers
            the Supply and Distribution workspaces would have shown at that moment.
          </li>
          <li>
            Percentage change appears only against a non-zero baseline; a zero baseline with a
            scenario value is a new figure, not a percentage.
          </li>
          <li>
            A dash means the figure could not be computed on that side (for example no demand
            baseline) — it is never read as zero or as “no change”.
          </li>
          <li>Nothing in a run writes to products, inventory, purchase orders or recommendations.</li>
        </ul>
      </div>
    </div>
  );
}

function fmtQty(v: number | null): string {
  return v == null ? "—" : num(v);
}
