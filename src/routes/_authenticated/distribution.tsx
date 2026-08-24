import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell, EmptyState, Loading, useProductLabel } from "@/components/app-shell";
import { PlanningFilters } from "@/components/planning-filters";
import { Button } from "@/components/ui/button";
import { getDistributionPlan } from "@/lib/ionic.functions";
import type { TransferSuggestion } from "@/lib/distribution/plan";
import type { PlanningFilter } from "@/lib/query/filters";
import { money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/distribution")({
  head: () => ({
    meta: [
      { title: "Distribution — Ionic" },
      {
        name: "description",
        content:
          "Meet purchase requirements from your own network first: transfer suggestions from locations holding excess to locations that are short.",
      },
      { property: "og:title", content: "Distribution — Ionic" },
      {
        property: "og:description",
        content: "Internal stock transfer suggestions that reduce new purchasing, with the working shown.",
      },
    ],
  }),
  component: DistributionPage,
});

function DistributionPage() {
  const fn = useServerFn(getDistributionPlan);
  const [filter, setFilter] = useState<PlanningFilter>({});
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["distribution-plan", filter],
    queryFn: () => fn({ data: { filter } }),
  });

  const selected = data?.suggestions.find((s) => s.sku === selectedSku) ?? null;

  return (
    <AppShell
      title="Distribution"
      description="Before buying more: which locations can cover the requirement from their own excess."
      actions={
        <Button asChild size="sm" variant="outline">
          <Link to="/supply-planning">Supply Plan</Link>
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Analysing the network" />
      ) : isError ? (
        <EmptyState
          title="Could not build the distribution plan"
          body={error instanceof Error ? error.message : "The distribution query did not return a result."}
          action={
            <Button size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      ) : !data ? null : (
        <div className="space-y-4">
          <PlanningFilters filter={filter} options={data.options} onChange={setFilter} />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="SKUs with opportunities"
              value={num(data.summary.skusWithOpportunity)}
              hint={`of ${num(data.summary.skuCount)} in scope`}
            />
            <Metric
              label="Transfer units"
              value={num(data.summary.totalTransferUnits)}
              hint="Suggested internal movements"
            />
            <Metric
              label="Purchasing outlay avoided"
              value={money(data.summary.avoidableSpend)}
              hint={
                data.summary.spendComplete
                  ? "Transferred qty × recorded unit cost"
                  : "Some SKUs have no recorded unit cost"
              }
            />
            <Metric
              label="Still to purchase"
              value={num(
                data.suggestions.reduce((s, t) => s + t.remainingNetRequirement, 0),
              )}
              hint="Requirement transfers cannot cover"
            />
          </div>

          {data.summary.noLocationDemand ? (
            <div className="panel border-l-2 border-l-status-watch px-4 py-3 text-sm text-muted-foreground">
              No location-level demand was found. Transfer suggestions need day-grain transactions
              with a location column (Data Sources → Import, entity “Transactions”) — monthly sales
              totals do not say where demand occurred.
            </div>
          ) : null}

          {data.suggestions.length === 0 ? (
            <EmptyState
              title="No transfer opportunities"
              body="No location currently holds excess stock on a SKU that the supply plan says needs replenishment. When that changes, suggestions appear here before you buy."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/supply-planning">Review the supply plan</Link>
                </Button>
              }
            />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-surface-muted">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">Suggested transfers</th>
                    <th className="px-3 py-2 text-right font-medium">Transfer qty</th>
                    <th className="px-3 py-2 text-right font-medium">Value</th>
                    <th className="px-3 py-2 text-right font-medium">Purchase req.</th>
                    <th className="px-3 py-2 text-right font-medium">Still to buy</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suggestions.map((s) => (
                    <tr
                      key={s.sku}
                      className={`cursor-pointer border-t border-border/70 align-top hover:bg-surface-muted/60 ${
                        selectedSku === s.sku ? "bg-surface-muted/60" : ""
                      }`}
                      onClick={() => setSelectedSku(selectedSku === s.sku ? null : s.sku)}
                    >
                      <SuggestionCells suggestion={s} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected ? <SuggestionDetail suggestion={selected} onClose={() => setSelectedSku(null)} /> : null}

          <div className="panel px-4 py-4">
            <h2 className="text-sm font-semibold text-foreground">Method and limits</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                A transfer is only suggested against a purchase requirement the supply plan has
                already computed — redistribution never creates a need that was not there.
              </li>
              <li>
                Each location keeps its own requirement: local demand × (lead time + safety stock
                days + one review period). Only stock above that floor is transferable.
              </li>
              <li>
                Local demand is measured from day-grain transactions with a location. Locations
                without recorded demand cannot be destinations, and their stock is treated as
                transferable with a note.
              </li>
              <li>
                Purchase orders addressed to a receiving location count toward that location's
                cover; undated POs are not phased.
              </li>
              <li>
                Transfer cost, transit time and capacity are not modelled — the quantities are
                suggestions for a planner to action, not automated movements.
              </li>
            </ul>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function SuggestionCells({ suggestion: s }: { suggestion: TransferSuggestion }) {
  const label = useProductLabel();
  return (
    <>
      <td className="px-3 py-2.5">
        <span className="text-primary underline-offset-4 hover:underline">
          {label(s.sku, s.name)}
        </span>
        <span className="block text-[11px] text-muted-foreground">{s.category}</span>
      </td>
      <td className="px-3 py-2.5">
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {s.legs.map((leg, i) => (
            <li key={i}>
              <span className="font-medium text-foreground">{leg.fromLocation}</span>
              {" → "}
              <span className="font-medium text-foreground">{leg.toLocation}</span>
              {" · "}
              <span className="tabular">{num(leg.quantity)}</span>
            </li>
          ))}
        </ul>
      </td>
      <td className="px-3 py-2.5 text-right tabular font-medium">{num(s.totalQuantity)}</td>
      <td className="px-3 py-2.5 text-right tabular">
        {s.unitCost > 0 ? money(s.totalQuantity * s.unitCost) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right tabular">{num(s.netRequirement)}</td>
      <td className="px-3 py-2.5 text-right tabular">
        {s.remainingNetRequirement > 0 ? num(s.remainingNetRequirement) : "0 — covered"}
      </td>
      <td className="max-w-[260px] px-3 py-2.5 text-xs text-status-watch">
        {s.notes.join(" ") || "—"}
      </td>
    </>
  );
}

function SuggestionDetail({
  suggestion: s,
  onClose,
}: {
  suggestion: TransferSuggestion;
  onClose: () => void;
}) {
  const label = useProductLabel();
  return (
    <div className="panel px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Network balance — {label(s.sku, s.name)}
        </h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-muted">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 text-right font-medium">On hand</th>
              <th className="px-3 py-2 text-right font-medium">Inbound (ETA)</th>
              <th className="px-3 py-2 text-right font-medium">Avg daily demand</th>
              <th className="px-3 py-2 text-right font-medium">Keeps</th>
              <th className="px-3 py-2 text-right font-medium">Excess</th>
              <th className="px-3 py-2 text-right font-medium">Short by</th>
            </tr>
          </thead>
          <tbody>
            {s.balances.map((b) => (
              <tr key={b.location} className="border-t border-border/70">
                <td className="px-3 py-2 font-medium text-foreground">{b.location}</td>
                <td className="px-3 py-2 text-right tabular">{num(b.onHand)}</td>
                <td className="px-3 py-2 text-right tabular">{num(b.scheduledInbound)}</td>
                <td className="px-3 py-2 text-right tabular">
                  {b.avgDailyDemand == null ? (
                    <span className="text-muted-foreground">no history</span>
                  ) : (
                    num(b.avgDailyDemand, 2)
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular">
                  {b.keepQty == null ? "—" : num(b.keepQty)}
                </td>
                <td className="px-3 py-2 text-right tabular text-status-hold">
                  {b.excess > 0 ? num(b.excess) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular text-status-reorder">
                  {b.need > 0 ? num(b.need) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        “Keeps” = local avg daily demand × (lead time + safety stock days + review period). Excess
        above that floor feeds the suggestions; destinations are locations short of their lead-time
        + safety cover.
      </p>
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
