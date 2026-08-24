import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
import { getSupplyBook } from "@/lib/supply.functions";
import {
  SHIPMENT_STATUS_LABEL,
  effectiveEta,
  isClearanceStatus,
  isInboundStatus,
  shipmentDelayDays,
  type ShipmentRecord,
} from "@/lib/domain/supply-chain";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/supply/inbound")({
  head: () => ({
    meta: [
      { title: "Inbound & clearance — Ionic" },
      {
        name: "description",
        content:
          "What is arriving, when it lands, how late it is, and what is sitting in import clearance right now.",
      },
      { property: "og:title", content: "Inbound & clearance — Ionic" },
      {
        property: "og:description",
        content: "Arrival timeline and clearance queue for every inbound shipment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InboundPage,
});

function ShipmentList({ rows }: { rows: ShipmentRecord[] }) {
  return (
    <div className="panel divide-y divide-border">
      <div className="grid grid-cols-[1.4fr_1.2fr_1fr_1fr_0.8fr_0.8fr] gap-3 bg-surface-muted px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Shipment</span>
        <span>Supplier</span>
        <span>Status</span>
        <span>Expected</span>
        <span className="text-right">Delay</span>
        <span className="text-right">Units</span>
      </div>
      {rows.map((s) => {
        const delay = shipmentDelayDays(s);
        return (
          <div
            key={s.id}
            className="grid grid-cols-[1.4fr_1.2fr_1fr_1fr_0.8fr_0.8fr] items-center gap-3 px-3 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{s.reference}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.lines.map((l) => l.sku ?? "—").join(", ") || "No lines"}
              </p>
            </div>
            <span className="truncate text-muted-foreground">{s.supplierName ?? "—"}</span>
            <span className="text-muted-foreground">{SHIPMENT_STATUS_LABEL[s.status]}</span>
            <span className="tabular-nums">{effectiveEta(s) ?? "Unscheduled"}</span>
            <span
              className={
                delay != null && delay > 0
                  ? "text-right tabular-nums text-destructive"
                  : "text-right tabular-nums text-muted-foreground"
              }
            >
              {delay == null ? "—" : delay > 0 ? `${delay} d` : delay < 0 ? `${-delay} d early` : "On time"}
            </span>
            <span className="text-right tabular-nums">
              {num(s.lines.reduce((t, l) => t + l.quantity, 0))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function InboundPage() {
  const fn = useServerFn(getSupplyBook);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["supply-book"],
    queryFn: () => fn(),
  });

  const { inbound, clearance, lateCount, unscheduled } = useMemo(() => {
    const all = data?.shipments ?? [];
    const inbound = all
      .filter((s) => isInboundStatus(s.status))
      .sort((a, b) => (effectiveEta(a) ?? "9999-12-31").localeCompare(effectiveEta(b) ?? "9999-12-31"));
    return {
      inbound,
      clearance: all.filter((s) => isClearanceStatus(s.status)),
      lateCount: inbound.filter((s) => (shipmentDelayDays(s) ?? 0) > 0).length,
      unscheduled: inbound.filter((s) => effectiveEta(s) == null).length,
    };
  }, [data]);

  return (
    <AppShell
      title="Inbound & clearance"
      description="Everything on the water or on the dock, ordered by when it is expected to land."
    >
      {isLoading ? (
        <Loading label="Loading inbound shipments" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load inbound shipments."}
        </p>
      ) : !data ? null : inbound.length === 0 && clearance.length === 0 ? (
        <EmptyState
          title="Nothing inbound"
          body="Record shipments against your purchase orders to see arrivals, delays and clearance here."
          action={
            <Link to="/supply" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go to Shipments
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Inbound shipments", value: num(inbound.length) },
              { label: "Running late", value: num(lateCount) },
              { label: "No arrival date", value: num(unscheduled) },
            ].map((k) => (
              <div key={k.label} className="panel px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {k.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{k.value}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Arrival timeline</h2>
              <p className="text-sm text-muted-foreground">
                Expected date uses the actual arrival where recorded, then the revised ETA, then the original.
              </p>
            </div>
            {inbound.length === 0 ? (
              <EmptyState title="Nothing on the water" body="No shipment is currently inbound." />
            ) : (
              <ShipmentList rows={inbound} />
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Import & clearance</h2>
              <p className="text-sm text-muted-foreground">
                Shipments that have arrived and are working through clearance before they become stock.
              </p>
            </div>
            {clearance.length === 0 ? (
              <EmptyState title="Nothing in clearance" body="No arrived or clearing shipment right now." />
            ) : (
              <ShipmentList rows={clearance} />
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
