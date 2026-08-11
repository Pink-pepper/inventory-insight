import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell, EmptyState, TableSkeleton } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRecommendations } from "@/lib/ionic.functions";
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
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recommendations"],
    queryFn: () => fn(),
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");

  const all = useMemo(() => data?.rows ?? [], [data]);

  const categories = useMemo(() => ["ALL", ...new Set(all.map((r) => r.category))], [all]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((r) => category === "ALL" || r.category === category)
      .filter((r) => term === "" || r.sku.toLowerCase().includes(term) || r.name.toLowerCase().includes(term))
      .sort((a, b) => b.inventoryValue - a.inventoryValue);
  }, [all, search, category]);

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
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU or product"
              className="h-9 max-w-xs"
              maxLength={80}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "ALL" ? "All categories" : c}
                </option>
              ))}
            </select>
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
                    <td className="px-3 py-2.5">{r.name}</td>
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