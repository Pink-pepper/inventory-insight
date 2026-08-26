import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, TableSkeleton } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { getSupplierMaster } from "@/lib/master-data.functions";

export const Route = createFileRoute("/_authenticated/master/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — Ionic master data" },
      {
        name: "description",
        content:
          "Suppliers with terms, incoterms, lead times, supplied products and on-time performance derived from recorded shipment arrivals.",
      },
      { property: "og:title", content: "Suppliers — Ionic master data" },
      {
        property: "og:description",
        content: "Supplier terms, supplied products and measured delivery performance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuppliersPage,
});

function SuppliersPage() {
  const fn = useServerFn(getSupplierMaster);
  const { data, isLoading } = useQuery({ queryKey: ["supplier-master"], queryFn: () => fn() });
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = data ?? [];
    if (!term) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(term) || (s.code ?? "").toLowerCase().includes(term),
    );
  }, [data, q]);

  return (
    <AppShell
      title="Suppliers"
      description="Who supplies what, on what terms. On-time performance is only shown where an arrival was recorded against a promised date."
      actions={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search supplier"
          className="w-64"
        />
      }
    >
      {isLoading ? (
        <TableSkeleton columns={7} />
      ) : rows.length === 0 ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          No suppliers match this search.
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Supplier</th>
                <th className="px-3 py-2.5 font-medium">Code</th>
                <th className="px-3 py-2.5 font-medium">Country</th>
                <th className="px-3 py-2.5 font-medium">Terms</th>
                <th className="px-3 py-2.5 font-medium">Incoterm</th>
                <th className="px-3 py-2.5 text-right font-medium">Lead time</th>
                <th className="px-3 py-2.5 text-right font-medium">Products</th>
                <th className="px-3 py-2.5 text-right font-medium">Open POs</th>
                <th className="px-3 py-2.5 text-right font-medium">On time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-surface-muted/60">
                  <td className="px-3 py-2.5 font-medium">{s.name}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {s.code ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.country ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.paymentTerms ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.incoterm ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular">{s.leadTimeDays} d</td>
                  <td className="px-3 py-2.5 text-right tabular">{s.products.length}</td>
                  <td className="px-3 py-2.5 text-right tabular">{s.openPurchaseOrders}</td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {s.onTimePct == null ? (
                      <span className="text-muted-foreground">No arrivals recorded</span>
                    ) : (
                      `${s.onTimePct.toFixed(0)}% of ${s.shipmentsTracked}`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
