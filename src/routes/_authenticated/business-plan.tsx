import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Sparkles } from "lucide-react";
import { AppShell, TableSkeleton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  allocatePlan,
  getBusinessPlans,
  savePlan,
  seedPlanFromDemand,
} from "@/lib/business-plan.functions";
import { reconcile, rollup, type PlanDimension } from "@/lib/domain/business-plan";
import { compactMoney, money, num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/business-plan")({
  head: () => ({
    meta: [
      { title: "Business Plan — Ionic" },
      {
        name: "description",
        content:
          "Annual revenue and gross-profit targets reconciled against contribution lines by supplier, product and customer — bottom-up from the Demand Book or top-down by allocation.",
      },
      { property: "og:title", content: "Business Plan — Ionic" },
      {
        property: "og:description",
        content: "Targets, contribution lines and the reconciliation gap, always visible.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BusinessPlanPage,
});

function BusinessPlanPage() {
  const listFn = useServerFn(getBusinessPlans);
  const saveFn = useServerFn(savePlan);
  const seedFn = useServerFn(seedPlanFromDemand);
  const allocFn = useServerFn(allocatePlan);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dimension, setDimension] = useState<PlanDimension>("product");

  const plans = useQuery({ queryKey: ["business-plans"], queryFn: () => listFn() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["business-plans"] });

  const saveMut = useMutation({
    mutationFn: (values: Parameters<typeof saveFn>[0]) => saveFn(values),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
  });
  const seedMut = useMutation({
    mutationFn: (planId: string) => seedFn({ data: { planId } }),
    onSuccess: invalidate,
  });
  const allocMut = useMutation({
    mutationFn: (v: { planId: string; revenueTarget: number }) => allocFn({ data: v }),
    onSuccess: invalidate,
  });

  const plan = useMemo(() => {
    const all = plans.data ?? [];
    return all.find((p) => p.id === selected) ?? all[0] ?? null;
  }, [plans.data, selected]);

  const rec = plan ? reconcile(plan) : null;
  const rows = plan ? rollup(plan, dimension) : [];

  return (
    <AppShell
      title="Business Plan"
      description="Targets versus contribution lines. Bottom-up seeds from the Demand Book; top-down allocates a target across the same lines."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" /> New plan
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New business plan</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                saveMut.mutate({
                  data: {
                    values: {
                      name: String(f.get("name") ?? ""),
                      plan_year: Number(f.get("plan_year") ?? new Date().getFullYear()),
                      direction: String(f.get("direction") ?? "bottom_up") as
                        | "bottom_up"
                        | "top_down",
                      revenue_target: Number(f.get("revenue_target") ?? 0),
                      gross_profit_target: Number(f.get("gross_profit_target") ?? 0),
                    },
                  },
                });
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="name">Plan name</Label>
                <Input id="name" name="name" required maxLength={160} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="plan_year">Year</Label>
                  <Input
                    id="plan_year"
                    name="plan_year"
                    type="number"
                    defaultValue={new Date().getFullYear()}
                    min={2000}
                    max={2100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="direction">Direction</Label>
                  <select
                    id="direction"
                    name="direction"
                    className="h-9 w-full rounded-sm border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="bottom_up">Bottom-up</option>
                    <option value="top_down">Top-down</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="revenue_target">Revenue target</Label>
                  <Input id="revenue_target" name="revenue_target" type="number" min="0" step="0.01" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gross_profit_target">Gross profit target</Label>
                  <Input
                    id="gross_profit_target"
                    name="gross_profit_target"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={saveMut.isPending}>
                  Create plan
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {plans.isLoading ? (
        <TableSkeleton columns={5} />
      ) : !plan ? (
        <div className="panel p-10 text-center text-sm text-muted-foreground">
          No business plan yet. Create one to set an annual revenue and gross-profit target.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select plan"
              value={plan.id}
              onChange={(e) => setSelected(e.target.value)}
              className="h-9 rounded-sm border border-input bg-transparent px-2 text-sm"
            >
              {(plans.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.planYear}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={seedMut.isPending}
              onClick={() => seedMut.mutate(plan.id)}
            >
              <Sparkles className="size-4" /> Seed from Demand Book
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={allocMut.isPending || plan.lines.length === 0}
              onClick={() =>
                allocMut.mutate({ planId: plan.id, revenueTarget: plan.revenueTarget })
              }
            >
              Allocate target top-down
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Revenue target" value={compactMoney(plan.revenueTarget)} />
            <Metric label="Planned revenue" value={compactMoney(rec!.plannedRevenue)} />
            <Metric
              label="Revenue gap"
              value={compactMoney(rec!.revenueGap)}
              tone={rec!.revenueGap > 0 ? "warn" : "ok"}
            />
            <Metric
              label="Planned margin"
              value={rec!.marginPct == null ? "—" : `${rec!.marginPct.toFixed(1)}%`}
            />
            <Metric label="GP target" value={compactMoney(plan.grossProfitTarget)} />
            <Metric label="Planned GP" value={compactMoney(rec!.plannedGrossProfit)} />
            <Metric
              label="GP gap"
              value={compactMoney(rec!.grossProfitGap)}
              tone={rec!.grossProfitGap > 0 ? "warn" : "ok"}
            />
            <Metric label="Contribution lines" value={String(plan.lines.length)} />
          </div>

          <div className="flex gap-1">
            {(["product", "supplier", "customer"] as PlanDimension[]).map((d) => (
              <button
                key={d}
                onClick={() => setDimension(d)}
                className={
                  d === dimension
                    ? "rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
                    : "rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                By {d}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="panel p-10 text-center text-sm text-muted-foreground">
              No contribution lines yet. Seed from the Demand Book, or add lines to build the plan
              bottom-up.
            </div>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{dimension}</th>
                    <th className="px-3 py-2.5 text-right font-medium">Quantity</th>
                    <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
                    <th className="px-3 py-2.5 text-right font-medium">Gross profit</th>
                    <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                    <th className="px-3 py-2.5 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-surface-muted/60">
                      <td className="px-3 py-2.5 font-medium">{r.label}</td>
                      <td className="px-3 py-2.5 text-right tabular">{num(r.quantity)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{money(r.revenue)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{money(r.grossProfit)}</td>
                      <td className="px-3 py-2.5 text-right tabular">
                        {r.revenue > 0 ? `${((r.grossProfit / r.revenue) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                        {r.sharePct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="panel px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={
          tone === "warn"
            ? "mt-1.5 text-xl font-semibold tabular text-status-watch"
            : tone === "ok"
              ? "mt-1.5 text-xl font-semibold tabular text-status-hold"
              : "mt-1.5 text-xl font-semibold tabular"
        }
      >
        {value}
      </p>
    </div>
  );
}
