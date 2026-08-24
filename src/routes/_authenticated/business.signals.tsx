import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell, Loading } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getBusinessBook } from "@/lib/business.functions";
import { MARKET_SIGNAL_KINDS, MARKET_SIGNAL_LABEL } from "@/lib/domain/commercial";

export const Route = createFileRoute("/_authenticated/business/signals")({
  head: () => ({
    meta: [
      { title: "Market Signals — Ionic" },
      {
        name: "description",
        content:
          "Lightweight commercial context: competitor moves, supply disruption and customer consumption changes worth remembering.",
      },
      { property: "og:title", content: "Market Signals — Ionic" },
      {
        property: "og:description",
        content: "Capture the market context behind commercial judgement, without a research platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignalsPage,
});

const IMPACT_TONE = {
  risk: "reorder",
  opportunity: "watch",
  informational: "neutral",
} as const;

function SignalsPage() {
  const fn = useServerFn(getBusinessBook);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["business-book"],
    queryFn: () => fn(),
  });

  const fields: FieldSpec[] = useMemo(
    () => [
      { key: "title", label: "Title", type: "text", required: true },
      {
        key: "kind",
        label: "Kind",
        type: "select",
        required: true,
        options: MARKET_SIGNAL_KINDS.map((k) => ({ value: k, label: MARKET_SIGNAL_LABEL[k] })),
      },
      {
        key: "impact",
        label: "Impact",
        type: "select",
        required: true,
        options: [
          { value: "risk", label: "Risk" },
          { value: "opportunity", label: "Opportunity" },
          { value: "informational", label: "Informational" },
        ],
        defaultValue: "informational",
      },
      { key: "observed_on", label: "Observed on", type: "date", required: true },
      {
        key: "customer_id",
        label: "Customer",
        type: "select",
        options: (data?.customers ?? []).map((c) => ({ value: c.id, label: c.name })),
      },
      {
        key: "product_id",
        label: "Product",
        type: "select",
        options: (data?.products ?? []).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
      },
      {
        key: "supplier_id",
        label: "Supplier",
        type: "select",
        options: (data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
      },
      { key: "detail", label: "Detail", type: "textarea" },
    ],
    [data],
  );

  return (
    <AppShell
      title="Market Signals"
      description="Context that shapes commercial judgement. Signals are recorded as observations — they never become demand on their own."
    >
      {isLoading ? (
        <Loading label="Loading signals" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load market signals."}
        </p>
      ) : !data ? null : (
        <BusinessRecordTable
          table="market_signals"
          invalidate={[["business-book"]]}
          rows={data.marketSignals}
          newLabel="New signal"
          emptyTitle="No market signals recorded"
          emptyBody="Note competitor pricing, supply disruption or a change in a customer's consumption so the reasoning behind a plan survives."
          columns={[
            { label: "Signal", render: (s) => s.title },
            {
              label: "Kind",
              render: (s) => MARKET_SIGNAL_LABEL[s.kind as keyof typeof MARKET_SIGNAL_LABEL] ?? s.kind,
            },
            {
              label: "Impact",
              render: (s) => <Pill tone={IMPACT_TONE[s.impact]}>{s.impact}</Pill>,
            },
            { label: "Observed", render: (s) => s.observedOn },
            { label: "Related to", render: (s) => s.customerName ?? s.supplierName ?? s.sku ?? "—" },
          ]}
          details={[
            { label: "Customer", render: (s) => s.customerName ?? "—" },
            { label: "Supplier", render: (s) => s.supplierName ?? "—" },
            { label: "Product", render: (s) => s.sku ?? "—" },
            { label: "Detail", render: (s) => s.detail ?? "—" },
          ]}
          fields={fields}
          toValues={(s) => ({
            title: s.title,
            kind: s.kind,
            impact: s.impact,
            observed_on: s.observedOn,
            customer_id: s.customerId,
            product_id: s.productId,
            supplier_id: s.supplierId,
            detail: s.detail,
          })}
        />
      )}
    </AppShell>
  );
}
