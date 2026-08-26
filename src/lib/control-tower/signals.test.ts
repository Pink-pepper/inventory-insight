import { describe, expect, test } from "bun:test";
import {
  buildControlTower,
  shipmentSlip,
  type ControlTowerInput,
  type TowerRecommendation,
} from "./signals";

const rec = (over: Partial<TowerRecommendation> = {}): TowerRecommendation => ({
  sku: "SKU-1",
  name: "Hex Bolt M12",
  action: "HOLD",
  recommendedQty: 0,
  estimatedCost: 0,
  daysOfCover: 90,
  avgMonthlyDemand: 100,
  excessValue: 0,
  stockoutRisk: false,
  blocked: false,
  leadTimeDays: 30,
  onHand: 300,
  ...over,
});

const input = (over: Partial<ControlTowerInput> = {}): ControlTowerInput => ({
  today: "2026-08-26",
  recommendations: [],
  shipments: [],
  quotations: [],
  marketSignals: [],
  demandRows: [],
  projects: [],
  ...over,
});

describe("control tower", () => {
  test("a stockout risk is urgent and points at the SKU", () => {
    const { signals } = buildControlTower(
      input({ recommendations: [rec({ stockoutRisk: true, daysOfCover: 5 })] }),
    );
    const row = signals.find((s) => s.id === "stockout:SKU-1");
    expect(row?.category).toBe("urgent");
    expect(row?.link?.to).toBe("/sku/$sku");
    expect(row?.evidence.length).toBeGreaterThan(0);
  });

  test("urgent rows sort above attention and opportunity rows", () => {
    const { signals } = buildControlTower(
      input({
        recommendations: [
          rec({ sku: "A", action: "EXCESS", excessValue: 50_000 }),
          rec({ sku: "B", action: "REORDER", daysOfCover: 20 }),
          rec({ sku: "C", stockoutRisk: true, daysOfCover: 2 }),
        ],
      }),
    );
    expect(signals.map((s) => s.category).slice(0, 3)).toEqual([
      "urgent",
      "attention",
      "opportunity",
    ]);
  });

  test("a slipped shipment reports the delay it actually has", () => {
    expect(
      shipmentSlip({
        id: "s",
        reference: "SH-1",
        status: "in_transit",
        supplierName: null,
        eta: "2026-09-01",
        revisedEta: "2026-09-15",
        arrivedOn: null,
      }),
    ).toBe(14);

    const { signals } = buildControlTower(
      input({
        shipments: [
          {
            id: "s1",
            reference: "SH-1",
            status: "in_transit",
            supplierName: "Nord Chemicals",
            eta: "2026-09-01",
            revisedEta: "2026-09-15",
            arrivedOn: null,
          },
        ],
      }),
    );
    const row = signals.find((s) => s.id === "shipment-slip:s1");
    expect(row?.category).toBe("urgent");
    expect(row?.headline).toContain("14 days late");
  });

  test("a shipment past its date with no arrival is urgent", () => {
    const { signals } = buildControlTower(
      input({
        shipments: [
          {
            id: "s2",
            reference: "SH-2",
            status: "booked",
            supplierName: null,
            eta: "2026-08-01",
            revisedEta: null,
            arrivedOn: null,
          },
        ],
      }),
    );
    expect(signals.find((s) => s.id === "shipment-overdue:s2")?.category).toBe("urgent");
  });

  test("committed demand without a stock position is surfaced once", () => {
    const { signals } = buildControlTower(
      input({
        recommendations: [rec({ sku: "SKU-1" })],
        demandRows: [
          { sku: "SKU-9", productName: "Unknown", period: "2026-09-01", committedQty: 400, resolvedQty: 400 },
          { sku: "SKU-1", productName: "Hex Bolt M12", period: "2026-09-01", committedQty: 10, resolvedQty: 10 },
        ],
      }),
    );
    const rows = signals.filter((s) => s.id === "unmatched-committed");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evidence[0]).toContain("SKU-9");
  });

  test("an expiring quotation is an opportunity, an expired one needs attention", () => {
    const base = {
      customerName: "Acme",
      productName: "Hex Bolt",
      quantity: 100,
      unitPrice: 12,
      status: "open",
      issuedOn: "2026-08-20",
    };
    const { signals } = buildControlTower(
      input({
        quotations: [
          { id: "q1", reference: "Q-1", validUntil: "2026-08-30", ...base },
          { id: "q2", reference: "Q-2", validUntil: "2026-08-10", ...base },
        ],
      }),
    );
    expect(signals.find((s) => s.id === "quote-expiry:q1")?.category).toBe("opportunity");
    expect(signals.find((s) => s.id === "quote-expiry:q2")?.category).toBe("attention");
  });

  test("nothing pressing yields an explicit all-clear row", () => {
    const { signals, allClear, counts } = buildControlTower(
      input({ recommendations: [rec(), rec({ sku: "SKU-2" })] }),
    );
    expect(allClear).toBe(true);
    expect(counts.healthy).toBe(1);
    expect(signals.at(-1)?.id).toBe("all-clear");
  });

  test("no data means no invented signals", () => {
    const { signals } = buildControlTower(input());
    expect(signals).toHaveLength(0);
  });
});
