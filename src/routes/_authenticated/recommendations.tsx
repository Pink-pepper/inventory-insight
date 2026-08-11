import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { AppShell, EmptyState, TableSkeleton } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRecommendations, regenerate } from "@/lib/ionic.functions";
import { cover, money, num } from "@/lib/format";
import type { RecommendationAction } from "@/lib/domain/model";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/recommendations")({
  head: () => ({
    meta: [
      { title: "Purchasing recommendations — Ionic" },
      {
        name: "description",
        content:
          "SKU-level reorder, watch, hold and excess recommendations with quantities, costs and the reasoning behind each call.",
      },
      { property: "og:title", content: "Purchasing recommendations — Ionic" },
      {
        property: "og:description",
        content: "Reorder quantities, costs and reasoning for every SKU in the workspace.",
      },
    ],
  }),
  component: RecommendationsPage,
});

const FILTERS: (RecommendationAction | "ALL")[] = ["ALL", "REORDER", "WATCH", "HOLD", "EXCESS"];

type Row = NonNullable<Awaited<ReturnType<typeof getRecommendations>>>["rows"][number];

function Facts({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((line, i) => (
          <li key={i} className="text-xs leading-relaxed text-foreground">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Renders the engine's structured explanation. No calculations happen here. */
function DecisionDetail({ row }: { row: Row }) {
  const e = row.explanation;
  return (
    <div className="space-y-4 border-l-2 border-primary/40 bg-surface-muted/60 px-4 py-4">
      <div>
        <p className="text-sm font-semibold tracking-tight text-foreground">{e.headline}</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{e.why}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Facts heading="Demand" items={e.demand} />
        <Facts heading="Inventory" items={e.inventory} />
        <Facts heading="Policy" items={e.policy} />
      </div>
      {e.spend ? (
        <p className="text-xs text-foreground">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Estimated spend
          </span>{" "}
          <span className="ml-1 font-semibold tabular">{e.spend}</span>
        </p>
      ) : null}
      {row.dataQuality.length > 0 ? (
        <div className="rounded-sm border border-status-watch/30 bg-status-watch-soft px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-status-watch">
            Data quality
          </p>
          <ul className="mt-1 space-y-0.5">
            {row.dataQuality.map((d) => (
              <li key={d.field} className="text-xs text-foreground">
                {d.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RecommendationsPage() {
  const fn = useServerFn(getRecommendations);
  const regen = useServerFn(regenerate);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => fn(),
  });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => data?.rows ?? [], [data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((r) => (filter === "ALL" ? true : r.action === filter))
      .filter(
        (r) =>
          term === "" ||
          r.sku.toLowerCase().includes(term) ||
          r.name.toLowerCase().includes(term) ||
          r.category.toLowerCase().includes(term),
      )
      .sort((a, b) => b.estimatedCost - a.estimatedCost || a.daysOfCover - b.daysOfCover);
  }, [all, filter, search]);

  const blockedCount = all.filter((r) => r.blocked).length;

  async function refresh() {
    setBusy(true);
    try {
      const res = await regen({});
      await queryClient.invalidateQueries();
      toast.success(`Recalculated ${res.evaluated} SKUs`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not recalculate");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Recommendations"
      description="Rule-based purchasing actions derived from demand, lead time, safety stock and MOQ."
      actions={
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy || isLoading}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {busy ? "Recalculating" : "Recalculate"}
        </Button>
      }
    >
      {isLoading ? (
        <TableSkeleton columns={8} />
      ) : isError ? (
        <EmptyState
          title="Could not load recommendations"
          body={error instanceof Error ? error.message : "The decision engine did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : all.length === 0 ? (
        <EmptyState
          title="Nothing to recommend yet"
          body="Recommendations are generated from your canonical inventory and sales data. Load a dataset first."
          action={
            <Button asChild size="sm">
              <Link to="/data-sources">Go to Data Sources</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Calculated live from the current dataset.</span>
            {data?.lastRun?.generatedAt ? (
              <span className="tabular">
                Last stored run: {new Date(data.lastRun.generatedAt).toLocaleString()}
                {data.lastRun.runId ? ` · run ${data.lastRun.runId.slice(0, 8)}` : ""}
              </span>
            ) : null}
          </div>

          {blockedCount > 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-status-watch/30 bg-status-watch-soft px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-watch" />
              <p className="text-xs leading-relaxed text-foreground">
                {blockedCount} {blockedCount === 1 ? "SKU is" : "SKUs are"} missing supplier lead
                time. No reorder quantity is calculated for {blockedCount === 1 ? "it" : "them"}{" "}
                until that data is provided.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-surface p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors duration-150",
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.toLowerCase()}
                  <span className="ml-1.5 tabular opacity-70">
                    {f === "ALL" ? all.length : all.filter((r) => r.action === f).length}
                  </span>
                </button>
              ))}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU, product or category"
              className="h-9 max-w-xs"
              maxLength={80}
            />
            <span className="ml-auto text-xs text-muted-foreground tabular">
              {rows.length} rows · {money(rows.reduce((s, r) => s + r.estimatedCost, 0))} recommended
              spend
            </span>
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-surface-muted">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">SKU</th>
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 text-right font-medium">On hand</th>
                  <th className="px-3 py-2.5 text-right font-medium">On order</th>
                  <th className="px-3 py-2.5 text-right font-medium">Avg / mo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cover</th>
                  <th className="px-3 py-2.5 text-right font-medium">Lead time</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 text-right font-medium">Order qty</th>
                  <th className="px-3 py-2.5 text-right font-medium">Est. cost</th>
                  <th className="px-3 py-2.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded === r.sku;
                  return (
                    <>
                      <tr
                        key={r.sku}
                        className="border-t border-border/70 transition-colors duration-150 hover:bg-surface-muted/60"
                      >
                        <td className="px-3 py-2.5 font-mono text-xs">
                          <Link
                            to="/sku/$sku"
                            params={{ sku: r.sku }}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {r.sku}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">{r.name}</td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.onHand)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                          {r.onOrder ? num(r.onOrder) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.avgMonthlyDemand)}</td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right tabular",
                            r.stockoutRisk && "font-semibold text-status-reorder",
                          )}
                        >
                          {cover(r.daysOfCover)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.leadTimeDays == null ? (
                            <span className="text-status-watch">Missing</span>
                          ) : (
                            `${r.leadTimeDays} d`
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge action={r.action} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.recommendedQty ? num(r.recommendedQty) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.estimatedCost ? money(r.estimatedCost) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            onClick={() => setExpanded(open ? null : r.sku)}
                            aria-expanded={open}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {open ? "Hide" : "Explain"}
                            <ChevronDown
                              className={cn(
                                "size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                                open && "rotate-180",
                              )}
                            />
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr key={`${r.sku}-detail`} className="border-t border-border/70">
                          <td colSpan={11} className="p-0">
                            <DecisionDetail row={r} />
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                      No SKUs match this filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
