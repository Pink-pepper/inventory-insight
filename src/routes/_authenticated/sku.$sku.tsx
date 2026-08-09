import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getSkuDetail } from "@/lib/ionic.functions";
import { cover, money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/sku/$sku")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.sku} — SKU analysis · Ionic` },
      {
        name: "description",
        content: `Demand history, reorder point, safety stock and recommended purchase quantity for SKU ${params.sku}.`,
      },
      { property: "og:title", content: `${params.sku} — SKU analysis · Ionic` },
      {
        property: "og:description",
        content: `Full decision trace for SKU ${params.sku}: demand, cover, reorder point and reasoning.`,
      },
    ],
  }),
  component: SkuPage,
});

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2.5 last:border-0">
      <div>
        <p className="text-sm text-foreground">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <p className="shrink-0 text-sm font-medium tabular">{value}</p>
    </div>
  );
}

function SkuPage() {
  const { sku } = Route.useParams();
  const fn = useServerFn(getSkuDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["sku", sku],
    queryFn: () => fn({ data: { sku } }),
  });

  const chart = (data?.monthlySales ?? [])
    .slice()
    .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth))
    .map((m) => ({ month: m.periodMonth.slice(0, 7), units: m.quantity }));

  return (
    <AppShell
      title={data ? `${data.sku} · ${data.name}` : sku}
      description={data ? `${data.category} · supplied by ${data.supplierName}` : "SKU analysis"}
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/recommendations">
            <ArrowLeft className="size-3.5" /> Back
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Loading SKU" />
      ) : !data ? (
        <EmptyState title="SKU not found" body="This SKU is not present in the current workspace dataset." />
      ) : (
        <div className="space-y-4">
          <section className="panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge action={data.action} />
              {data.stockoutRisk ? (
                <span className="text-xs font-medium text-status-reorder">Stockout risk</span>
              ) : null}
              <span className="ml-auto text-sm text-muted-foreground">
                {data.recommendedQty > 0
                  ? `Recommended order: ${num(data.recommendedQty)} units · ${money(data.estimatedCost)}`
                  : "No purchase recommended"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-foreground">{data.reason}</p>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Decision inputs</h2>
              <div className="mt-2">
                <Row label="On hand" value={num(data.onHand)} />
                <Row label="On order" value={num(data.onOrder)} />
                <Row label="Net available" value={num(data.netAvailable)} hint="On hand + on order" />
                <Row
                  label="Average monthly demand"
                  value={num(data.avgMonthlyDemand, 1)}
                  hint="Trailing 6-month average"
                />
                <Row label="Average daily demand" value={num(data.avgDailyDemand, 2)} />
                <Row
                  label="Demand trend"
                  value={`${data.demandTrendPct > 0 ? "+" : ""}${num(data.demandTrendPct, 1)}%`}
                  hint="Last 3 months vs prior 3 months"
                />
                <Row label="Supplier lead time" value={`${data.leadTimeDays} days`} />
                <Row label="Minimum order quantity" value={num(data.minOrderQty)} />
                <Row label="Unit cost" value={money(data.unitCost, 2)} />
              </div>
            </section>

            <section className="panel p-5">
              <h2 className="text-sm font-semibold">Calculated position</h2>
              <div className="mt-2">
                <Row label="Days of cover" value={cover(data.daysOfCover)} />
                <Row
                  label="Safety stock"
                  value={num(data.safetyStock)}
                  hint={`${data.safetyStockDays}-day buffer at current run rate`}
                />
                <Row
                  label="Reorder point"
                  value={num(data.reorderPoint)}
                  hint="Lead-time demand + safety stock"
                />
                <Row
                  label="Target stock position"
                  value={num(data.targetStock)}
                  hint="Lead time + 30-day review period + safety"
                />
                <Row label="Excess units" value={num(data.excessUnits)} />
                <Row label="Inventory value" value={money(data.inventoryValue)} />
                <Row label="Excess capital" value={money(data.excessValue)} />
              </div>
            </section>
          </div>

          <section className="panel">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Demand history (units per month)</h2>
            </header>
            <div className="p-4">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chart}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip
                    formatter={(v) => num(Number(v))}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <ReferenceLine
                    y={data.avgMonthlyDemand}
                    stroke="var(--status-watch)"
                    strokeDasharray="4 4"
                  />
                  <Bar dataKey="units" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}