import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, Boxes, LineChart, Ship, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ionic — Know what to buy, when, and how much" },
      {
        name: "description",
        content:
          "Ionic turns your commercial and inventory data into one operator briefing: what to buy, when to buy it, what it lands at, and what your customers actually need.",
      },
      { property: "og:title", content: "Ionic — Decision intelligence for distributors" },
      {
        property: "og:description",
        content:
          "One control tower for demand, supply, landed cost and the business plan behind them.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const PILLARS = [
  {
    icon: Compass,
    title: "A briefing, not a dashboard",
    body: "Every morning Ionic ranks what needs a decision — cover breaches, slipping ETAs, ageing quotations — with the evidence attached.",
  },
  {
    icon: LineChart,
    title: "One demand book",
    body: "History, requirements, quotations and confirmed orders resolve into a single expected demand picture. Nothing is counted twice.",
  },
  {
    icon: Ship,
    title: "Landed economics",
    body: "Freight, duty, clearance and FX build up into the real unit cost, so a quoted price is checked against what the goods actually cost.",
  },
  {
    icon: Boxes,
    title: "Plans that reconcile",
    body: "Build the year bottom-up from customers, or set the target top-down and allocate it. Ionic shows the gap between the two.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-primary-foreground">
              I
            </div>
            <span className="text-sm font-semibold tracking-tight">Ionic</span>
          </div>
          <Button asChild size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-20">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Decision intelligence for B2B distributors
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Know what to buy, when to buy it, and how much.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Ionic reads your sales, stock, purchase orders and commercial pipeline, and turns them
            into defensible decisions — reorder quantities, landed cost, expected demand and the
            capital sitting in excess stock. Transparent rules you can audit, not a black box.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/auth">
                Start free <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/auth">Explore the demo dataset</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-3 pb-14 sm:grid-cols-2">
          {PILLARS.map((f) => (
            <div key={f.title} className="panel p-5">
              <f.icon className="size-4 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>

        <section className="mb-20 rounded-lg border border-border bg-surface-muted p-6">
          <div className="flex flex-wrap items-start gap-4">
            <Truck className="mt-0.5 size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">Distribution planning</h2>
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Coming soon
                </span>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Multi-location rebalancing — moving stock to where the demand actually is, with the
                same transparent rules behind every suggested transfer.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-6 text-xs text-muted-foreground">
          Ionic — inventory and commercial decision intelligence for growing distributors.
        </div>
      </footer>
    </div>
  );
}
