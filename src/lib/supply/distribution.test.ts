/**
 * Distribution planning tests. The numbers are worked by hand in each test so
 * a regression in the allocation logic is visible without re-deriving the
 * maths from the implementation.
 */
import { describe, expect, test } from "bun:test";
import { EMPTY_PLANNING_POLICY } from "../domain/planning-policy";
import type { DemandFact } from "../demand/series";
import { buildDistributionPlan } from "../distribution/plan";
import type { SupplyPlanRow } from "./plan";

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
    source: "transactions",
    ...partial,
  };
}

function supplyRow(partial: Partial<SupplyPlanRow> & { sku: string }): SupplyPlanRow {
  return {
    name: partial.sku,
    category: "Cat",
    supplierName: "Supplier",
    supplierCode: "S1",
    leadTimeDays: 14,
    leadTimeSource: "product",
    minOrderQty: 1,
    unitCost: 10,
    onHand: 0,
    locations: [],
    avgDailyDemand: 0,
    safetyStockDays: 7,
    onOrder: 0,
    scheduledInbound: 0,
    unscheduledOnOrder: 0,
    earliestEta: null,
    plannedPerPeriod: null,
    horizonPeriods: 1,
    projection: null,
    lowPoint: null,
    firstStockout: null,
    firstBelowSafety: null,
    safetyStock: 0,
    reorderPoint: 0,
    targetStock: 0,
    engineAction: "REORDER",
    blocked: false,
    netRequirement: 100,
    suggestedQty: 100,
    requiredByPeriod: null,
    orderByDate: null,
    riskFlags: [],
    excessLocations: [],
    explanation: { inputs: [], method: [], output: "", limitations: [] },
    ...partial,
  };
}

// Window: 6 months back from the latest fact (2026-08-01) ≈ 183 days.
// LOC-B: 915 units over the window → 5/day. Cover floor = 5 × (14 + 7) = 105.
// LOC-A: 92 units over the window → ≈0.5/day. Keeps = ceil(0.5 × (14+7+30)) = 26.
const FACTS: DemandFact[] = [
  fact({ sku: "SKU-1", date: "2026-07-15", quantity: 915, locationCode: "LOC-B" }),
  fact({ sku: "SKU-1", date: "2026-07-15", quantity: 92, locationCode: "LOC-A" }),
  fact({ sku: "SKU-1", date: "2026-08-01", quantity: 1, locationCode: "LOC-B" }),
];

describe("buildDistributionPlan", () => {
  test("moves excess to a short location, capped by the purchase requirement", () => {
    const plan = buildDistributionPlan({
      supplyRows: [
        supplyRow({
          sku: "SKU-1",
          locations: [
            { location: "LOC-A", onHand: 500, onOrder: 0, asOf: "2026-08-01" },
            { location: "LOC-B", onHand: 0, onOrder: 0, asOf: "2026-08-01" },
          ],
        }),
      ],
      facts: FACTS,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    expect(plan.suggestions.length).toBe(1);
    const s = plan.suggestions[0]!;
    // dest need = 105 − 0 = 105; requirement = 100 → transfer exactly 100.
    expect(s.legs).toEqual([{ fromLocation: "LOC-A", toLocation: "LOC-B", quantity: 100 }]);
    expect(s.remainingNetRequirement).toBe(0);
    const a = s.balances.find((b) => b.location === "LOC-A")!;
    expect(a.excess).toBe(500 - 26);
  });

  test("a location with no demand history is transferable, never a destination", () => {
    const plan = buildDistributionPlan({
      supplyRows: [
        supplyRow({
          sku: "SKU-1",
          netRequirement: 105,
          locations: [
            { location: "LOC-A", onHand: 100, onOrder: 0, asOf: "2026-08-01" },
            { location: "LOC-B", onHand: 0, onOrder: 0, asOf: "2026-08-01" },
            { location: "LOC-C", onHand: 300, onOrder: 0, asOf: "2026-08-01" },
          ],
        }),
      ],
      facts: FACTS, // LOC-C has no facts
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    const s = plan.suggestions[0]!;
    // Sources are drained largest-excess first: LOC-C (300, no history) before
    // LOC-A (100 − 26 keeps = 74). LOC-B need = 105 → one leg covers it.
    expect(s.legs.every((l) => l.toLocation === "LOC-B")).toBe(true);
    expect(s.legs).toEqual([{ fromLocation: "LOC-C", toLocation: "LOC-B", quantity: 105 }]);
    expect(s.totalQuantity).toBe(105);
    expect(s.notes.some((n) => n.includes("LOC-C"))).toBe(true);
  });

  test("no purchase requirement means no suggestion", () => {
    const plan = buildDistributionPlan({
      supplyRows: [
        supplyRow({
          sku: "SKU-1",
          netRequirement: 0,
          locations: [
            { location: "LOC-A", onHand: 500, onOrder: 0, asOf: "2026-08-01" },
            { location: "LOC-B", onHand: 0, onOrder: 0, asOf: "2026-08-01" },
          ],
        }),
      ],
      facts: FACTS,
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    expect(plan.suggestions.length).toBe(0);
  });

  test("reports when no location-level demand exists at all", () => {
    const plan = buildDistributionPlan({
      supplyRows: [supplyRow({ sku: "SKU-1" })],
      facts: [fact({ sku: "SKU-1", date: "2026-07-01", quantity: 10 })],
      openSupply: [],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    expect(plan.summary.noLocationDemand).toBe(true);
    expect(plan.suggestions.length).toBe(0);
  });

  test("inbound POs addressed to a location reduce its shortfall", () => {
    const plan = buildDistributionPlan({
      supplyRows: [
        supplyRow({
          sku: "SKU-1",
          locations: [
            { location: "LOC-A", onHand: 500, onOrder: 0, asOf: "2026-08-01" },
            { location: "LOC-B", onHand: 0, onOrder: 0, asOf: "2026-08-01" },
          ],
        }),
      ],
      facts: FACTS,
      openSupply: [
        {
          poId: "po1",
          productId: "SKU-1",
          sku: "SKU-1",
          productName: "SKU-1",
          supplierName: "Supplier",
          quantity: 200,
          receivedQuantity: 0,
          outstanding: 200,
          expectedAt: "2026-09-01",
          orderedAt: null,
          locationCode: "LOC-B",
        },
      ],
      policy: EMPTY_PLANNING_POLICY,
      filter: {},
    });
    // LOC-B need 105 is fully covered by the 200 inbound → no destination.
    expect(plan.suggestions.length).toBe(0);
  });
});
