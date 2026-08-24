import { describe, expect, test } from "bun:test";
import { computeLandedCost, selectComponents } from "./landed-cost";
import { phaseLineByShipments, type ShipmentAllocation } from "@/lib/supply/shipment-phasing";
import { effectiveEta, shipmentDelayDays } from "@/lib/domain/supply-chain";

describe("landed cost", () => {
  test("falls back to the recorded unit cost when no supplier price exists", () => {
    const r = computeLandedCost({ quantity: 10, fallbackUnitCost: 5 });
    expect(r.landedUnitCost).toBe(5);
    expect(r.usedFallbackCost).toBe(true);
    expect(r.hasComponents).toBe(false);
    expect(r.landedTotal).toBe(50);
  });

  test("builds up supplier price, FX and each cost basis in order", () => {
    const r = computeLandedCost({
      quantity: 100,
      supplierPrice: 10,
      fxRate: 1.2, // goods = 12/unit
      components: [
        { kind: "freight", amount: 300, basis: "per_shipment" }, // 3/unit
        { kind: "duty", amount: 5, basis: "percent_of_value" }, // 0.6/unit
        { kind: "clearance", amount: 0.4, basis: "per_unit" },
      ],
      sellingPrice: 20,
    });
    expect(r.goodsPerUnit).toBeCloseTo(12, 10);
    expect(r.freightPerUnit).toBeCloseTo(3, 10);
    expect(r.dutyPerUnit).toBeCloseTo(0.6, 10);
    expect(r.clearancePerUnit).toBeCloseTo(0.4, 10);
    expect(r.landedUnitCost).toBeCloseTo(16, 10);
    expect(r.grossProfitPerUnit).toBeCloseTo(4, 10);
    expect(r.marginPct).toBeCloseTo(0.2, 10);
    // The build-up is ordered and each step carries the running total.
    expect(r.steps.map((s) => s.key)).toEqual(["goods", "fx", "freight", "duty", "clearance"]);
    expect(r.steps.at(-1)!.runningTotal).toBeCloseTo(r.landedUnitCost, 10);
  });

  test("never divides a per-shipment cost by zero units", () => {
    const r = computeLandedCost({
      quantity: 0,
      supplierPrice: 4,
      components: [{ kind: "freight", amount: 500, basis: "per_shipment" }],
    });
    expect(Number.isFinite(r.landedUnitCost)).toBe(true);
    expect(r.landedUnitCost).toBe(4);
  });

  test("reports no margin rather than inventing a selling price", () => {
    const r = computeLandedCost({ quantity: 5, supplierPrice: 3 });
    expect(r.sellingPrice).toBeNull();
    expect(r.grossProfitPerUnit).toBeNull();
    expect(r.marginPct).toBeNull();
  });

  test("prefers the most specific component scope", () => {
    const all = [
      { id: "ship", productId: null, supplierId: null, shipmentId: "S1" },
      { id: "prod", productId: "P1", supplierId: null, shipmentId: null },
      { id: "supp", productId: null, supplierId: "V1", shipmentId: null },
      { id: "default", productId: null, supplierId: null, shipmentId: null },
      { id: "other", productId: "P2", supplierId: null, shipmentId: null },
    ];
    const picked = selectComponents(all, { productId: "P1", supplierId: "V1", shipmentId: "S1" });
    expect(picked.map((c) => c.id).sort()).toEqual(["default", "prod", "ship", "supp"]);
    const noShipment = selectComponents(all, { productId: "P1", supplierId: null, shipmentId: null });
    expect(noShipment.map((c) => c.id).sort()).toEqual(["default", "prod"]);
  });
});

const alloc = (p: Partial<ShipmentAllocation> & { shipmentId: string }): ShipmentAllocation => ({
  poId: "PO1",
  shipmentReference: p.shipmentId,
  status: "in_transit",
  quantity: 0,
  eta: null,
  revisedEta: null,
  arrivedOn: null,
  ...p,
});

describe("shipment phasing", () => {
  const line = { poId: "PO1", outstanding: 100, expectedAt: "2026-06-01" };

  test("keeps the PO date when no shipments are recorded", () => {
    const segments = phaseLineByShipments(line, []);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.quantity).toBe(100);
    expect(segments[0]!.expectedAt).toBe("2026-06-01");
  });

  test("splits one order across several shipments, earliest first", () => {
    const segments = phaseLineByShipments(line, [
      alloc({ shipmentId: "B", quantity: 40, eta: "2026-05-01" }),
      alloc({ shipmentId: "A", quantity: 30, eta: "2026-04-01" }),
    ]);
    expect(segments.map((s) => [s.shipmentId, s.quantity, s.expectedAt])).toEqual([
      ["A", 30, "2026-04-01"],
      ["B", 40, "2026-05-01"],
      [null, 30, "2026-06-01"],
    ]);
    expect(segments.reduce((t, s) => t + s.quantity, 0)).toBe(100);
  });

  test("clips allocations that exceed the outstanding quantity", () => {
    const segments = phaseLineByShipments(line, [
      alloc({ shipmentId: "A", quantity: 400, eta: "2026-04-01" }),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.quantity).toBe(100);
  });

  test("ignores cancelled shipments", () => {
    const segments = phaseLineByShipments(line, [
      alloc({ shipmentId: "X", quantity: 50, eta: "2026-04-01", status: "cancelled" }),
    ]);
    expect(segments.map((s) => s.shipmentId)).toEqual([null]);
  });

  test("uses actual arrival, then revised ETA, then the original", () => {
    expect(effectiveEta({ eta: "2026-01-01", revisedEta: "2026-02-01", arrivedOn: "2026-03-01" })).toBe(
      "2026-03-01",
    );
    expect(effectiveEta({ eta: "2026-01-01", revisedEta: "2026-02-01", arrivedOn: null })).toBe(
      "2026-02-01",
    );
    expect(shipmentDelayDays({ eta: "2026-01-01", revisedEta: "2026-01-11", arrivedOn: null })).toBe(10);
    expect(shipmentDelayDays({ eta: null, revisedEta: "2026-01-11", arrivedOn: null })).toBeNull();
  });
});
