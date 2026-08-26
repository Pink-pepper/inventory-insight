import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AppShell, Loading } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { BusinessRecordTable, type FieldSpec } from "@/components/business-record-table";
import { getBusinessBook } from "@/lib/business.functions";
import {
  MARKET_SIGNAL_KINDS,
  MARKET_SIGNAL_LABEL,
  type MarketSignalImpact,
  type MarketSignalRecord,
} from "@/lib/domain/commercial";


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

  const grouped = useMemo(() => {
    const order: MarketSignalImpact[] = ["risk", "opportunity", "informational"];
    const buckets = new Map<MarketSignalImpact, typeof data extends undefined ? never : NonNullable<typeof data>["marketSignals"]>();
    for (const impact of order) buckets.set(impact, []);
    for (const s of data?.marketSignals ?? []) buckets.get(s.impact)?.push(s);
    for (const list of buckets.values()) list.sort((a, b) => b.observedOn.localeCompare(a.observedOn));
    return order
      .map((impact) => ({ impact, rows: buckets.get(impact) ?? [] }))
      .filter((g) => g.rows.length > 0);
  }, [data]);

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
        <div className="space-y-8">
          {grouped.length > 0 ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Intelligence feed</h2>
                <p className="text-sm text-muted-foreground">
                  Grouped by what the observation means for you. Nothing here changes a number anywhere in Ionic.
                </p>
              </div>
              {grouped.map((group) => (
                <div key={group.impact} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={IMPACT_TONE[group.impact]}>{GROUP_LABEL[group.impact]}</Pill>
                    <span className="text-xs text-muted-foreground">{group.rows.length}</span>
                  </div>
                  <div className="panel divide-y divide-border">
                    {group.rows.map((s) => {
                      const isOpen = expanded === s.id;
                      const related = [s.customerName, s.supplierName, s.sku].filter(Boolean).join(" · ");
                      return (
                        <div key={s.id}>
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : s.id)}
                            className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-muted"
                          >
                            {isOpen ? (
                              <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-foreground">{s.title}</span>
                              <span className="block text-xs text-muted-foreground">
                                {MARKET_SIGNAL_LABEL[s.kind as keyof typeof MARKET_SIGNAL_LABEL] ?? s.kind}
                                {related ? ` · ${related}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {s.observedOn}
                            </span>
                          </button>
                          {isOpen ? (
                            <p className="border-t border-border bg-surface-muted/60 px-3 py-3 text-sm leading-relaxed text-muted-foreground">
                              {s.detail ?? "No further detail recorded."}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Manage signals</h2>
              <p className="text-sm text-muted-foreground">
                Record, edit or remove observations. Each one keeps its date and who it relates to.
              </p>
            </div>

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
          </section>
        </div>
      )}

    </AppShell>
  );
}
