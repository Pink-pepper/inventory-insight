import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell, EmptyState, Loading, useProductLabel } from "@/components/app-shell";
import { Pill } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getDemandBook } from "@/lib/business.functions";
import { CERTAINTY_LABEL, SOURCE_LABEL, type DemandSignalSource } from "@/lib/domain/commercial";
import type { ResolvedDemandRow } from "@/lib/demand/resolve";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/business/")({
  head: () => ({
    meta: [
      { title: "Demand Book — Ionic" },
      {
        name: "description",
        content:
          "One view of forward demand: commitments, expected demand and potential demand, with the evidence behind every number.",
      },
      { property: "og:title", content: "Demand Book — Ionic" },
      {
        property: "og:description",
        content: "See what your customers will actually need, and exactly which evidence produced each number.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DemandBookPage,
});

const KIND_TONE = {
  committed: "reorder",
  baseline: "neutral",
  potential: "watch",
} as const;

function DemandBookPage() {
  const fn = useServerFn(getDemandBook);
  const label = useProductLabel();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["demand-book"],
    queryFn: () => fn(),
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const filtered = period === "all" ? all : all.filter((r) => r.period === period);
    return [...filtered].sort((a, b) =>
      a.period === b.period ? b.resolvedQty - a.resolvedQty : a.period.localeCompare(b.period),
    );
  }, [data, period]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        committed: acc.committed + r.committedQty,
        baseline: acc.baseline + r.baselineQty,
        potential: acc.potential + r.potentialQty,
        resolved: acc.resolved + r.resolvedQty,
      }),
      { committed: 0, baseline: 0, potential: 0, resolved: 0 },
    );
  }, [rows]);

  const periods = data?.periods ?? [];

  return (
    <AppShell
      title="Demand Book"
      description="One demand picture. Commitments replace expected demand rather than stacking on top of it."
    >
      {isLoading ? (
        <Loading label="Resolving demand" />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not resolve the Demand Book."}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No forward demand yet"
          body="The Demand Book resolves customer requirements, opportunities, quotations and orders against your sales history. Add commercial evidence in the Pipeline to see it here."
          action={
            <Button size="sm" asChild>
              <Link to="/business/pipeline">Open Pipeline</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Committed" value={totals.committed} hint="Orders and LPOs you must serve" />
            <Metric label="Expected demand" value={totals.baseline} hint="History not already claimed by a commitment" />
            <Metric label="Potential demand" value={totals.potential} hint="Probability-adjusted pipeline" />
            <Metric label="Total expected demand" value={totals.resolved} hint="What planning consumes" emphasis />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Period</span>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Filter by period"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All periods</option>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="panel divide-y divide-border">
            <div className="grid grid-cols-[1.5rem_2fr_1fr_repeat(4,minmax(0,1fr))] gap-3 bg-surface-muted px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span />
              <span>Product</span>
              <span>Period</span>
              <span className="text-right">Committed</span>
              <span className="text-right">Expected</span>
              <span className="text-right">Potential</span>
              <span className="text-right">Total expected</span>
            </div>

            {rows.map((row) => {
              const key = `${row.productId}|${row.period}`;
              const open = expanded === key;
              return (
                <div key={key}>
                  <div className="grid grid-cols-[1.5rem_2fr_1fr_repeat(4,minmax(0,1fr))] items-center gap-3 px-3 py-3 text-sm hover:bg-surface-muted/60">
                    <button
                      onClick={() => setExpanded(open ? null : key)}
                      aria-label={open ? "Hide evidence" : "Show evidence"}
                      className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                    </button>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {label(row.sku, row.productName)}
                      </p>
                      {row.certainty ? (
                        <p className="text-xs text-muted-foreground">{CERTAINTY_LABEL[row.certainty]}</p>
                      ) : null}
                    </div>
                    <span className="text-muted-foreground">{row.period}</span>
                    <span className="text-right tabular-nums">{num(row.committedQty)}</span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {num(row.baselineQty)}
                    </span>
                    <span className="text-right tabular-nums text-muted-foreground">
                      {num(row.potentialQty)}
                    </span>
                    <span className="text-right font-semibold tabular-nums">{num(row.resolvedQty)}</span>
                  </div>

                  {open ? <Evidence row={row} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppShell>
  );
}

/** Every total expands into the exact signals that produced it. */
function Evidence({ row }: { row: ResolvedDemandRow }) {
  return (
    <div className="space-y-4 border-t border-border bg-surface-muted/40 px-10 py-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Evidence counted
        </p>
        <ul className="mt-2 space-y-1.5">
          {row.contributions.map((c, i) => (
            <li key={`${c.signalId ?? "baseline"}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Pill tone={KIND_TONE[c.kind]}>{c.kind}</Pill>
              <span className="text-foreground">{c.label}</span>
              {c.customerName ? (
                <span className="text-muted-foreground">· {c.customerName}</span>
              ) : null}
              <span className="text-muted-foreground">
                · {SOURCE_LABEL[c.source as DemandSignalSource] ?? c.source}
              </span>
              {c.probability != null ? (
                <span className="text-muted-foreground">· {Math.round(c.probability * 100)}% likely</span>
              ) : null}
              <span className="ml-auto font-medium tabular-nums">{num(c.quantity)}</span>
            </li>
          ))}
        </ul>
      </div>

      {row.superseded.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Not counted — superseded by stronger evidence
          </p>
          <ul className="mt-2 space-y-1.5">
            {row.superseded.map((s) => (
              <li key={s.signalId} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="line-through">{num(s.quantity)}</span>
                <span>
                  {SOURCE_LABEL[s.source as DemandSignalSource] ?? s.source}
                  {s.customerName ? ` · ${s.customerName}` : ""}
                </span>
                <span>· {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: number;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("panel p-4", emphasis && "border-primary/40 bg-primary/5")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{num(value)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
