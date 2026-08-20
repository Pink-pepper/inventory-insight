import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyState, Loading, useProductLabel } from "@/components/app-shell";
import { PlanningFilters } from "@/components/planning-filters";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getDemandPlan } from "@/lib/ionic.functions";
import { DIMENSION_LABELS } from "@/lib/demand/dimensions";
import { DEMAND_DIMENSIONS, type DemandDimension, type PlanningFilter } from "@/lib/query/filters";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/demand-planning")({
  head: () => ({
    meta: [
      { title: "Demand planning — Ionic" },
      {
        name: "description",
        content:
          "Historical demand, a transparent trailing-average baseline and the inventory implications for every SKU in scope.",
      },
      { property: "og:title", content: "Demand planning — Ionic" },
      {
        property: "og:description",
        content: "Observed demand, planned demand and prioritised planning decisions.",
      },
    ],
  }),
  component: DemandPlanningPage,
});

const ACTION_ORDER = { REORDER: 0, WATCH: 1, EXCESS: 2, HOLD: 3 } as const;

function DemandPlanningPage() {
  const fn = useServerFn(getDemandPlan);
  const label = useProductLabel();
  const [filter, setFilter] = useState<PlanningFilter>({});
  const [dimension, setDimension] = useState<DemandDimension>("product");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["demand-plan", filter, dimension],
    queryFn: () => fn({ data: { filter, dimension } }),
  });

  const plan = data?.plan;

  const chartData = useMemo(() => {
    if (!plan) return [];
    const history = plan.buckets.map((b) => ({
      period: b.period,
      observed: b.quantity,
      planned: null as number | null,
    }));
    const projected = plan.projection.map((p) => ({
      period: p.period,
      observed: null as number | null,
      planned: p.planned,
    }));
    // Join the two lines at the last observed point so the chart reads as one plan.
    const last = history[history.length - 1];
    if (last && plan.baseline.plannedPerPeriod != null) last.planned = last.observed;
    return [...history, ...projected];
  }, [plan]);

  const decisions = useMemo(() => {
    const rows = data?.planningRows ?? [];
    return [...rows].sort(
      (a, b) =>
        ACTION_ORDER[a.action as keyof typeof ACTION_ORDER] -
          ACTION_ORDER[b.action as keyof typeof ACTION_ORDER] ||
        b.estimatedCost - a.estimatedCost,
    );
  }, [data]);

  return (
    <AppShell
      title="Demand planning"
      description="What demand has actually been, what it is planned to be, and what that means for stock."
    >
      {isLoading ? (
        <Loading label="Building the demand plan" />
      ) : isError ? (
        <EmptyState
          title="Could not build the demand plan"
          body={error instanceof Error ? error.message : "The demand query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data || !plan ? null : (
        <div className="space-y-4">
          <PlanningFilters filter={filter} options={data.options} onChange={setFilter} />

          {plan.coverage.note ? (
            <div className="panel border-l-2 border-l-warning px-4 py-3 text-sm text-muted-foreground">
              {plan.coverage.note}
            </div>
          ) : null}

          {plan.buckets.length === 0 ? (
            <EmptyState
              title="No demand history in scope"
              body="Load sales history or widen the filters to plan demand for this workspace."
              action={
                <Button asChild size="sm">
                  <Link to="/data-sources">Go to Data Sources</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  label={`Observed demand (${plan.grain})`}
                  value={num(plan.totals.quantity)}
                  hint={
                    plan.totals.changePct == null
                      ? `${plan.coverage.periods} periods · ${plan.totals.skus} SKUs`
                      : `${plan.totals.changePct > 0 ? "+" : ""}${plan.totals.changePct}% vs comparison window`
                  }
                />
                <Metric
                  label="Baseline per period"
                  value={plan.baseline.perPeriod == null ? "—" : num(plan.baseline.perPeriod, 1)}
                  hint={`Trailing average of ${plan.baseline.assumptions.periodsUsed} ${plan.grain} periods`}
                />
                <Metric
                  label="Planned per period"
                  value={
                    plan.baseline.plannedPerPeriod == null
                      ? "—"
                      : num(plan.baseline.plannedPerPeriod, 1)
                  }
                  hint={
                    plan.baseline.assumptions.growthApplied
                      ? `Includes the configured ${plan.baseline.assumptions.growthPct}% growth adjustment`
                      : "No growth adjustment configured"
                  }
                />
                <Metric
                  label={`Planned over ${plan.baseline.assumptions.planningHorizonDays} days`}
                  value={plan.baseline.plannedTotal == null ? "—" : num(plan.baseline.plannedTotal)}
                  hint={
                    plan.baseline.variability
                      ? `Demand is ${plan.baseline.variability.label} (CV ${plan.baseline.variability.cvPct}%)`
                      : "Not enough periods to describe variability"
                  }
                />
              </div>

              <div className="panel px-4 py-4">
                <h2 className="text-sm font-semibold text-foreground">Demand over time</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Solid line is observed demand; the dashed line is the planned baseline carried
                  across the planning horizon.
                </p>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="period" fontSize={11} tickLine={false} />
                      <YAxis fontSize={11} tickLine={false} width={56} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="observed"
                        name="Observed"
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        dot={false}
                        connectNulls={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="planned"
                        name="Planned baseline"
                        stroke="hsl(var(--chart-2))"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="panel px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Demand by dimension</h2>
                  <select
                    value={dimension}
                    onChange={(e) => setDimension(e.target.value as DemandDimension)}
                    className="ml-auto h-8 rounded-md border border-input bg-surface px-2 text-xs"
                  >
                    {DEMAND_DIMENSIONS.map((d) => {
                      const availability = plan.availability.find((a) => a.dimension === d);
                      return (
                        <option key={d} value={d} disabled={!availability?.available}>
                          {DIMENSION_LABELS[d]}
                          {availability?.available ? "" : " — no data"}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {plan.dimensionFellBack ? (
                  <p className="mt-1 text-xs text-warning-foreground">
                    The selected dimension carries no values in the ingested data, so the breakdown
                    falls back to product.
                  </p>
                ) : null}

                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={plan.rows.slice(0, 12)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={10} tickLine={false} interval={0} hide />
                      <YAxis fontSize={11} tickLine={false} width={56} />
                      <Tooltip />
                      <Bar dataKey="quantity" name="Demand" fill="hsl(var(--chart-1))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="bg-surface-muted">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-medium">{DIMENSION_LABELS[plan.dimension]}</th>
                        <th className="px-3 py-2 text-right font-medium">Demand</th>
                        <th className="px-3 py-2 text-right font-medium">Share</th>
                        <th className="px-3 py-2 text-right font-medium">Comparison</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.rows.slice(0, 25).map((r) => (
                        <tr key={r.key} className="border-t border-border/70">
                          <td className="px-3 py-2">
                            {plan.dimension === "product" ? label(r.key, r.label) : r.label}
                          </td>
                          <td className="px-3 py-2 text-right tabular">{num(r.quantity)}</td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {r.sharePct}%
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {r.changePct == null
                              ? "—"
                              : `${r.changePct > 0 ? "+" : ""}${r.changePct}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel px-4 py-4">
                <h2 className="text-sm font-semibold text-foreground">Why this plan</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    Method: trailing average of observed demand. No statistical forecast, no
                    inferred seasonality.
                  </li>
                  <li>
                    Source: {plan.coverage.source === "transactions" ? "day-grain transactions" : "stored monthly demand"}
                    , {plan.coverage.periods} {plan.grain} periods
                    {plan.coverage.firstPeriod
                      ? ` from ${plan.coverage.firstPeriod} to ${plan.coverage.lastPeriod}`
                      : ""}
                    .
                  </li>
                  <li>
                    Window: the policy asks for {plan.baseline.assumptions.demandWindowMonths} months
                    ({plan.baseline.assumptions.periodsRequested} {plan.grain} periods);{" "}
                    {plan.baseline.assumptions.periodsUsed} were available and used.
                  </li>
                  <li>
                    Horizon: {plan.baseline.assumptions.planningHorizonDays} days ≈{" "}
                    {plan.baseline.assumptions.horizonPeriods} {plan.grain} periods.
                  </li>
                  <li>
                    Growth adjustment:{" "}
                    {plan.baseline.assumptions.growthApplied
                      ? `${plan.baseline.assumptions.growthPct}% applied to the trailing average`
                      : "none configured, so the baseline is the raw trailing average"}
                    .
                  </li>
                  {plan.baseline.limitations.map((l) => (
                    <li key={l} className="text-warning-foreground">
                      {l}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Planning parameters are configured in{" "}
                  <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
                    Settings
                  </Link>
                  .
                </p>
              </div>

              <div className="panel overflow-x-auto">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <h2 className="text-sm font-semibold text-foreground">Planning decisions</h2>
                  <Link
                    to="/inventory"
                    className="text-xs text-primary underline-offset-4 hover:underline"
                  >
                    Open inventory
                  </Link>
                </div>
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-surface-muted">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Observed demand</th>
                      <th className="px-3 py-2 text-right font-medium">Direction</th>
                      <th className="px-3 py-2 text-right font-medium">On hand</th>
                      <th className="px-3 py-2 text-right font-medium">Reorder point</th>
                      <th className="px-3 py-2 text-right font-medium">Suggested qty</th>
                      <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.slice(0, 50).map((r) => (
                      <tr key={r.sku} className="border-t border-border/70 hover:bg-surface-muted/60">
                        <td className="px-3 py-2.5">
                          <Link
                            to="/sku/$sku"
                            params={{ sku: r.sku }}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {label(r.sku, r.name)}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.observedDemand)}</td>
                        <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                          {r.demandChangePct == null
                            ? "—"
                            : `${r.demandChangePct > 0 ? "+" : ""}${r.demandChangePct}%`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.onHand)}</td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.reorderPoint)}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.blocked ? "—" : num(r.recommendedQty)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.blocked ? "—" : money(r.estimatedCost)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge action={r.action} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}