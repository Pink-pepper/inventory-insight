import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, LineChart, ShieldCheck, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ionic — Know what to buy, when, and how much" },
      {
        name: "description",
        content:
          "Ionic turns inventory and sales data into transparent purchasing decisions for distributors: reorder points, order quantities and excess capital, explained in plain English.",
      },
      { property: "og:title", content: "Ionic — Inventory & purchasing decision intelligence" },
      {
        property: "og:description",
        content:
          "Transparent, rule-based reorder recommendations for distributors and inventory-based businesses.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: LineChart,
    title: "Decisions, not dashboards",
    body: "Every SKU gets a call — reorder, watch, hold or excess — with the quantity, the cost and the reasoning behind it.",
  },
  {
    icon: Boxes,
    title: "Connector-agnostic model",
    body: "CSV today, ERP connectors next. Everything maps into one canonical inventory model, so the logic never depends on column names.",
  },
  {
    icon: ShieldCheck,
    title: "Built for teams",
    body: "Organizations, roles and database-enforced row-level security keep every tenant's data strictly isolated.",
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
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Inventory & purchasing decision intelligence
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            Know what to buy, when to buy it, and how much.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Ionic reads your inventory and sales history and turns it into defensible purchasing
            decisions — reorder points, order quantities, stockout risk and the working capital
            trapped in excess stock. Transparent rules you can audit, not a black box.
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

        <section className="grid gap-3 pb-20 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel p-5">
              <f.icon className="size-4 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-6 text-xs text-muted-foreground">
          Ionic — inventory decision intelligence for growing distributors.
        </div>
      </footer>
    </div>
  );
}
