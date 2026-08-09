import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
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

function RecommendationsPage() {
  const fn = useServerFn(getRecommendations);
  const regen = useServerFn(regenerate);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["recommendations"], queryFn: () => fn() });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => (filter === "ALL" ? true : r.action === filter))
      .filter(
        (r) =>
          term === "" ||
          r.sku.toLowerCase().includes(term) ||
          r.name.toLowerCase().includes(term) ||
          r.category.toLowerCase().includes(term),
      )
      .sort((a, b) => b.estimatedCost - a.estimatedCost || a.daysOfCover - b.daysOfCover);
  }, [data, filter, search]);

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
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Recalculate
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Running the decision engine" />
      ) : (data ?? []).length === 0 ? (
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-surface p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.toLowerCase()}
                  <span className="ml-1.5 tabular opacity-70">
                    {f === "ALL"
                      ? (data ?? []).length
                      : (data ?? []).filter((r) => r.action === f).length}
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
              {rows.length} rows · {money(rows.reduce((s, r) => s + r.estimatedCost, 0))} recommended spend
            </span>
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-surface-muted">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">SKU</th>
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Avg / mo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cover</th>
                  <th className="px-3 py-2.5 text-right font-medium">Lead time</th>
                  <th className="px-3 py-2.5 text-right font-medium">MOQ</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 text-right font-medium">Order qty</th>
                  <th className="px-3 py-2.5 text-right font-medium">Est. cost</th>
                  <th className="px-3 py-2.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sku} className="border-t border-border/70 hover:bg-surface-muted/60">
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
                    <td className="px-3 py-2.5 text-muted-foreground">{r.category}</td>
                    <td className="px-3 py-2.5 text-right tabular">{num(r.onHand)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{num(r.avgMonthlyDemand)}</td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular",
                        r.stockoutRisk && "font-semibold text-status-reorder",
                      )}
                    >
                      {cover(r.daysOfCover)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{r.leadTimeDays} d</td>
                    <td className="px-3 py-2.5 text-right tabular">{num(r.minOrderQty)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge action={r.action} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {r.recommendedQty ? num(r.recommendedQty) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {r.estimatedCost ? money(r.estimatedCost) : "—"}
                    </td>
                    <td className="max-w-[320px] px-3 py-2.5 text-xs text-muted-foreground">
                      <span className="line-clamp-2">{r.reason}</span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
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