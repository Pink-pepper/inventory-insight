import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyState, Loading } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getOverview } from "@/lib/ionic.functions";
import { compactMoney, money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Inventory health overview — Ionic" },
      {
        name: "description",
        content:
          "Executive view of stock cover, reorder exposure, excess working capital and recommended purchasing requirement.",
      },
      { property: "og:title", content: "Inventory health overview — Ionic" },
      {
        property: "og:description",
        content: "Stock cover, reorder exposure and excess working capital at a glance.",
      },
    ],
  }),
  component: OverviewPage,
});

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "reorder" | "watch" | "excess" | "hold";
}) {
  const accent =
    tone === "reorder"
      ? "text-status-reorder"
      : tone === "watch"
        ? "text-status-watch"
        : tone === "excess"
          ? "text-status-excess"
          : tone === "hold"
            ? "text-status-hold"
            : "text-foreground";
  return (
    <div className="panel px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular ${accent}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const STATUS_FILL: Record<string, string> = {
  Reorder: "var(--status-reorder)",
  Watch: "var(--status-watch)",
  Healthy: "var(--status-hold)",
  Excess: "var(--status-excess)",
};

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "12px",
  },
} as const;

function OverviewPage() {
  const fn = useServerFn(getOverview);
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: () => fn() });

  return (
    <AppShell
      title="Overview"
      description="Inventory health and purchasing exposure across the workspace."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/recommendations">View recommendations</Link>
        </Button>
      }
    >
      {isLoading ? (
        <Loading label="Calculating inventory health" />
      ) : !data || data.totalSkus === 0 ? (
        <EmptyState
          title="No data yet"
          body="Connect a data source to calculate inventory health. You can upload a CSV extract or load the demo dataset to explore the product immediately."
          action={
            <Button asChild size="sm">
              <Link to="/data-sources">Go to Data Sources</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total SKUs" value={num(data.totalSkus)} sub={`${data.healthyCount} healthy`} />
            <Metric
              label="Requiring reorder"
              value={num(data.reorderCount)}
              sub={`${data.watchCount} on watch`}
              tone="reorder"
            />
            <Metric
              label="At stockout risk"
              value={num(data.stockoutRiskCount)}
              sub="Cover below supplier lead time"
              tone="watch"
            />
            <Metric
              label="Excess inventory"
              value={num(data.excessCount)}
              sub="SKUs above forward requirement"
              tone="excess"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Estimated inventory value" value={money(data.inventoryValue)} />
            <Metric
              label="Excess working capital"
              value={money(data.excessValue)}
              sub={`${Math.round((data.excessValue / Math.max(1, data.inventoryValue)) * 100)}% of stock value`}
              tone="excess"
            />
            <Metric
              label="Recommended purchasing requirement"
              value={money(data.purchaseRequirement)}
              sub={`Across ${data.reorderCount} SKUs`}
              tone="reorder"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Inventory value by category">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.valueByCategory} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => compactMoney(Number(v))}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={120}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip formatter={(v) => money(Number(v))} {...tooltipStyle} />
                  <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 2, 2, 0]} />
                  <Bar dataKey="excess" fill="var(--status-excess)" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Stock cover distribution">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.coverDistribution}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Reorder vs excess vs healthy">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.statusMix}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="status" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {data.statusMix.map((s) => (
                      <Cell key={s.status} fill={STATUS_FILL[s.status]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Recent demand trend (units shipped)">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={data.demandTrend}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis
                    tickFormatter={(v) => num(Number(v))}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip formatter={(v) => num(Number(v))} {...tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="units"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel title="Largest purchasing requirements">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 font-medium">SKU</th>
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 text-right font-medium">Cover</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Cost</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.topActions.map((r) => (
                  <tr key={r.sku} className="border-b border-border/60 last:border-0">
                    <td className="py-2 font-mono text-xs">
                      <Link
                        to="/sku/$sku"
                        params={{ sku: r.sku }}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {r.sku}
                      </Link>
                    </td>
                    <td className="py-2 text-muted-foreground">{r.name}</td>
                    <td className="py-2 text-right tabular">{Math.round(r.daysOfCover)} d</td>
                    <td className="py-2 text-right tabular">{num(r.recommendedQty)}</td>
                    <td className="py-2 text-right tabular">{money(r.estimatedCost)}</td>
                    <td className="py-2 text-right">
                      <StatusBadge action="REORDER" />
                    </td>
                  </tr>
                ))}
                {data.topActions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      No purchase orders recommended right now.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}