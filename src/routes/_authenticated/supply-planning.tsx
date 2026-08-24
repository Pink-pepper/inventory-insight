import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyState, Loading, useProductLabel } from "@/components/app-shell";
import { PlanningFilters } from "@/components/planning-filters";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getSupplyPlan } from "@/lib/ionic.functions";
import type { SupplyPlanRow } from "@/lib/supply/plan";
import { riskText } from "@/lib/supply/explain";
import type { PlanningFilter } from "@/lib/query/filters";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/supply-planning")({
  head: () => ({
    meta: [
      { title: "Supply Plan — Ionic" },
      {
        name: "description",
        content:
          "Given the demand plan and the current inventory position, what supply is required, when, and what could prevent it.",
      },
      { property: "og:title", content: "Supply Plan — Ionic" },
      {
        property: "og:description",
        content: "Net requirements, order-by dates and fulfilment risks, explained line by line.",
      },
    ],
  }),
  component: SupplyPlanningPage,
});

function SupplyPlanningPage() {
  const fn = useServerFn(getSupplyPlan);
  const label = useProductLabel();
  const [filter, setFilter] = useState<PlanningFilter>({});
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["supply-plan", filter],
    queryFn: () => fn({ data: { filter } }),
  });

  const selected = data?.rows.find((r) => r.sku === selectedSku) ?? null;

  return (
    <AppShell
      title="Supply Plan"
      description="What supply is required, when it is required, and what could prevent it from being fulfilled."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/purchasing">Procurement</Link>
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Building the supply plan" />
      ) : isError ? (
        <EmptyState
          title="Could not build the supply plan"
          body={error instanceof Error ? error.message : "The supply query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? null : (
        <div className="space-y-4">
          <PlanningFilters filter={filter} options={data.options} onChange={setFilter} />

          {data.summary.skuCount === 0 ? (
            <EmptyState
              title="No products in scope"
              body="Load products, inventory and demand history, or widen the filters, to plan supply."
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
                  label="SKUs requiring action"
                  value={num(data.summary.requiringAction)}
                  hint={`of ${num(data.summary.skuCount)} in scope`}
                />
                <Metric
                  label="Suggested spend"
                  value={money(data.summary.suggestedSpend)}
                  hint={
                    data.summary.spendComplete
                      ? "Suggested qty × recorded unit cost"
                      : "Some rows have no recorded unit cost"
                  }
                />
                <Metric
                  label="Stockouts in horizon"
                  value={num(data.summary.stockoutInHorizon)}
                  hint={`${data.summary.horizonPeriods} projected period(s) from ${data.summary.horizonStart ?? "—"}`}
                />
                <Metric
                  label="Blocked by missing inputs"
                  value={num(data.summary.blocked)}
                  hint="Critical inputs absent; no quantity computed"
                />
              </div>

              {data.summary.noOpenPos ? (
                <div className="panel border-l-2 border-l-status-watch px-4 py-3 text-sm text-muted-foreground">
                  No open purchase orders were found, so all inbound supply below comes from the
                  recorded on-order quantities without dates. Import purchase orders (Data Sources →
                  Import, entity “Purchase orders”) to see ETA-phased receipts and stockout-before-receipt
                  warnings.
                </div>
              ) : null}

              {data.summary.excessLocationOpportunities > 0 ? (
                <div className="panel border-l-2 border-l-primary px-4 py-3 text-sm text-muted-foreground">
                  {data.summary.excessLocationOpportunities} location(s) hold stock far beyond their
                  own requirement on SKUs that otherwise need purchasing — redistribution may avoid
                  new procurement. See the flagged rows below, or open{" "}
                  <Link to="/distribution" className="text-primary underline-offset-4 hover:underline">
                    Distribution planning
                  </Link>{" "}
                  for concrete transfer suggestions.
                </div>
              ) : null}

              <div className="panel overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="bg-surface-muted">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">On hand</th>
                      <th className="px-3 py-2 text-right font-medium">Scheduled inbound</th>
                      <th className="px-3 py-2 font-medium">Earliest ETA</th>
                      <th className="px-3 py-2 text-right font-medium">Projected low</th>
                      <th className="px-3 py-2 text-right font-medium">Net requirement</th>
                      <th className="px-3 py-2 text-right font-medium">Suggested qty</th>
                      <th className="px-3 py-2 font-medium">Order by</th>
                      <th className="px-3 py-2 font-medium">Risks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 50).map((r) => (
                      <tr
                        key={r.sku}
                        className={`cursor-pointer border-t border-border/70 hover:bg-surface-muted/60 ${
                          selectedSku === r.sku ? "bg-surface-muted/60" : ""
                        }`}
                        onClick={() => setSelectedSku(selectedSku === r.sku ? null : r.sku)}
                      >
                        <td className="px-3 py-2.5">
                          <span className="text-primary underline-offset-4 hover:underline">
                            {label(r.sku, r.name)}
                          </span>
                          <span className="ml-2 align-middle">
                            <StatusBadge action={r.engineAction} />
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{num(r.onHand)}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {num(r.scheduledInbound)}
                          {r.unscheduledOnOrder > 0 ? (
                            <span className="block text-[11px] text-muted-foreground">
                              +{num(r.unscheduledOnOrder)} undated
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 tabular">{r.earliestEta ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.lowPoint == null ? "—" : num(r.lowPoint)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">
                          {r.netRequirement == null ? "—" : num(r.netRequirement)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular font-medium">
                          {r.suggestedQty == null ? "—" : num(r.suggestedQty)}
                        </td>
                        <td className="px-3 py-2.5 tabular">{r.orderByDate ?? "—"}</td>
                        <td className="max-w-[260px] px-3 py-2.5 text-xs text-muted-foreground">
                          {r.riskFlags.map((f) => riskText(f)).join(" ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected ? <SupplyDetail row={selected} onClose={() => setSelectedSku(null)} /> : null}

              <div className="panel px-4 py-4">
                <h2 className="text-sm font-semibold text-foreground">Method and limits</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    Quantities and stock targets come from the same recommendation engine that
                    powers the rest of Ionic, under the active planning policy — Supply Planning
                    adds the time dimension, not a second set of numbers.
                  </li>
                  <li>
                    Projection: previous position − planned demand + receipts scheduled into that
                    month. Past-due receipts are assumed to land in the first projected period.
                  </li>
                  <li>
                    Net requirement = max(0, target stock − lowest projected position), rounded up
                    to the minimum order quantity and order multiple.
                  </li>
                  <li>
                    Order-by = first period below the reorder point (or first stockout, if earlier)
                    minus the known lead time. It is only shown when both exist.
                  </li>
                  <li>
                    Constraints surfaced, never hidden: missing lead times, undated inbound, MOQ
                    effects, and excess stock at other locations.
                  </li>
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  Planning parameters are configured in{" "}
                  <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
                    Settings
                  </Link>
                  .
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}

function SupplyDetail({ row, onClose }: { row: SupplyPlanRow; onClose: () => void }) {
  const label = useProductLabel();
  const chartData =
    row.projection?.map((p) => ({
      period: p.periodStart.slice(0, 7),
      projected: p.projectedOnHand,
      receipts: p.receipts,
    })) ?? [];

  return (
    <div className="panel px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Supply plan — {label(row.sku, row.name)}
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {chartData.length > 0 ? (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="period" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} tickLine={false} width={56} />
              <Tooltip />
              <Legend />
              <ReferenceLine
                y={row.reorderPoint}
                stroke="var(--chart-2)"
                strokeDasharray="4 4"
                label={{ value: "Reorder point", fontSize: 10, position: "insideTopRight" }}
              />
              <ReferenceLine
                y={row.safetyStock}
                stroke="var(--chart-4)"
                strokeDasharray="2 4"
                label={{ value: "Safety stock", fontSize: 10, position: "insideBottomRight" }}
              />
              <Line
                type="monotone"
                dataKey="projected"
                name="Projected on hand"
                stroke="var(--chart-1)"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No projection is available for this SKU — demand history is insufficient to plan.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Inputs
          </h3>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {row.explanation.inputs.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Method
          </h3>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {row.explanation.method.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Output
          </h3>
          <p className="mt-1.5 text-sm text-foreground">{row.explanation.output}</p>
          {row.explanation.limitations.length > 0 ? (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Limitations
              </h3>
              <ul className="mt-1.5 space-y-1 text-sm text-status-watch">
                {row.explanation.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}
          {row.excessLocations.length > 0 ? (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Redistribution candidates
              </h3>
              <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                {row.excessLocations.map((l) => (
                  <li key={l.location}>
                    {l.location}: {num(l.onHand)} on hand
                    {l.coverDays != null ? ` (≈${num(l.coverDays)} days of cover)` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </div>
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
