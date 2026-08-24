/**
 * Scenario core tests. Numbers are worked by hand so a regression in the
 * transformation or comparison logic is visible without re-deriving the maths
 * from the implementation.
 */
import { describe, expect, test } from "bun:test";
import { EMPTY_PLANNING_POLICY, type PlanningPolicy } from "../domain/planning-policy";
import type { LoadedSku, OpenSupplyLine } from "../data/repository";
import type { DemandFact } from "../demand/series";
import { describeAssumptions, hasAssumptions, scenarioAssumptionsSchema } from "./assumptions";
import { applyScenarioOpenSupply, applyScenarioPolicy, applyScenarioSignals } from "./apply";
import { compare } from "./compare";
import { executeScenario } from "./run";

const policy: PlanningPolicy = {
  ...EMPTY_PLANNING_POLICY,
  demandWindowMonths: 6,
  planningHorizonDays: 30,
  demandGrowthPct: 0,
};

function signal(partial: Partial<LoadedSku> & { sku: string }): LoadedSku {
  return {
    productId: `id-${partial.sku}`,
    name: partial.sku,
    category: "Cat",
    unitCost: 10,
    supplierName: "Supplier",
    supplierCode: "S1",
    leadTimeDays: 30,
    leadTimeSource: "product",
    minOrderQty: 10,
    safetyStockDays: 7,
    onHand: 100,
    onOrder: 0,
    locations: [{ location: "LOC-A", onHand: 100, onOrder: 0, asOf: "2026-08-01" }],
    expectedArrival: null,
    monthlySales: [],
    ...partial,
  };
}

/** Twelve months of steady demand: 100/month → avgDaily ≈ 3.286. */
function yearOfSales(sku: string, qty = 100) {
  return Array.from({ length: 12 }, (_, i) => ({
    periodMonth: `2025-${String(i + 1).padStart(2, "0")}-01`,
    quantity: qty,
  })).map((m) => ({ sku, ...m }));
}

function fact(partial: Partial<DemandFact> & { sku: string; date: string; quantity: number }): DemandFact {
  return {
    name: partial.sku,
    category: "Cat",
    supplierCode: "S1",
    supplierName: "Supplier",
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
    ...partial,
  };
}

describe("scenarioAssumptionsSchema", () => {
  test("accepts an empty set and rejects out-of-range values", () => {
    expect(scenarioAssumptionsSchema.safeParse({}).success).toBe(true);
    expect(scenarioAssumptionsSchema.safeParse({ demandGrowthPct: -101 }).success).toBe(false);
    expect(scenarioAssumptionsSchema.safeParse({ etaDelayDays: -1 }).success).toBe(false);
    expect(hasAssumptions({})).toBe(false);
    expect(hasAssumptions({ demandGrowthPct: 20 })).toBe(true);
  });
});

describe("applyScenarioPolicy", () => {
  test("overrides only the fields the scenario sets", () => {
    const next = applyScenarioPolicy(policy, { demandGrowthPct: 25, planningHorizonDays: 60 });
    expect(next.demandGrowthPct).toBe(25);
    expect(next.planningHorizonDays).toBe(60);
    expect(next.demandWindowMonths).toBe(6);
    expect(policy.demandGrowthPct).toBe(0); // live policy untouched
  });
});

describe("applyScenarioSignals", () => {
  const signals = [
    signal({ sku: "A", leadTimeDays: 30, minOrderQty: 10, unitCost: 10 }),
    signal({ sku: "B", supplierCode: "S2", leadTimeDays: null, leadTimeSource: "missing" }),
  ];

  test("lead-time delta applies to known lead times only, clamped at 1 day", () => {
    const out = applyScenarioSignals(signals, { leadTimeDeltaDays: -45 });
    expect(out[0]!.leadTimeDays).toBe(1);
    expect(out[1]!.leadTimeDays).toBeNull(); // never invented
    expect(signals[0]!.leadTimeDays).toBe(30); // input untouched
  });

  test("a per-supplier declaration may fill a missing lead time", () => {
    const out = applyScenarioSignals(signals, {
      supplierLeadTimes: [{ supplierCode: "S2", leadTimeDays: 21 }],
    });
    expect(out[1]!.leadTimeDays).toBe(21);
    expect(out[0]!.leadTimeDays).toBe(30);
  });

  test("MOQ and cost changes apply per rule", () => {
    const out = applyScenarioSignals(signals, {
      minOrderQtyChangePct: 50,
      supplierCostChanges: [{ supplierCode: "S1", changePct: 10 }],
    });
    expect(out[0]!.minOrderQty).toBe(15);
    expect(out[0]!.unitCost).toBe(11);
    expect(out[1]!.unitCost).toBe(10);
  });

  test("safety stock override applies to every SKU in scope", () => {
    const out = applyScenarioSignals(signals, { safetyStockDays: 14 });
    expect(out.every((s) => s.safetyStockDays === 14)).toBe(true);
  });
});

describe("applyScenarioOpenSupply", () => {
  test("shifts dated ETAs and leaves undated lines alone", () => {
    const line: OpenSupplyLine = {
      poId: "po1",
      productId: "id-A",
      sku: "A",
      productName: "A",
      supplierName: "Supplier",
      quantity: 50,
      receivedQuantity: 0,
      outstanding: 50,
      expectedAt: "2026-09-01",
      orderedAt: "2026-08-01",
      locationCode: null,
    };
    const undated = { ...line, poId: "po2", expectedAt: null };
    const out = applyScenarioOpenSupply([line, undated], { etaDelayDays: 15 });
    expect(out[0]!.expectedAt).toBe("2026-09-16");
    expect(out[1]!.expectedAt).toBeNull();
  });
});

describe("compare", () => {
  test("absolute change always; percentage only for non-zero baselines", () => {
    expect(compare(1000, 1500)).toEqual({ baseline: 1000, scenario: 1500, change: 500, changePct: 50 });
    expect(compare(0, 500).changePct).toBeNull();
    expect(compare(null, 5).change).toBeNull();
    expect(compare(5, null).change).toBeNull();
  });
});

describe("executeScenario", () => {
  // SKU A: 100 units/month, avgDaily ≈ 3.286. Lead 30d → reorder point ≈ 99+23=122.
  // On hand 100 → below reorder point → REORDER in both plans.
  const signals = [signal({ sku: "A", monthlySales: yearOfSales("A") })];
  const facts = yearOfSales("A").map((m) => fact({ sku: "A", date: m.periodMonth, quantity: m.quantity }));

  test("an empty assumption set reproduces the baseline exactly", () => {
    const result = executeScenario({
      facts,
      signals,
      openSupply: [],
      policy,
      filter: {},
      assumptions: {},
    });
    expect(result.summaryComparison.every((m) => m.comparison.change === 0)).toBe(true);
    expect(result.explanation).toHaveLength(0);
    expect(result.assumptionLines).toHaveLength(0);
  });

  test("a demand increase raises the suggested quantity and says why", () => {
    const result = executeScenario({
      facts,
      signals,
      openSupply: [],
      policy,
      filter: {},
      assumptions: { demandGrowthPct: 50 },
    });
    const spendMetric = result.summaryComparison.find((m) => m.label === "Suggested purchase quantity")!;
    expect(spendMetric.comparison.change).toBeGreaterThan(0);
    expect(result.assumptionLines[0]).toContain("Demand growth: 0% → +50%");
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(result.explanation[0]).toContain("A:");
  });

  test("a longer lead time increases the reorder point and net requirement", () => {
    const base = executeScenario({ facts, signals, openSupply: [], policy, filter: {}, assumptions: {} });
    const longer = executeScenario({
      facts,
      signals,
      openSupply: [],
      policy,
      filter: {},
      assumptions: { leadTimeDeltaDays: 30 },
    });
    const rowBase = base.rows.find((r) => r.sku === "A")!;
    const rowLong = longer.rows.find((r) => r.sku === "A")!;
    expect(rowLong.scenario.netRequirement!).toBeGreaterThan(rowBase.scenario.netRequirement!);
  });

  test("an ETA delay can move a stockout earlier than the first receipt", () => {
    // 90-day horizon → 3 projected months (2026-01..03). On hand 150 with
    // 100/month demand stockouts in period 2 unless the 2026-02-01 receipt
    // lands. Delaying that receipt by 60 days pushes it past the horizon.
    const horizonPolicy: PlanningPolicy = { ...policy, planningHorizonDays: 90 };
    const shortSignals = [signal({ sku: "A", onHand: 150, monthlySales: yearOfSales("A") })];
    const supply: OpenSupplyLine[] = [
      {
        poId: "po1",
        productId: "id-A",
        sku: "A",
        productName: "A",
        supplierName: "Supplier",
        quantity: 500,
        receivedQuantity: 0,
        outstanding: 500,
        expectedAt: "2026-02-01",
        orderedAt: "2025-12-01",
        locationCode: null,
      },
    ];
    const base = executeScenario({
      facts, signals: shortSignals, openSupply: supply, policy: horizonPolicy, filter: {}, assumptions: {},
    });
    const delayed = executeScenario({
      facts, signals: shortSignals, openSupply: supply, policy: horizonPolicy, filter: {},
      assumptions: { etaDelayDays: 60 },
    });
    const rowBase = base.rows.find((r) => r.sku === "A")!;
    const row = delayed.rows.find((r) => r.sku === "A")!;
    expect(rowBase.scenario.riskFlags).not.toContain("stockout_before_receipt");
    expect(row.scenario.riskFlags).toContain("stockout_before_receipt");
    expect(row.gainedRisks).toContain("stockout_before_receipt");
  });

  test("scope filter limits the run to the selected SKUs", () => {
    const twoSignals = [...signals, signal({ sku: "B", monthlySales: yearOfSales("B", 50) })];
    const twoFacts = [...facts, ...yearOfSales("B", 50).map((m) => fact({ sku: "B", date: m.periodMonth, quantity: m.quantity }))];
    const result = executeScenario({
      facts: twoFacts,
      signals: twoSignals,
      openSupply: [],
      policy,
      filter: { skus: ["A"] },
      assumptions: { demandGrowthPct: 100 },
    });
    expect(result.baselineSummary.skuCount).toBe(1);
    expect(result.rows.map((r) => r.sku)).toEqual(["A"]);
  });
});

describe("describeAssumptions", () => {
  test("renders every set assumption against the live value", () => {
    const lines = describeAssumptions(
      { demandGrowthPct: 15, etaDelayDays: 10, supplierLeadTimes: [{ supplierCode: "S1", leadTimeDays: 45 }] },
      policy,
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Demand growth: 0% → +15%");
    expect(lines[1]).toBe("Lead time for supplier S1: set to 45 days");
    expect(lines[2]).toBe("Inbound deliveries: every scheduled ETA moves 10 day(s) later");
  });
});
