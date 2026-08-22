/**
 * Fixture tests for the supply planning modules.
 *
 * Every expected number is worked out by hand in the test name/comments so a
 * regression in the arithmetic is visible without re-deriving the maths.
 */
import { describe, expect, test } from "bun:test";
import { EMPTY_PLANNING_POLICY } from "../domain/planning-policy";
import type { DemandFact } from "../demand/series";
import type { OpenSupplyLine, RecommendationRow } from "../data/repository";
import { computeNetRequirement } from "./netting";
import { buildSupplyPlan } from "./plan";
import { futureMonthStarts, projectPosition } from "./projection";

const PERIODS = ["2025-01-01", "2025-02-01", "2025-03-01"];

describe("futureMonthStarts", () => {
  test("returns consecutive month starts beginning at the argument's month", () => {
    expect(futureMonthStarts("2025-01-15", 3)).toEqual(PERIODS);
  });

  test("crosses year boundaries", () => {
    expect(futureMonthStarts("2024-12-01", 2)).toEqual(["2024-12-01", "2025-01-01"]);
  });
});

describe("projectPosition", () => {
  test("subtracts planned demand per period; flags reorder/safety/stockout crossings", () => {
    // 100 on hand, 50/month: 50 → 0 → -50.
    const result = projectPosition({
      onHand: 100,
      plannedPerPeriod: 50,
      periods: PERIODS,
      receipts: [],
      safetyStock: 10,
      reorderPoint: 60,
    });
    expect(result.points.map((p) => p.projectedOnHand)).toEqual([50, 0, -50]);
    expect(result.lowPoint).toBe(-50);
    expect(result.firstBelowReorder).toBe("2025-01-01"); // 50 < 60
    expect(result.firstBelowSafety).toBe("2025-02-01"); // 0 < 10
    expect(result.firstStockout).toBe("2025-03-01");
    expect(result.firstReceiptPeriod).toBeNull();
  });

  test("phases receipts into their ETA month", () => {
    // 100 on hand, 50/month, 80 landing in Feb: 50 → 80 → 30.
    const result = projectPosition({
      onHand: 100,
      plannedPerPeriod: 50,
      periods: PERIODS,
      receipts: [{ expectedAt: "2025-02-10", quantity: 80 }],
      safetyStock: 10,
      reorderPoint: 60,
    });
    expect(result.points.map((p) => p.projectedOnHand)).toEqual([50, 80, 30]);
    expect(result.firstReceiptPeriod).toBe("2025-02-01");
  });

  test("assumes past-due receipts land in the first projected period", () => {
    // Receipt dated before the horizon start: 100 - 50 + 80 = 130 in Jan.
    const result = projectPosition({
      onHand: 100,
      plannedPerPeriod: 50,
      periods: PERIODS,
      receipts: [{ expectedAt: "2024-12-20", quantity: 80 }],
      safetyStock: 10,
      reorderPoint: 60,
    });
    expect(result.points[0]!.projectedOnHand).toBe(130);
    expect(result.firstReceiptPeriod).toBe("2025-01-01");
  });
});

describe("computeNetRequirement", () => {
  test("nets the shortfall against target stock", () => {
    // target 200, lowPoint -50 → 250 needed; moq 1, multiple 1 → 250.
    const result = computeNetRequirement({
      targetStock: 200,
      lowPoint: -50,
      triggerPeriod: "2025-03-01",
      leadTimeDays: 14,
      minOrderQty: 1,
      orderMultiple: 1,
    });
    expect(result.netRequirement).toBe(250);
    expect(result.suggestedQty).toBe(250);
    expect(result.moqApplied).toBe(false);
    // 1 Mar minus 14 days = 15 Feb.
    expect(result.orderByDate).toBe("2025-02-15");
  });

  test("rounds up to the minimum order quantity and flags it", () => {
    const result = computeNetRequirement({
      targetStock: 200,
      lowPoint: 170,
      triggerPeriod: "2025-03-01",
      leadTimeDays: 14,
      minOrderQty: 100,
      orderMultiple: 1,
    });
    expect(result.netRequirement).toBe(30);
    expect(result.suggestedQty).toBe(100);
    expect(result.moqApplied).toBe(true);
  });

  test("produces no order-by date when the lead time is unknown", () => {
    const result = computeNetRequirement({
      targetStock: 200,
      lowPoint: 0,
      triggerPeriod: "2025-03-01",
      leadTimeDays: null,
      minOrderQty: 1,
      orderMultiple: 1,
    });
    expect(result.netRequirement).toBe(200);
    expect(result.orderByDate).toBeNull();
  });

  test("returns zero when the projected position stays at or above target", () => {
    const result = computeNetRequirement({
      targetStock: 200,
      lowPoint: 250,
      triggerPeriod: null,
      leadTimeDays: 14,
      minOrderQty: 1,
      orderMultiple: 1,
    });
    expect(result.netRequirement).toBe(0);
    expect(result.suggestedQty).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* buildSupplyPlan fixtures                                             */
/* ------------------------------------------------------------------ */

function fact(sku: string, months: string[], qty: number): DemandFact[] {
  return months.map((m) => ({
    sku,
    name: sku,
    category: "Cat",
    supplierCode: "SUP",
    supplierName: "Supplier",
    date: `${m}-01`,
    quantity: qty,
    revenue: null,
    cogs: null,
    channelCode: null,
    channelName: null,
    customerRef: null,
    customerName: null,
    locationCode: null,
    locationName: null,
    region: null,
    stateProvince: null,
    country: null,
    source: "monthly",
  }));
}

function engineRow(partial: Partial<RecommendationRow> & { sku: string }): RecommendationRow {
  return {
    name: partial.sku,
    category: "Cat",
    unitCost: 10,
    supplierName: "Supplier",
    supplierCode: "SUP",
    leadTimeDays: 14,
    leadTimeSource: "product",
    minOrderQty: 1,
    safetyStockDays: 14,
    onHand: 0,
    onOrder: 0,
    locations: [],
    expectedArrival: null,
    monthlySales: [],
    avgMonthlyDemand: 0,
    avgDailyDemand: 0,
    demandTrendPct: 0,
    daysOfCover: 9999,
    safetyStock: 0,
    reorderPoint: 0,
    netAvailable: 0,
    targetStock: 0,
    excessUnits: 0,
    inventoryValue: 0,
    excessValue: 0,
    action: "HOLD",
    recommendedQty: 0,
    estimatedCost: 0,
    reason: "",
    stockoutRisk: false,
    dataQuality: [],
    blocked: false,
    explanation: { headline: "", why: "", demand: [], inventory: [], policy: [], spend: null },
    productId: partial.sku,
    ...partial,
  } as RecommendationRow;
}

function supplyLine(partial: Partial<OpenSupplyLine> & { sku: string }): OpenSupplyLine {
  return {
    poId: partial.sku,
    productId: partial.sku,
    productName: partial.sku,
    supplierName: "Supplier",
    quantity: 0,
    receivedQuantity: 0,
    outstanding: 0,
    expectedAt: null,
    orderedAt: null,
    ...partial,
  };
}

// Six months of 100 units/month for every fixture SKU → planned demand 100.
const HISTORY = ["2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12"];

describe("buildSupplyPlan", () => {
  test("nets a shortfall with timing; scheduled receipts can erase it", () => {
    const rows = [
      // SKU-A: 500 on hand, target 300 → 400 after one period ≥ target → no buy.
      engineRow({ sku: "SKU-A", onHand: 500, targetStock: 300, reorderPoint: 100 }),
      // SKU-B: 50 on hand, target 300 → -50 after one period → buy 350.
      engineRow({ sku: "SKU-B", onHand: 50, targetStock: 300, reorderPoint: 100 }),
      // SKU-C: same as B but a 500-unit PO lands in the horizon → no buy.
      engineRow({ sku: "SKU-C", onHand: 50, targetStock: 300, reorderPoint: 100 }),
    ];
    const facts = rows.flatMap((r) => fact(r.sku, HISTORY, 100));
    const openSupply = [
      supplyLine({ sku: "SKU-C", quantity: 500, outstanding: 500, expectedAt: "2025-01-10" }),
    ];

    const plan = buildSupplyPlan({
      facts,
      engineRows: rows,
      openSupply,
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const bySku = new Map(plan.rows.map((r) => [r.sku, r]));

    const a = bySku.get("SKU-A")!;
    expect(a.suggestedQty).toBe(0);
    expect(a.lowPoint).toBe(400);

    const b = bySku.get("SKU-B")!;
    expect(b.netRequirement).toBe(350); // target 300 − lowPoint −50
    expect(b.suggestedQty).toBe(350);
    expect(b.firstStockout).toBe("2025-01-01");
    expect(b.requiredByPeriod).toBe("2025-01-01");
    expect(b.orderByDate).toBe("2024-12-18"); // 1 Jan minus 14 days
    expect(b.riskFlags).toContain("stockout_before_receipt");

    const c = bySku.get("SKU-C")!;
    expect(c.scheduledInbound).toBe(500);
    expect(c.earliestEta).toBe("2025-01-10");
    expect(c.netRequirement).toBe(0); // 50 − 100 + 500 = 450 ≥ target
    expect(c.riskFlags).not.toContain("stockout_before_receipt");

    // Action rows sort first.
    expect(plan.rows[0]!.sku).toBe("SKU-B");
    expect(plan.summary.requiringAction).toBe(1);
    expect(plan.summary.suggestedSpend).toBe(3500); // 350 × 10
    expect(plan.summary.noOpenPos).toBe(false);
  });

  test("missing lead time blocks the order-by date, never the quantity", () => {
    const rows = [
      engineRow({
        sku: "SKU-D",
        onHand: 50,
        targetStock: 300,
        reorderPoint: 100,
        leadTimeDays: null,
        leadTimeSource: "missing",
      }),
    ];
    const plan = buildSupplyPlan({
      facts: fact("SKU-D", HISTORY, 100),
      engineRows: rows,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const d = plan.rows[0]!;
    expect(d.suggestedQty).toBe(350);
    expect(d.orderByDate).toBeNull();
    expect(d.riskFlags).toContain("lead_time_missing");
    expect(plan.summary.noOpenPos).toBe(true);
  });

  test("EXCESS suppresses procurement while the projection stays sufficient", () => {
    const rows = [
      engineRow({ sku: "SKU-E", onHand: 5000, targetStock: 300, reorderPoint: 100, action: "EXCESS" }),
    ];
    const plan = buildSupplyPlan({
      facts: fact("SKU-E", HISTORY, 100),
      engineRows: rows,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const e = plan.rows[0]!;
    expect(e.netRequirement).toBe(0);
    expect(e.riskFlags).toContain("excess_suppressed");
  });

  test("undated PO lines are reported as unscheduled, never phased", () => {
    const rows = [
      engineRow({ sku: "SKU-F", onHand: 500, onOrder: 200, targetStock: 300, reorderPoint: 100 }),
    ];
    const plan = buildSupplyPlan({
      facts: fact("SKU-F", HISTORY, 100),
      engineRows: rows,
      openSupply: [supplyLine({ sku: "SKU-F", quantity: 150, outstanding: 150, expectedAt: null })],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const f = plan.rows[0]!;
    // 200 on-order assumed to include the 150 PO → 50 remainder + 150 undated.
    expect(f.unscheduledOnOrder).toBe(200);
    expect(f.scheduledInbound).toBe(0);
    expect(f.riskFlags).toContain("eta_unknown");
  });

  test("insufficient history yields no baseline and no netting", () => {
    const rows = [
      engineRow({ sku: "SKU-G", onHand: 10, targetStock: 300, reorderPoint: 100 }),
    ];
    const plan = buildSupplyPlan({
      facts: fact("SKU-G", ["2024-12"], 100), // one period only
      engineRows: rows,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const g = plan.rows[0]!;
    expect(g.plannedPerPeriod).toBeNull();
    expect(g.netRequirement).toBeNull();
    expect(g.riskFlags).toContain("no_demand_baseline");
  });

  test("blocked engine rows are never netted", () => {
    const rows = [
      engineRow({ sku: "SKU-H", onHand: 10, targetStock: 300, reorderPoint: 100, blocked: true }),
    ];
    const plan = buildSupplyPlan({
      facts: fact("SKU-H", HISTORY, 100),
      engineRows: rows,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const h = plan.rows[0]!;
    expect(h.netRequirement).toBeNull();
    expect(h.suggestedQty).toBeNull();
    expect(plan.summary.blocked).toBe(1);
  });
});
