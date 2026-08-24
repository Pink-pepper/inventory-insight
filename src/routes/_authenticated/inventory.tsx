import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell, EmptyState, TableSkeleton, useProductLabel } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { PlanningFilters } from "@/components/planning-filters";
import { getDemandPlan, getRecommendations } from "@/lib/ionic.functions";
import type { PlanningFilter } from "@/lib/query/filters";
import { applyPlanningFilter } from "@/lib/query/filters";
import { cover, money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory positions — Ionic" },
      {
        name: "description",
        content:
          "Every SKU with on-hand quantity, on-order quantity, stock cover, supplier and inventory value.",
      },
      { property: "og:title", content: "Inventory positions — Ionic" },
      {
        property: "og:description",
        content: "On-hand, on-order, cover and value for every SKU in the canonical model.",
      },
    ],
  }),
  component: InventoryPage,
});

function InventoryPage() {
  const fn = useServerFn(getRecommendations);
  const planFn = useServerFn(getDemandPlan);
  const label = useProductLabel();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => fn(),
  });
  const [filter, setFilter] = useState<PlanningFilter>({ compare: "prev" });

  // Demand context for the same scope: direction comes from the demand
  // workspace so both screens explain movement with identical numbers.
  const { data: demand } = useQuery({
    queryKey: ["demand-plan", "inventory", filter],
    queryFn: () => planFn({ data: { filter, dimension: "product" } }),
  });
  const directionBySku = useMemo(
    () => new Map((demand?.plan.skuDirection ?? []).map((d) => [d.sku, d])),
    [demand],
  );

  const all = useMemo(() => data?.rows ?? [], [data]);

  const rows = useMemo(() => {
    const filterable = all.map((r) => ({
      ...r,
      locationCodes: r.locations.map((l) => l.location),
    }));
    return applyPlanningFilter(filterable, filter).sort(
      (a, b) => b.inventoryValue - a.inventoryValue,
    );
  }, [all, filter]);

  return (
    <AppShell
      title="Inventory"
      description="On-hand and inbound stock positions across all products and locations."
    >
      {isLoading ? (
        <TableSkeleton columns={9} />
      ) : isError ? (
        <EmptyState
          title="Could not load inventory"
          body={error instanceof Error ? error.message : "The inventory query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : all.length === 0 ? (
        <EmptyState
          title="No inventory loaded"
          body="Once a data source is connected, every product position appears here with cover and value."
          action={
            <Button asChild size="sm">
              <Link to="/data-sources">Go to Data Sources</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {demand ? (
            <PlanningFilters
              filter={filter}
              options={demand.options}
              onChange={setFilter}
              showGrain={false}
              showCompare
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="ml-auto text-xs text-muted-foreground tabular">
              {rows.length} SKUs · {money(rows.reduce((s, r) => s + r.inventoryValue, 0))} at cost
            </span>
          </div>

          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-surface-muted">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">SKU</th>
                  <th className="px-3 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Supplier</th>
                  <th className="px-3 py-2.5 text-right font-medium">On hand</th>
                  <th className="px-3 py-2.5 text-right font-medium">On order</th>
                  <th className="px-3 py-2.5 font-medium">Locations</th>
                  <th className="px-3 py-2.5 text-right font-medium">Demand</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cover</th>
                  <th className="px-3 py-2.5 text-right font-medium">Unit cost</th>
                  <th className="px-3 py-2.5 text-right font-medium">Value</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
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
                    <td className="px-3 py-2.5">{label(r.sku, r.name)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.category}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.supplierName}</td>
                    <td className="px-3 py-2.5 text-right tabular">{num(r.onHand)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                      {r.onOrder ? num(r.onOrder) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {r.locations.length === 0
                        ? "—"
                        : r.locations.length === 1
                          ? r.locations[0]!.location
                          : `${r.locations.length} locations`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                      {directionBySku.get(r.sku)?.changePct == null
                        ? "—"
                        : `${directionBySku.get(r.sku)!.changePct! > 0 ? "+" : ""}${
                            directionBySku.get(r.sku)!.changePct
                          }%`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{cover(r.daysOfCover)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.unitCost, 2)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.inventoryValue)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge action={r.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}