/**
 * The Control Tower.
 *
 * This module turns data the workspace already holds into a prioritised
 * operator briefing. It invents nothing: every row points at a record that
 * exists, and every number is either read directly or derived here from
 * values the engines already produced.
 *
 * The function is deliberately pure and structurally typed, so it can be
 * exercised in tests without a database and reused wherever the same shapes
 * are available.
 */

export type SignalCategory = "urgent" | "attention" | "opportunity" | "information" | "healthy";

export const CATEGORY_ORDER: SignalCategory[] = [
  "urgent",
  "attention",
  "opportunity",
  "information",
  "healthy",
];

export const CATEGORY_LABEL: Record<SignalCategory, string> = {
  urgent: "Urgent",
  attention: "Attention",
  opportunity: "Opportunity",
  information: "Information",
  healthy: "Healthy",
};

export interface ControlTowerSignal {
  id: string;
  category: SignalCategory;
  /** Higher sorts first inside a category. */
  weight: number;
  /** One line the operator reads first. */
  headline: string;
  /** What is happening, in plain language. */
  what: string;
  /** Why it matters to the business. */
  why: string;
  /** The numbers behind the row, each already formatted as a phrase. */
  evidence: string[];
  /** What the operator should consider doing next. */
  nextAction: string;
  /** Where to go to act on it. */
  link: { to: string; params?: Record<string, string>; label: string } | null;
}

// ---------------------------------------------------------------------------
// Inputs — structural, so callers pass what they already loaded.
// ---------------------------------------------------------------------------

export interface TowerRecommendation {
  sku: string;
  name: string;
  action: string;
  recommendedQty: number;
  estimatedCost: number;
  daysOfCover: number;
  avgMonthlyDemand: number;
  excessValue: number;
  stockoutRisk: boolean;
  blocked: boolean;
  leadTimeDays: number | null;
  onHand: number;
}

export interface TowerShipment {
  id: string;
  reference: string;
  status: string;
  supplierName: string | null;
  eta: string | null;
  revisedEta: string | null;
  arrivedOn: string | null;
}

export interface TowerQuotation {
  id: string;
  reference: string | null;
  customerName: string | null;
  productName: string | null;
  quantity: number;
  unitPrice: number | null;
  status: string;
  issuedOn: string | null;
  validUntil: string | null;
}

export interface TowerMarketSignal {
  id: string;
  title: string;
  detail: string | null;
  impact: string;
  observedOn: string;
  customerName: string | null;
  supplierName: string | null;
}

export interface TowerDemandRow {
  sku: string;
  productName: string;
  period: string;
  committedQty: number;
  resolvedQty: number;
}

export interface TowerProject {
  id: string;
  name: string;
  customerName: string | null;
  stage: string;
  status: string;
  expectedValue: number | null;
  expectedClose: string | null;
}

export interface ControlTowerInput {
  today: string;
  recommendations: TowerRecommendation[];
  shipments: TowerShipment[];
  quotations: TowerQuotation[];
  marketSignals: TowerMarketSignal[];
  demandRows: TowerDemandRow[];
  projects: TowerProject[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const cash = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Delay in days against the promised ETA, once a revision or arrival exists. */
export function shipmentSlip(s: TowerShipment): number | null {
  if (!s.eta) return null;
  const current = s.arrivedOn ?? s.revisedEta;
  if (!current) return null;
  return daysBetween(s.eta, current);
}

// ---------------------------------------------------------------------------
// Signal builders — one per concern, all pure.
// ---------------------------------------------------------------------------

function stockSignals(input: ControlTowerInput): ControlTowerSignal[] {
  const out: ControlTowerSignal[] = [];

  for (const r of input.recommendations) {
    if (r.blocked) {
      out.push({
        id: `blocked:${r.sku}`,
        category: "attention",
        weight: 40,
        headline: `${r.sku} cannot be planned`,
        what: `A required planning input is missing for ${r.name}, so no order quantity can be trusted.`,
        why: "A blocked SKU is invisible to purchasing: it will neither be reordered nor flagged as at risk.",
        evidence: [
          `${int(r.onHand)} units on hand`,
          r.leadTimeDays == null ? "No lead time recorded" : `${r.leadTimeDays}-day lead time`,
        ],
        nextAction: "Complete the missing master data on the product or its supplier.",
        link: { to: "/sku/$sku", params: { sku: r.sku }, label: "Open SKU" },
      });
      continue;
    }

    if (r.stockoutRisk) {
      out.push({
        id: `stockout:${r.sku}`,
        category: "urgent",
        weight: 100 + Math.max(0, 60 - r.daysOfCover),
        headline: `${r.sku} runs out before replenishment can land`,
        what: `${r.name} has ${Math.round(r.daysOfCover)} days of cover against a ${
          r.leadTimeDays ?? "n/a"
        }-day lead time.`,
        why: "Ordering now still leaves a gap, so demand in that window is at risk of going unserved.",
        evidence: [
          `${int(r.onHand)} units on hand`,
          `${int(r.avgMonthlyDemand)} units per month of demand`,
          `Suggested order ${int(r.recommendedQty)} units (${cash(r.estimatedCost)})`,
        ],
        nextAction: "Raise or expedite a purchase order, and check whether an inbound shipment can be pulled forward.",
        link: { to: "/sku/$sku", params: { sku: r.sku }, label: "Open SKU" },
      });
      continue;
    }

    if (r.action === "REORDER") {
      out.push({
        id: `reorder:${r.sku}`,
        category: "attention",
        weight: 60 + Math.max(0, 60 - r.daysOfCover),
        headline: `${r.sku} has reached its reorder point`,
        what: `${r.name} is down to ${Math.round(r.daysOfCover)} days of cover.`,
        why: "Placing the order now keeps cover intact through the supplier lead time.",
        evidence: [
          `Suggested order ${int(r.recommendedQty)} units`,
          `Estimated spend ${cash(r.estimatedCost)}`,
        ],
        nextAction: "Review the suggested quantity and place the order.",
        link: { to: "/sku/$sku", params: { sku: r.sku }, label: "Open SKU" },
      });
      continue;
    }

    if (r.action === "EXCESS" && r.excessValue > 0) {
      out.push({
        id: `excess:${r.sku}`,
        category: "opportunity",
        weight: Math.min(90, r.excessValue / 1000),
        headline: `${cash(r.excessValue)} tied up in ${r.sku}`,
        what: `${r.name} holds ${Math.round(r.daysOfCover)} days of cover, well above forward requirement.`,
        why: "That stock is working capital sitting still, and it ages while it waits.",
        evidence: [
          `${int(r.onHand)} units on hand`,
          `${int(r.avgMonthlyDemand)} units per month of demand`,
        ],
        nextAction: "Consider a promotion, a transfer, or holding off the next replenishment.",
        link: { to: "/sku/$sku", params: { sku: r.sku }, label: "Open SKU" },
      });
    }
  }

  // Slow movers: stock on hand with no demand at all.
  const slow = input.recommendations.filter((r) => r.onHand > 0 && r.avgMonthlyDemand <= 0);
  if (slow.length > 0) {
    out.push({
      id: "slow-movers",
      category: "information",
      weight: 30,
      headline: `${slow.length} SKUs are holding stock with no recorded demand`,
      what: "These products have units on hand but no sales history in the demand window.",
      why: "They will never trigger a replenishment signal, so they quietly consume space and capital.",
      evidence: slow.slice(0, 5).map((r) => `${r.sku} — ${int(r.onHand)} units`),
      nextAction: "Confirm whether demand data is missing or the product is genuinely dormant.",
      link: { to: "/inventory", label: "Open Inventory" },
    });
  }

  return out;
}

function shipmentSignals(input: ControlTowerInput): ControlTowerSignal[] {
  const out: ControlTowerSignal[] = [];
  const open = new Set(["planned", "booked", "in_transit", "arrived", "clearing", "cleared"]);

  for (const s of input.shipments) {
    if (!open.has(s.status)) continue;

    const slip = shipmentSlip(s);
    if (slip != null && slip > 0) {
      out.push({
        id: `shipment-slip:${s.id}`,
        category: slip >= 14 ? "urgent" : "attention",
        weight: 80 + slip,
        headline: `Shipment ${s.reference} is ${slip} days late`,
        what: `The arrival moved from ${s.eta} to ${s.arrivedOn ?? s.revisedEta}.`,
        why: "Inbound cover shifts with it, so any SKU depending on this shipment loses that many days of protection.",
        evidence: [
          s.supplierName ? `Supplier ${s.supplierName}` : "No supplier recorded",
          `Status ${s.status.replace(/_/g, " ")}`,
        ],
        nextAction: "Reconfirm the revised date with the supplier and check cover on the affected SKUs.",
        link: { to: "/supply", label: "Open Shipments" },
      });
      continue;
    }

    const eta = s.revisedEta ?? s.eta;
    if (eta) {
      const due = daysBetween(input.today, eta);
      if (due != null && due < 0 && !s.arrivedOn) {
        out.push({
          id: `shipment-overdue:${s.id}`,
          category: "urgent",
          weight: 90 - due,
          headline: `Shipment ${s.reference} is past its arrival date`,
          what: `It was expected on ${eta} and has not been recorded as arrived.`,
          why: "Planning still counts these units as inbound, so projected cover is optimistic until it is resolved.",
          evidence: [
            s.supplierName ? `Supplier ${s.supplierName}` : "No supplier recorded",
            `${Math.abs(due)} days past the expected date`,
          ],
          nextAction: "Record the arrival, or update the ETA so the projection reflects reality.",
          link: { to: "/supply/inbound", label: "Open Inbound" },
        });
      }
    } else {
      out.push({
        id: `shipment-unscheduled:${s.id}`,
        category: "information",
        weight: 20,
        headline: `Shipment ${s.reference} has no expected date`,
        what: "No ETA, revised ETA or arrival is recorded.",
        why: "Without a date the units cannot be phased into the supply projection at all.",
        evidence: [`Status ${s.status.replace(/_/g, " ")}`],
        nextAction: "Add the expected arrival date to the shipment.",
        link: { to: "/supply", label: "Open Shipments" },
      });
    }
  }

  return out;
}

function commercialSignals(input: ControlTowerInput): ControlTowerSignal[] {
  const out: ControlTowerSignal[] = [];

  for (const q of input.quotations) {
    if (q.status !== "open") continue;
    const label = q.reference ?? q.productName ?? "Quotation";

    if (q.validUntil) {
      const left = daysBetween(input.today, q.validUntil);
      if (left != null && left <= 14) {
        out.push({
          id: `quote-expiry:${q.id}`,
          category: left < 0 ? "attention" : "opportunity",
          weight: 70 - left,
          headline:
            left < 0
              ? `Quotation ${label} has expired`
              : `Quotation ${label} expires in ${left} days`,
          what: `${q.customerName ?? "A customer"} is holding a quotation for ${int(q.quantity)} units${
            q.productName ? ` of ${q.productName}` : ""
          }.`,
          why: "An expiring quotation is either revenue about to close or demand about to disappear from the book.",
          evidence: [
            q.unitPrice != null ? `Quoted at ${cash(q.unitPrice)} per unit` : "No price recorded",
            `Valid until ${q.validUntil}`,
          ],
          nextAction: "Follow up with the customer, or re-issue with current pricing.",
          link: { to: "/business", label: "Open Demand Book" },
        });
        continue;
      }
    }

    if (q.issuedOn) {
      const age = daysBetween(q.issuedOn, input.today);
      if (age != null && age >= 30) {
        out.push({
          id: `quote-age:${q.id}`,
          category: "attention",
          weight: 40 + Math.min(40, age / 3),
          headline: `Quotation ${label} has been open ${age} days`,
          what: `${q.customerName ?? "A customer"} has not responded since ${q.issuedOn}.`,
          why: "Stale quotations inflate potential demand and distort the plan.",
          evidence: [`${int(q.quantity)} units quoted`],
          nextAction: "Chase it, or mark it lost so the demand picture stays honest.",
          link: { to: "/business", label: "Open Demand Book" },
        });
      }
    }
  }

  // Committed demand with no product cover anywhere in the recommendations.
  const known = new Set(input.recommendations.map((r) => r.sku));
  const unmatched = input.demandRows.filter((d) => d.committedQty > 0 && !known.has(d.sku));
  if (unmatched.length > 0) {
    out.push({
      id: "unmatched-committed",
      category: "urgent",
      weight: 95,
      headline: `${unmatched.length} committed demand lines have no stock position`,
      what: "These products are committed to customers but do not appear in the inventory planning view.",
      why: "The commitment cannot be planned or fulfilled until the product exists on the supply side.",
      evidence: unmatched
        .slice(0, 5)
        .map((d) => `${d.sku} — ${int(d.committedQty)} units in ${d.period}`),
      nextAction: "Add the product master data, or correct the demand line.",
      link: { to: "/business", label: "Open Demand Book" },
    });
  }

  for (const p of input.projects) {
    if (p.status !== "open" || !p.expectedClose) continue;
    const left = daysBetween(input.today, p.expectedClose);
    if (left == null || left > 30) continue;
    out.push({
      id: `project-close:${p.id}`,
      category: left < 0 ? "attention" : "opportunity",
      weight: 55 - left,
      headline:
        left < 0
          ? `${p.name} is past its expected close`
          : `${p.name} is expected to close in ${left} days`,
      what: `${p.customerName ?? "A customer"} project sitting at the ${p.stage.replace(/_/g, " ")} stage.`,
      why: "A project close converts potential demand into a commitment that supply has to be ready for.",
      evidence: [
        p.expectedValue != null ? `Expected value ${cash(p.expectedValue)}` : "No value recorded",
        `Expected close ${p.expectedClose}`,
      ],
      nextAction: "Confirm the stage with the customer and pre-position supply if it is likely to land.",
      link: { to: "/projects", label: "Open Projects" },
    });
  }

  for (const m of input.marketSignals) {
    const age = daysBetween(m.observedOn, input.today);
    if (age != null && age > 90) continue;
    out.push({
      id: `market:${m.id}`,
      category: m.impact === "risk" ? "attention" : m.impact === "opportunity" ? "opportunity" : "information",
      weight: 25,
      headline: m.title,
      what: m.detail ?? "Observed in the market and recorded against this workspace.",
      why: "Market context does not change any number here; it explains the ones that move.",
      evidence: [
        `Observed ${m.observedOn}`,
        m.customerName ? `Customer ${m.customerName}` : m.supplierName ? `Supplier ${m.supplierName}` : "Market-wide",
      ],
      nextAction: "Judge whether it should change a plan, a price or a supplier choice.",
      link: { to: "/business/signals", label: "Open Market Signals" },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface ControlTowerBriefing {
  signals: ControlTowerSignal[];
  counts: Record<SignalCategory, number>;
  /** True when nothing needs the operator's attention today. */
  allClear: boolean;
}

export function buildControlTower(input: ControlTowerInput): ControlTowerBriefing {
  const signals = [
    ...stockSignals(input),
    ...shipmentSignals(input),
    ...commercialSignals(input),
  ];

  const counts: Record<SignalCategory, number> = {
    urgent: 0,
    attention: 0,
    opportunity: 0,
    information: 0,
    healthy: 0,
  };
  for (const s of signals) counts[s.category] += 1;

  const pressing = counts.urgent + counts.attention;
  if (pressing === 0 && input.recommendations.length > 0) {
    const healthy = input.recommendations.filter(
      (r) => r.action === "HOLD" || r.action === "WATCH",
    ).length;
    signals.push({
      id: "all-clear",
      category: "healthy",
      weight: 1,
      headline: "Nothing needs a decision today",
      what: `${healthy} of ${input.recommendations.length} SKUs are inside their planning tolerances, and no shipment or commitment is off track.`,
      why: "A quiet control tower means the plan and the physical position agree.",
      evidence: [`${input.recommendations.length} SKUs evaluated`],
      nextAction: "Use the time on the forward plan rather than the current position.",
      link: { to: "/demand-planning", label: "Open Demand Plan" },
    });
    counts.healthy += 1;
  }

  signals.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.id.localeCompare(b.id);
  });

  return { signals, counts, allClear: pressing === 0 };
}
