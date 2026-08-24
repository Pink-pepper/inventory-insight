import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell, Loading, useProductLabel } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import {
  BusinessRecordTable,
  type FieldSpec,
} from "@/components/business-record-table";
import { getBusinessBook } from "@/lib/business.functions";
import {
  CHANNEL_LABEL,
  COMMERCIAL_STATUSES,
  CHANNEL_KINDS,
  type BusinessBook,
} from "@/lib/domain/commercial";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/business/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — Ionic" },
      {
        name: "description",
        content:
          "Customer requirements, opportunities, quotations and confirmed orders — the commercial evidence behind forward demand.",
      },
      { property: "og:title", content: "Pipeline — Ionic" },
      {
        property: "og:description",
        content: "Track requirements through to confirmed orders and promote them into the Demand Book.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PipelinePage,
});

type Tab = "requirements" | "opportunities" | "quotations" | "orders";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "requirements", label: "Requirements", hint: "What a customer says they will need." },
  { id: "opportunities", label: "Opportunities", hint: "Live deals being worked, with a judged probability." },
  { id: "quotations", label: "Quotations", hint: "Prices quoted and still valid." },
  { id: "orders", label: "Orders & LPOs", hint: "Committed business you must be able to serve." },
];

const statusOptions = COMMERCIAL_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0).toUpperCase() + s.slice(1),
}));
const channelOptions = CHANNEL_KINDS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));

function pickers(book: BusinessBook) {
  return {
    customer: book.customers.map((c) => ({ value: c.id, label: c.name })),
    product: book.products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
  };
}

function PipelinePage() {
  const fn = useServerFn(getBusinessBook);
  const label = useProductLabel();
  const [tab, setTab] = useState<Tab>("requirements");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["business-book"],
    queryFn: () => fn(),
  });

  const invalidate = [["business-book"], ["demand-book"]];

  return (
    <AppShell
      title="Pipeline"
      description="The commercial evidence behind forward demand — from a stated requirement to a confirmed order."
    >
      {isLoading ? (
        <Loading label="Loading pipeline" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load the pipeline."}
        </p>
      ) : !data ? null : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  tab === t.id
                    ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                    : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{TABS.find((t) => t.id === tab)?.hint}</p>

          {tab === "requirements" ? (
            <BusinessRecordTable
              table="requirements"
              invalidate={invalidate}
              rows={data.requirements}
              promoteAs="requirement"
              newLabel="New requirement"
              emptyTitle="No customer requirements yet"
              emptyBody="Record what customers have told you they will need so it can feed the Demand Book."
              columns={[
                { label: "Customer", render: (r) => r.customerName ?? "Unattributed" },
                {
                  label: "Product",
                  render: (r) => (r.sku ? label(r.sku, r.productName ?? r.sku) : "—"),
                },
                { label: "Quantity", render: (r) => num(r.quantity) },
                { label: "From", render: (r) => r.periodStart },
                { label: "Channel", render: (r) => CHANNEL_LABEL[r.channel] },
                { label: "Status", render: (r) => <Pill tone="neutral">{r.status}</Pill> },
              ]}
              details={[
                { label: "Period end", render: (r) => r.periodEnd ?? "Open-ended" },
                { label: "Unit", render: (r) => r.unit ?? "—" },
                { label: "Notes", render: (r) => r.notes ?? "—" },
              ]}
              fields={requirementFields(data)}
              toValues={(r) => ({
                customer_id: r.customerId,
                product_id: r.productId,
                quantity: r.quantity,
                unit: r.unit,
                period_start: r.periodStart,
                period_end: r.periodEnd,
                channel: r.channel,
                status: r.status,
                notes: r.notes,
              })}
            />
          ) : null}

          {tab === "opportunities" ? (
            <BusinessRecordTable
              table="opportunities"
              invalidate={invalidate}
              rows={data.opportunities}
              promoteAs="opportunity"
              newLabel="New opportunity"
              emptyTitle="No open opportunities"
              emptyBody="Log deals you are working so their upside can be weighted into forward demand."
              columns={[
                { label: "Opportunity", render: (o) => o.title },
                { label: "Customer", render: (o) => o.customerName ?? "Unattributed" },
                { label: "Quantity", render: (o) => num(o.quantity) },
                { label: "Expected", render: (o) => o.expectedPeriod },
                { label: "Probability", render: (o) => `${Math.round(o.probability * 100)}%` },
                { label: "Status", render: (o) => <Pill tone="neutral">{o.status}</Pill> },
              ]}
              details={[
                {
                  label: "Product",
                  render: (o) => (o.sku ? label(o.sku, o.productName ?? o.sku) : "—"),
                },
                { label: "Channel", render: (o) => CHANNEL_LABEL[o.channel] },
                {
                  label: "Expected price",
                  render: (o) =>
                    o.expectedUnitPrice == null
                      ? "—"
                      : `${money(o.expectedUnitPrice)} ${o.currencyCode ?? ""}`.trim(),
                },
                { label: "Notes", render: (o) => o.notes ?? "—" },
              ]}
              fields={opportunityFields(data)}
              toValues={(o) => ({
                customer_id: o.customerId,
                product_id: o.productId,
                title: o.title,
                quantity: o.quantity,
                unit: o.unit,
                expected_period: o.expectedPeriod,
                expected_unit_price: o.expectedUnitPrice,
                currency_code: o.currencyCode,
                probability: o.probability,
                channel: o.channel,
                status: o.status,
                notes: o.notes,
              })}
            />
          ) : null}

          {tab === "quotations" ? (
            <BusinessRecordTable
              table="quotations"
              invalidate={invalidate}
              rows={data.quotations}
              promoteAs="quotation"
              newLabel="New quotation"
              emptyTitle="No quotations recorded"
              emptyBody="Quoted business is strong evidence of near-term demand. Add one to see it in the Demand Book."
              columns={[
                { label: "Reference", render: (q) => q.reference ?? "—" },
                { label: "Customer", render: (q) => q.customerName ?? "Unattributed" },
                {
                  label: "Product",
                  render: (q) => (q.sku ? label(q.sku, q.productName ?? q.sku) : "—"),
                },
                { label: "Quantity", render: (q) => num(q.quantity) },
                { label: "Expected", render: (q) => q.expectedPeriod },
                { label: "Status", render: (q) => <Pill tone="neutral">{q.status}</Pill> },
              ]}
              details={[
                {
                  label: "Unit price",
                  render: (q) =>
                    q.unitPrice == null ? "—" : `${money(q.unitPrice)} ${q.currencyCode ?? ""}`.trim(),
                },
                { label: "Issued", render: (q) => q.issuedOn ?? "—" },
                { label: "Valid until", render: (q) => q.validUntil ?? "—" },
                { label: "Channel", render: (q) => CHANNEL_LABEL[q.channel] },
                { label: "Notes", render: (q) => q.notes ?? "—" },
              ]}
              fields={quotationFields(data)}
              toValues={(q) => ({
                customer_id: q.customerId,
                product_id: q.productId,
                reference: q.reference,
                quantity: q.quantity,
                unit: q.unit,
                unit_price: q.unitPrice,
                currency_code: q.currencyCode,
                expected_period: q.expectedPeriod,
                issued_on: q.issuedOn,
                valid_until: q.validUntil,
                channel: q.channel,
                status: q.status,
                notes: q.notes,
              })}
            />
          ) : null}

          {tab === "orders" ? (
            <BusinessRecordTable
              table="customer_orders"
              invalidate={invalidate}
              rows={data.customerOrders}
              promoteAs="customer_order"
              newLabel="New order / LPO"
              emptyTitle="No customer orders"
              emptyBody="Confirmed orders and LPOs are committed demand — they replace, rather than add to, the run rate."
              columns={[
                { label: "Reference", render: (c) => c.reference ?? "—" },
                { label: "Customer", render: (c) => c.customerName ?? "Unattributed" },
                {
                  label: "Product",
                  render: (c) => (c.sku ? label(c.sku, c.productName ?? c.sku) : "—"),
                },
                { label: "Quantity", render: (c) => num(c.quantity) },
                { label: "From", render: (c) => c.periodStart },
                {
                  label: "Commitment",
                  render: (c) => (
                    <Pill tone={c.confirmation ? "positive" : "neutral"}>
                      {c.confirmation ? "Confirmed" : "LPO"}
                    </Pill>
                  ),
                },
              ]}
              details={[
                {
                  label: "Unit price",
                  render: (c) =>
                    c.unitPrice == null ? "—" : `${money(c.unitPrice)} ${c.currencyCode ?? ""}`.trim(),
                },
                { label: "Channel", render: (c) => CHANNEL_LABEL[c.channel] },
                { label: "Period end", render: (c) => c.periodEnd ?? "Open-ended" },
                { label: "Confirmation", render: (c) => c.confirmation ?? "—" },
                { label: "Notes", render: (c) => c.notes ?? "—" },
              ]}
              fields={orderFields(data)}
              toValues={(c) => ({
                customer_id: c.customerId,
                product_id: c.productId,
                reference: c.reference,
                quantity: c.quantity,
                unit: c.unit,
                unit_price: c.unitPrice,
                currency_code: c.currencyCode,
                period_start: c.periodStart,
                period_end: c.periodEnd,
                channel: c.channel,
                confirmation: c.confirmation,
                status: c.status,
                notes: c.notes,
              })}
            />
          ) : null}
        </div>
      )}
    </AppShell>
  );
}

function requirementFields(book: BusinessBook): FieldSpec[] {
  const p = pickers(book);
  return [
    { key: "customer_id", label: "Customer", type: "select", options: p.customer },
    { key: "product_id", label: "Product", type: "select", options: p.product },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "period_start", label: "Needed from", type: "date", required: true },
    { key: "period_end", label: "Needed until", type: "date" },
    { key: "channel", label: "Channel", type: "select", options: channelOptions, required: true },
    { key: "status", label: "Status", type: "select", options: statusOptions, required: true, defaultValue: "open" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
}

function opportunityFields(book: BusinessBook): FieldSpec[] {
  const p = pickers(book);
  return [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "customer_id", label: "Customer", type: "select", options: p.customer },
    { key: "product_id", label: "Product", type: "select", options: p.product },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "expected_period", label: "Expected period", type: "date", required: true },
    { key: "expected_unit_price", label: "Expected unit price", type: "number" },
    { key: "currency_code", label: "Currency", type: "text" },
    {
      key: "probability",
      label: "Probability (%)",
      type: "percent",
      required: true,
      help: "A commercial judgement. It weights the upside; it never creates committed demand.",
    },
    { key: "channel", label: "Channel", type: "select", options: channelOptions, required: true },
    { key: "status", label: "Status", type: "select", options: statusOptions, required: true, defaultValue: "open" },
    { key: "notes", label: "Evidence / notes", type: "textarea" },
  ];
}

function quotationFields(book: BusinessBook): FieldSpec[] {
  const p = pickers(book);
  return [
    { key: "reference", label: "Reference", type: "text" },
    { key: "customer_id", label: "Customer", type: "select", options: p.customer },
    { key: "product_id", label: "Product", type: "select", options: p.product },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "unit_price", label: "Unit price", type: "number" },
    { key: "currency_code", label: "Currency", type: "text" },
    { key: "expected_period", label: "Expected period", type: "date", required: true },
    { key: "issued_on", label: "Issued on", type: "date" },
    { key: "valid_until", label: "Valid until", type: "date" },
    { key: "channel", label: "Channel", type: "select", options: channelOptions, required: true },
    { key: "status", label: "Status", type: "select", options: statusOptions, required: true, defaultValue: "open" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
}

function orderFields(book: BusinessBook): FieldSpec[] {
  const p = pickers(book);
  return [
    { key: "reference", label: "Order / LPO reference", type: "text" },
    { key: "customer_id", label: "Customer", type: "select", options: p.customer },
    { key: "product_id", label: "Product", type: "select", options: p.product },
    { key: "quantity", label: "Quantity", type: "number", required: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "unit_price", label: "Unit price", type: "number" },
    { key: "currency_code", label: "Currency", type: "text" },
    { key: "period_start", label: "Required from", type: "date", required: true },
    { key: "period_end", label: "Required until", type: "date" },
    { key: "channel", label: "Channel", type: "select", options: channelOptions, required: true },
    {
      key: "confirmation",
      label: "Confirmation",
      type: "text",
      help: "Fill this in once the order is formally confirmed; it raises the certainty of the demand.",
    },
    { key: "status", label: "Status", type: "select", options: statusOptions, required: true, defaultValue: "open" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];
}
