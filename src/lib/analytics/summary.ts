import type { RecommendationRow } from "@/lib/data/repository";

export interface OverviewSummary {
  totalSkus: number;
  reorderCount: number;
  stockoutRiskCount: number;
  excessCount: number;
  healthyCount: number;
  watchCount: number;
  inventoryValue: number;
  excessValue: number;
  purchaseRequirement: number;
  valueByCategory: { category: string; value: number; excess: number }[];
  coverDistribution: { bucket: string; count: number }[];
  statusMix: { status: string; count: number }[];
  demandTrend: { month: string; units: number }[];
  topActions: {
    sku: string;
    name: string;
    action: string;
    recommendedQty: number;
    estimatedCost: number;
    daysOfCover: number;
  }[];
}

const COVER_BUCKETS = [
  { bucket: "0–14 d", max: 14 },
  { bucket: "15–30 d", max: 30 },
  { bucket: "31–60 d", max: 60 },
  { bucket: "61–120 d", max: 120 },
  { bucket: "120 d+", max: Infinity },
];

export function summarise(rows: RecommendationRow[]): OverviewSummary {
  const byCategory = new Map<string, { value: number; excess: number }>();
  const cover = new Map<string, number>(COVER_BUCKETS.map((b) => [b.bucket, 0]));
  const demand = new Map<string, number>();

  let inventoryValue = 0;
  let excessValue = 0;
  let purchaseRequirement = 0;

  for (const r of rows) {
    inventoryValue += r.inventoryValue;
    excessValue += r.excessValue;
    purchaseRequirement += r.estimatedCost;

    const cat = byCategory.get(r.category) ?? { value: 0, excess: 0 };
    cat.value += r.inventoryValue;
    cat.excess += r.excessValue;
    byCategory.set(r.category, cat);

    const bucket = COVER_BUCKETS.find((b) => r.daysOfCover <= b.max)!.bucket;
    cover.set(bucket, (cover.get(bucket) ?? 0) + 1);

    for (const s of r.monthlySales) {
      demand.set(s.periodMonth, (demand.get(s.periodMonth) ?? 0) + s.quantity);
    }
  }

  const count = (a: string) => rows.filter((r) => r.action === a).length;

  return {
    totalSkus: rows.length,
    reorderCount: count("REORDER"),
    watchCount: count("WATCH"),
    excessCount: count("EXCESS"),
    healthyCount: count("HOLD"),
    stockoutRiskCount: rows.filter((r) => r.stockoutRisk).length,
    inventoryValue: Math.round(inventoryValue),
    excessValue: Math.round(excessValue),
    purchaseRequirement: Math.round(purchaseRequirement),
    valueByCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, value: Math.round(v.value), excess: Math.round(v.excess) }))
      .sort((a, b) => b.value - a.value),
    coverDistribution: COVER_BUCKETS.map((b) => ({ bucket: b.bucket, count: cover.get(b.bucket) ?? 0 })),
    statusMix: [
      { status: "Reorder", count: count("REORDER") },
      { status: "Watch", count: count("WATCH") },
      { status: "Healthy", count: count("HOLD") },
      { status: "Excess", count: count("EXCESS") },
    ],
    demandTrend: [...demand.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, units]) => ({ month: month.slice(0, 7), units })),
    topActions: rows
      .filter((r) => r.action === "REORDER")
      .sort((a, b) => b.estimatedCost - a.estimatedCost)
      .slice(0, 6)
      .map((r) => ({
        sku: r.sku,
        name: r.name,
        action: r.action,
        recommendedQty: r.recommendedQty,
        estimatedCost: r.estimatedCost,
        daysOfCover: r.daysOfCover,
      })),
  };
}