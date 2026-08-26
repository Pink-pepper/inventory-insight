import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, TableSkeleton } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { getProductMaster } from "@/lib/master-data.functions";
import { grossProfit, marginPct } from "@/lib/domain/master-data";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/master/products")({
  head: () => ({
    meta: [
      { title: "Products — Ionic master data" },
      {
        name: "description",
        content:
          "Every product with its pack size, stock, selling price, landed cost, gross profit and the suppliers that can supply it.",
      },
      { property: "og:title", content: "Products — Ionic master data" },
      {
        property: "og:description",
        content: "Product portfolio with landed cost, margin and supply options.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const fn = useServerFn(getProductMaster);
  const { data, isLoading } = useQuery({ queryKey: ["product-master"], queryFn: () => fn() });
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = data ?? [];
    if (!term) return all;
    return all.filter(
      (p) =>
        p.sku.toLowerCase().includes(term) ||
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term),
    );
  }, [data, q]);

  return (
    <AppShell
      title="Products"
      description="The portfolio, priced. Landed cost is used where cost components exist; otherwise the recorded unit cost stands."
      actions={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search SKU, name or category"
          className="w-64"
        />
      }
    >
      {isLoading ? (
        <TableSkeleton columns={8} />
      ) : rows.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          No products match this search.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">SKU</th>
                <th className="px-3 py-2.5 font-medium">Product</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 text-right font-medium">Pack</th>
                <th className="px-3 py-2.5 text-right font-medium">In stock</th>
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                <th className="px-3 py-2.5 text-right font-medium">GP</th>
                <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                <th className="px-3 py-2.5 text-right font-medium">Suppliers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => {
                const gp = grossProfit(p);
                const m = marginPct(p);
                return (
                  <tr key={p.id} className="hover:bg-surface-muted/60">
                    <td className="px-3 py-2.5 font-mono text-xs">{p.sku}</td>
                    <td className="px-3 py-2.5 font-medium">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.category}</td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                      {p.packSize == null ? "—" : `${num(p.packSize, 2)} ${p.packUom ?? ""}`.trim()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{num(p.unitsInStock)}</td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {p.unitPrice == null ? "—" : money(p.unitPrice, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {money(p.landedCost ?? p.unitCost, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {gp == null ? "—" : money(gp, 2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {m == null ? "—" : `${m.toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                      {p.suppliers.length}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
