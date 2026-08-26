import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppShell, CardsSkeleton, EmptyState, TableSkeleton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getControlTower } from "@/lib/control-tower.functions";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ControlTowerSignal,
  type SignalCategory,
} from "@/lib/control-tower/signals";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/overview")({
  head: () => ({
    meta: [
      { title: "Control Tower — Ionic" },
      {
        name: "description",
        content:
          "A prioritised operator briefing: what is urgent, what needs attention, where the opportunities are, and what is simply worth knowing.",
      },
      { property: "og:title", content: "Control Tower — Ionic" },
      {
        property: "og:description",
        content: "The day's decisions, ranked, with the evidence behind each one.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlTowerPage,
});

const TONE: Record<SignalCategory, { dot: string; chip: string }> = {
  urgent: { dot: "bg-status-reorder", chip: "text-status-reorder" },
  attention: { dot: "bg-status-watch", chip: "text-status-watch" },
  opportunity: { dot: "bg-chart-1", chip: "text-chart-1" },
  information: { dot: "bg-muted-foreground", chip: "text-muted-foreground" },
  healthy: { dot: "bg-status-hold", chip: "text-status-hold" },
};

/**
 * The signal carries a route it wants to open. Route strings are data here, so
 * the typed Link is widened deliberately at this single boundary.
 */
const RouteLink = Link as unknown as React.ComponentType<{
  to: string;
  params?: Record<string, string> | undefined;
  className?: string;
  children: React.ReactNode;
}>;

function SignalRow({ signal }: { signal: ControlTowerSignal }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[signal.category];

  return (
    <div className="border-b border-border/70 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted"
      >
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{signal.headline}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{signal.what}</span>
        </span>
        <ChevronRight
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-border/60 bg-surface-muted/60 px-4 py-3 pl-9 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              What is happening
            </p>
            <p className="mt-0.5 text-foreground">{signal.what}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Why it matters
            </p>
            <p className="mt-0.5 text-muted-foreground">{signal.why}</p>
          </div>
          {signal.evidence.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Evidence
              </p>
              <ul className="mt-1 space-y-0.5">
                {signal.evidence.map((e) => (
                  <li key={e} className="text-xs text-foreground tabular">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suggested next step
            </p>
            <p className="mt-0.5 text-muted-foreground">{signal.nextAction}</p>
          </div>
          {signal.link ? (
            <RouteLink
              to={signal.link.to}
              params={signal.link.params}
              className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              {signal.link.label} →
            </RouteLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ControlTowerPage() {
  const fn = useServerFn(getControlTower);
  const { data, isLoading } = useQuery({ queryKey: ["control-tower"], queryFn: () => fn() });
  const [filter, setFilter] = useState<SignalCategory | "all">("all");

  const signals = data?.signals ?? [];
  const visible = filter === "all" ? signals : signals.filter((s) => s.category === filter);

  return (
    <AppShell
      title="Control Tower"
      description="What needs a decision today, ranked, with the evidence behind each one."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link to="/recommendations">View analytics</Link>
        </Button>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <CardsSkeleton count={4} />
          <TableSkeleton rows={6} columns={3} />
        </div>
      ) : !data || data.totals.skus === 0 ? (
        <EmptyState
          title="No data yet"
          body="Connect a data source to build the briefing. Upload a spreadsheet extract or load the demo dataset to explore the product immediately."
          action={
            <Button asChild size="sm">
              <Link to="/data-sources">Go to Data Sources</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CATEGORY_ORDER.filter((c) => c !== "healthy").map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(filter === c ? "all" : c)}
                className={cn(
                  "panel px-4 py-3.5 text-left transition-colors hover:bg-surface-muted",
                  filter === c && "ring-1 ring-primary",
                )}
              >
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABEL[c]}
                </p>
                <p className={cn("mt-1.5 text-2xl font-semibold tabular", TONE[c].chip)}>
                  {num(data.counts[c])}
                </p>
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {num(data.totals.skus)} SKUs · {num(data.totals.openShipments)} open shipments ·{" "}
            {num(data.totals.openQuotations)} open quotations · {num(data.totals.openProjects)}{" "}
            active projects
            {filter !== "all" ? (
              <>
                {" · "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={() => setFilter("all")}
                >
                  Clear filter
                </button>
              </>
            ) : null}
          </p>

          <section className="panel">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Briefing</h2>
              <span className="text-xs text-muted-foreground">
                {visible.length} {visible.length === 1 ? "item" : "items"}
              </span>
            </header>
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing in this category right now.
              </p>
            ) : (
              visible.map((s) => <SignalRow key={s.id} signal={s} />)
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
