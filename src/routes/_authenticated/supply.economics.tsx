import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell, Loading } from "@/components/app-shell";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getSupplyBook } from "@/lib/supply.functions";
import { computeLandedCost, selectComponents } from "@/lib/economics/landed-cost";
import {
  COST_BASES,
  COST_BASIS_LABEL,
  COST_COMPONENT_KINDS,
  COST_KIND_LABEL,
} from "@/lib/domain/supply-chain";
import { money, num } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/supply/economics")({
  head: () => ({
    meta: [
      { title: "Landed economics — Ionic" },
      {
        name: "description",
        content:
          "Supplier price, freight, duty, clearance and FX built up into a landed cost, gross profit and margin per buying decision.",
      },
      { property: "og:title", content: "Landed economics — Ionic" },
      {
        property: "og:description",
        content: "Can I buy this and still make money? The full cost build-up, step by step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EconomicsPage,
});

function EconomicsPage() {
  const fn = useServerFn(getSupplyBook);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supply-book"],
    queryFn: () => fn(),
  });

  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("100");
  const [sellingPrice, setSellingPrice] = useState<string>("");

  const supplierProductFields: FieldSpec[] = useMemo(
    () => [
      {
        key: "supplier_id",
        label: "Supplier",
        type: "select",
        required: true,
        options: (data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
      },
      {
        key: "product_id",
        label: "Product",
        type: "select",
        required: true,
        options: (data?.products ?? []).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
      },
      { key: "supplier_price", label: "Supplier price", type: "number" },
      { key: "currency_code", label: "Currency", type: "text" },
      { key: "min_order_qty", label: "Minimum order qty", type: "number" },
      { key: "lead_time_days", label: "Lead time (days)", type: "number" },
      {
        key: "is_active",
        label: "Active",
        type: "select",
        required: true,
        defaultValue: "true",
        options: [
          { value: "true", label: "Active" },
          { value: "false", label: "Inactive" },
        ],
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [data],
  );

  const componentFields: FieldSpec[] = useMemo(
    () => [
      {
        key: "kind",
        label: "Kind",
        type: "select",
        required: true,
        defaultValue: "freight",
        options: COST_COMPONENT_KINDS.map((k) => ({ value: k, label: COST_KIND_LABEL[k] })),
      },
      { key: "amount", label: "Amount", type: "number", required: true },
      {
        key: "basis",
        label: "Basis",
        type: "select",
        required: true,
        defaultValue: "per_unit",
        options: COST_BASES.map((b) => ({ value: b, label: COST_BASIS_LABEL[b] })),
      },
      { key: "label", label: "Label", type: "text" },
      {
        key: "product_id",
        label: "Product",
        type: "select",
        help: "Leave blank to apply to every product in scope.",
        options: (data?.products ?? []).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
      },
      {
        key: "supplier_id",
        label: "Supplier",
        type: "select",
        options: (data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
      },
      {
        key: "shipment_id",
        label: "Shipment",
        type: "select",
        options: (data?.shipments ?? []).map((s) => ({ value: s.id, label: s.reference })),
      },
      { key: "currency_code", label: "Currency", type: "text" },
      { key: "effective_from", label: "Effective from", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [data],
  );

  const result = useMemo(() => {
    if (!data || !productId) return null;
    const sp = data.supplierProducts.find((r) => r.productId === productId && r.isActive) ?? null;
    const components = selectComponents(data.costComponents, {
      productId,
      supplierId: sp?.supplierId ?? null,
      shipmentId: null,
    });
    return {
      supplierProduct: sp,
      result: computeLandedCost({
        quantity: Number(quantity) || 0,
        supplierPrice: sp?.supplierPrice ?? null,
        fxRate: null,
        components: components.map((c) => ({ kind: c.kind, amount: c.amount, basis: c.basis })),
        sellingPrice: sellingPrice === "" ? null : Number(sellingPrice),
      }),
    };
  }, [data, productId, quantity, sellingPrice]);

  return (
    <AppShell
      title="Landed economics"
      description="Supplier price → FX → freight → duty → clearance → other. Every step is a record you entered, never an estimate."
    >
      {isLoading ? (
        <Loading label="Loading landed economics" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load landed economics."}
        </p>
      ) : !data ? null : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Can I buy this and still make money?</h2>
              <p className="text-sm text-muted-foreground">
                Pick a product to see its cost build-up. Without a supplier price the recorded unit cost is
                used, and the result says so.
              </p>
            </div>
            <div className="panel space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="product" className="text-xs">
                    Product
                  </Label>
                  <select
                    id="product"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select a product</option>
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="qty" className="text-xs">
                    Quantity
                  </Label>
                  <Input
                    id="qty"
                    className="mt-1"
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="price" className="text-xs">
                    Selling price (per unit)
                  </Label>
                  <Input
                    id="price"
                    className="mt-1"
                    type="number"
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              {result == null ? (
                <p className="text-sm text-muted-foreground">Select a product to see the build-up.</p>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Cost build-up (per unit)
                    </p>
                    <div className="mt-2 divide-y divide-border border-t border-border">
                      {result.result.steps.map((s) => (
                        <div key={s.key + s.label} className="flex items-center justify-between py-2 text-sm">
                          <span className="text-muted-foreground">{s.label}</span>
                          <span className="tabular-nums">
                            {money(s.perUnit, 2)}{" "}
                            <span className="text-muted-foreground">→ {money(s.runningTotal, 2)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    {result.result.usedFallbackCost ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        No supplier price recorded for this product — the workspace unit cost was used.
                      </p>
                    ) : null}
                    {!result.result.hasComponents ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        No cost components apply, so landed cost equals the goods value.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3 self-start">
                    {[
                      { label: "Landed unit cost", value: money(result.result.landedUnitCost, 2) },
                      { label: "Landed total", value: money(result.result.landedTotal, 2) },
                      {
                        label: "Gross profit / unit",
                        value:
                          result.result.grossProfitPerUnit == null
                            ? "Needs a selling price"
                            : money(result.result.grossProfitPerUnit, 2),
                      },
                      {
                        label: "Margin",
                        value:
                          result.result.marginPct == null
                            ? "—"
                            : `${num(result.result.marginPct * 100, 1)}%`,
                      },
                    ].map((k) => (
                      <div key={k.label} className="panel px-4 py-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {k.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{k.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Supplier prices</h2>
              <p className="text-sm text-muted-foreground">
                What each supplier charges for each product, with their own MOQ and lead time.
              </p>
            </div>
            <BusinessRecordTable
              table="supplier_products"
              domain="supply"
              invalidate={[["supply-book"]]}
              rows={data.supplierProducts}
              newLabel="New supplier price"
              emptyTitle="No supplier prices"
              emptyBody="Record what each supplier charges so landed cost starts from a real price."
              columns={[
                { label: "Product", render: (r) => r.sku ?? "—" },
                { label: "Supplier", render: (r) => r.supplierName ?? "—" },
                {
                  label: "Price",
                  className: "text-right",
                  render: (r) => (r.supplierPrice == null ? "—" : money(r.supplierPrice, 2)),
                },
                { label: "Currency", render: (r) => r.currencyCode ?? "—" },
                { label: "Status", render: (r) => (r.isActive ? "Active" : "Inactive") },
              ]}
              details={[
                { label: "Product name", render: (r) => r.productName ?? "—" },
                { label: "MOQ", render: (r) => (r.minOrderQty == null ? "—" : num(r.minOrderQty)) },
                {
                  label: "Lead time",
                  render: (r) => (r.leadTimeDays == null ? "—" : `${num(r.leadTimeDays)} d`),
                },
                { label: "Notes", render: (r) => r.notes ?? "—" },
              ]}
              fields={supplierProductFields}
              toValues={(r) => ({
                supplier_id: r.supplierId,
                product_id: r.productId,
                supplier_price: r.supplierPrice,
                currency_code: r.currencyCode,
                min_order_qty: r.minOrderQty,
                lead_time_days: r.leadTimeDays,
                is_active: r.isActive,
                notes: r.notes,
              })}
            />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Cost components</h2>
              <p className="text-sm text-muted-foreground">
                Freight, duty, clearance, FX and other costs. A shipment component beats a product one, which
                beats a supplier default.
              </p>
            </div>
            <BusinessRecordTable
              table="cost_components"
              domain="supply"
              invalidate={[["supply-book"]]}
              rows={data.costComponents}
              newLabel="New cost component"
              emptyTitle="No cost components"
              emptyBody="Add freight, duty and clearance costs to turn supplier price into landed cost."
              columns={[
                { label: "Kind", render: (c) => COST_KIND_LABEL[c.kind] },
                { label: "Amount", className: "text-right", render: (c) => num(c.amount, 2) },
                { label: "Basis", render: (c) => COST_BASIS_LABEL[c.basis] },
                {
                  label: "Scope",
                  render: (c) =>
                    c.shipmentReference ?? c.sku ?? c.supplierName ?? "Workspace default",
                },
              ]}
              details={[
                { label: "Label", render: (c) => c.label ?? "—" },
                { label: "Currency", render: (c) => c.currencyCode ?? "—" },
                { label: "Effective from", render: (c) => c.effectiveFrom ?? "—" },
                { label: "Notes", render: (c) => c.notes ?? "—" },
              ]}
              fields={componentFields}
              toValues={(c) => ({
                kind: c.kind,
                amount: c.amount,
                basis: c.basis,
                label: c.label,
                product_id: c.productId,
                supplier_id: c.supplierId,
                shipment_id: c.shipmentId,
                currency_code: c.currencyCode,
                effective_from: c.effectiveFrom,
                notes: c.notes,
              })}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
