import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell, Loading } from "@/components/app-shell";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getSupplyBook } from "@/lib/supply.functions";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABEL,
  effectiveEta,
  shipmentDelayDays,
} from "@/lib/domain/supply-chain";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/supply/")({
  head: () => ({
    meta: [
      { title: "Shipments — Ionic" },
      {
        name: "description",
        content:
          "Track every inbound shipment against its purchase orders: departure, ETA, revised arrival and delay.",
      },
      { property: "og:title", content: "Shipments — Ionic" },
      {
        property: "og:description",
        content: "One purchase order, many shipments — each with its own arrival date and status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShipmentsPage,
});

function ShipmentsPage() {
  const fn = useServerFn(getSupplyBook);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supply-book"],
    queryFn: () => fn(),
  });

  const shipmentFields: FieldSpec[] = useMemo(
    () => [
      { key: "reference", label: "Reference", type: "text", required: true },
      {
        key: "supplier_id",
        label: "Supplier",
        type: "select",
        options: (data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        required: true,
        defaultValue: "planned",
        options: SHIPMENT_STATUSES.map((s) => ({ value: s, label: SHIPMENT_STATUS_LABEL[s] })),
      },
      { key: "mode", label: "Mode", type: "text", help: "Sea, air, road — as your forwarder calls it." },
      { key: "incoterm", label: "Incoterm", type: "text" },
      { key: "etd", label: "Departure (ETD)", type: "date" },
      { key: "eta", label: "Original ETA", type: "date" },
      { key: "revised_eta", label: "Revised ETA", type: "date" },
      { key: "arrived_on", label: "Arrived on", type: "date" },
      { key: "cleared_on", label: "Cleared on", type: "date" },
      { key: "delivered_on", label: "Delivered on", type: "date" },
      { key: "currency_code", label: "Currency", type: "text" },
      { key: "fx_rate", label: "FX rate", type: "number", help: "Multiplier into your reporting currency." },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [data],
  );

  const lineFields: FieldSpec[] = useMemo(
    () => [
      {
        key: "shipment_id",
        label: "Shipment",
        type: "select",
        required: true,
        options: (data?.shipments ?? []).map((s) => ({ value: s.id, label: s.reference })),
      },
      {
        key: "purchase_order_id",
        label: "Purchase order",
        type: "select",
        help: "Links this arrival to the order it fulfils, so supply is phased by shipment.",
        options: (data?.purchaseOrders ?? []).map((p) => ({
          value: p.id,
          label: `${p.poNumber ?? "PO"} · ${p.sku ?? "—"}`,
        })),
      },
      {
        key: "product_id",
        label: "Product",
        type: "select",
        options: (data?.products ?? []).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
      },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "unit_cost", label: "Unit cost", type: "number" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    [data],
  );

  const allLines = useMemo(() => (data?.shipments ?? []).flatMap((s) => s.lines), [data]);

  return (
    <AppShell
      title="Shipments"
      description="A purchase order is a commitment; a shipment is the arrival. One order can land across several shipments, each with its own ETA."
    >
      {isLoading ? (
        <Loading label="Loading shipments" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load shipments."}
        </p>
      ) : !data ? null : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Shipments</h2>
              <p className="text-sm text-muted-foreground">
                Delay is measured against the original ETA — nothing is inferred when a date is missing.
              </p>
            </div>
            <BusinessRecordTable
              table="shipments"
              domain="supply"
              invalidate={[["supply-book"], ["supply-plan"], ["overview"]]}
              rows={data.shipments}
              newLabel="New shipment"
              emptyTitle="No shipments recorded"
              emptyBody="Add a shipment and link its lines to purchase orders to phase inbound supply by arrival."
              columns={[
                { label: "Reference", render: (s) => s.reference },
                { label: "Supplier", render: (s) => s.supplierName ?? "—" },
                { label: "Status", render: (s) => SHIPMENT_STATUS_LABEL[s.status] },
                { label: "Expected", render: (s) => effectiveEta(s) ?? "Unscheduled" },
                {
                  label: "Delay",
                  className: "text-right",
                  render: (s) => {
                    const d = shipmentDelayDays(s);
                    return d == null ? "—" : d > 0 ? `${d} d late` : d < 0 ? `${-d} d early` : "On time";
                  },
                },
                {
                  label: "Units",
                  className: "text-right",
                  render: (s) => num(s.lines.reduce((t, l) => t + l.quantity, 0)),
                },
              ]}
              details={[
                { label: "Mode", render: (s) => s.mode ?? "—" },
                { label: "Incoterm", render: (s) => s.incoterm ?? "—" },
                { label: "ETD", render: (s) => s.etd ?? "—" },
                { label: "Original ETA", render: (s) => s.eta ?? "—" },
                { label: "Revised ETA", render: (s) => s.revisedEta ?? "—" },
                { label: "Arrived", render: (s) => s.arrivedOn ?? "—" },
                { label: "Cleared", render: (s) => s.clearedOn ?? "—" },
                { label: "Delivered", render: (s) => s.deliveredOn ?? "—" },
                {
                  label: "FX",
                  render: (s) => (s.fxRate == null ? "—" : `${s.currencyCode ?? ""} × ${s.fxRate}`),
                },
                {
                  label: "Lines",
                  render: (s) =>
                    s.lines.length === 0
                      ? "No lines yet"
                      : s.lines
                          .map((l) => `${l.sku ?? "—"} × ${num(l.quantity)}${l.poNumber ? ` (${l.poNumber})` : ""}`)
                          .join(", "),
                },
                { label: "Notes", render: (s) => s.notes ?? "—" },
              ]}
              fields={shipmentFields}
              toValues={(s) => ({
                reference: s.reference,
                supplier_id: s.supplierId,
                status: s.status,
                mode: s.mode,
                incoterm: s.incoterm,
                etd: s.etd,
                eta: s.eta,
                revised_eta: s.revisedEta,
                arrived_on: s.arrivedOn,
                cleared_on: s.clearedOn,
                delivered_on: s.deliveredOn,
                currency_code: s.currencyCode,
                fx_rate: s.fxRate,
                notes: s.notes,
              })}
            />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Shipment lines</h2>
              <p className="text-sm text-muted-foreground">
                Quantity allocated to a shipment is phased by that shipment's expected arrival. Anything
                unallocated keeps the purchase order's own date.
              </p>
            </div>
            <BusinessRecordTable
              table="shipment_lines"
              domain="supply"
              invalidate={[["supply-book"], ["supply-plan"], ["overview"]]}
              rows={allLines}
              newLabel="New shipment line"
              emptyTitle="No shipment lines"
              emptyBody="Add lines so an order arriving in stages is planned as several dated receipts."
              columns={[
                {
                  label: "Shipment",
                  render: (l) =>
                    data.shipments.find((s) => s.id === l.shipmentId)?.reference ?? "—",
                },
                { label: "Product", render: (l) => l.sku ?? "—" },
                { label: "Purchase order", render: (l) => l.poNumber ?? "Unlinked" },
                { label: "Quantity", className: "text-right", render: (l) => num(l.quantity) },
              ]}
              details={[
                { label: "Product name", render: (l) => l.productName ?? "—" },
                { label: "Unit cost", render: (l) => (l.unitCost == null ? "—" : num(l.unitCost, 2)) },
                { label: "Notes", render: (l) => l.notes ?? "—" },
              ]}
              fields={lineFields}
              toValues={(l) => ({
                shipment_id: l.shipmentId,
                purchase_order_id: l.purchaseOrderId,
                product_id: l.productId,
                quantity: l.quantity,
                unit_cost: l.unitCost,
                notes: l.notes,
              })}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
