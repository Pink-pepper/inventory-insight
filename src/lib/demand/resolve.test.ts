import { describe, expect, it } from "vitest";
import { resolveDemandBook, type HistoryBaselinePoint } from "./resolve";
import type { DemandSignalRecord } from "@/lib/domain/commercial";

const base: Omit<DemandSignalRecord, "id" | "source" | "certainty" | "quantity"> = {
  customerId: "cust-1",
  customerName: "Acme Trading",
  productId: "prod-1",
  sku: "SKU-1",
  productName: "Hex Bolt M12",
  unit: "EA",
  expectedPeriod: "2026-09-01",
  channel: "stock",
  probability: null,
  status: "open",
  unitPrice: null,
  currencyCode: null,
  notes: null,
  sourceRecordType: null,
  sourceRecordId: null,
  supersedesId: null,
};

const sig = (over: Partial<DemandSignalRecord> & Pick<DemandSignalRecord, "id">) =>
  ({ ...base, source: "opportunity", certainty: "expected", quantity: 0, ...over }) as DemandSignalRecord;

const history: HistoryBaselinePoint[] = [
  { productId: "prod-1", sku: "SKU-1", period: "2026-09-01", quantity: 100 },
];

describe("demand book resolution", () => {
  it("does not sum an opportunity, its quotation and its LPO", () => {
    const rows = resolveDemandBook({
      history: [],
      signals: [
        sig({ id: "o1", source: "opportunity", certainty: "active", quantity: 50, probability: 0.5 }),
        sig({ id: "q1", source: "quotation", certainty: "high_confidence", quantity: 50, supersedesId: "o1" }),
        sig({ id: "l1", source: "lpo", certainty: "committed", quantity: 50, supersedesId: "q1" }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resolvedQty).toBe(50);
    expect(rows[0]!.committedQty).toBe(50);
    expect(rows[0]!.superseded).toHaveLength(2);
  });

  it("groups duplicate evidence for the same customer, product and period", () => {
    const rows = resolveDemandBook({
      history: [],
      signals: [
        sig({ id: "r1", source: "requirement", certainty: "expected", quantity: 30 }),
        sig({ id: "q1", source: "quotation", certainty: "high_confidence", quantity: 40 }),
      ],
    });
    expect(rows[0]!.resolvedQty).toBe(40);
    expect(rows[0]!.superseded[0]!.signalId).toBe("r1");
  });

  it("lets commitments consume the historical baseline rather than stack on it", () => {
    const rows = resolveDemandBook({
      history,
      signals: [sig({ id: "l1", source: "lpo", certainty: "committed", quantity: 60 })],
    });
    expect(rows[0]!.committedQty).toBe(60);
    expect(rows[0]!.baselineQty).toBe(40);
    expect(rows[0]!.resolvedQty).toBe(100);
  });

  it("never lets the baseline go negative when commitments exceed history", () => {
    const rows = resolveDemandBook({
      history,
      signals: [sig({ id: "l1", source: "lpo", certainty: "committed", quantity: 180 })],
    });
    expect(rows[0]!.baselineQty).toBe(0);
    expect(rows[0]!.resolvedQty).toBe(180);
  });

  it("counts uncertain opportunities as incremental upside at their stated confidence", () => {
    const rows = resolveDemandBook({
      history,
      signals: [
        sig({ id: "o1", customerId: "cust-2", customerName: "Borealis", source: "opportunity", certainty: "active", quantity: 40, probability: 0.25 }),
      ],
    });
    expect(rows[0]!.potentialQty).toBe(10);
    expect(rows[0]!.resolvedQty).toBe(110);
  });

  it("ignores lost records and market signals as quantities but keeps history", () => {
    const rows = resolveDemandBook({
      history,
      signals: [
        sig({ id: "o1", source: "opportunity", certainty: "expected", quantity: 500, status: "lost" }),
        sig({ id: "m1", customerId: "cust-3", source: "market", certainty: "speculative", quantity: 900 }),
      ],
    });
    expect(rows[0]!.resolvedQty).toBe(100);
  });

  it("is deterministic regardless of input order", () => {
    const signals = [
      sig({ id: "a", source: "opportunity", certainty: "active", quantity: 10 }),
      sig({ id: "b", source: "lpo", certainty: "committed", quantity: 20 }),
    ];
    const one = resolveDemandBook({ history: [], signals });
    const two = resolveDemandBook({ history: [], signals: [...signals].reverse() });
    expect(one[0]!.resolvedQty).toBe(two[0]!.resolvedQty);
  });
});
