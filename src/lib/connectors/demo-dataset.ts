import type { CanonicalDataset } from "@/lib/domain/model";

/**
 * Deterministic, internally consistent demo dataset:
 * 50 SKUs, 5 categories, 8 suppliers, 12 months of history.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUPPLIERS = [
  { name: "Northwind Components", code: "NWC", leadTimeDays: 21, minOrderQty: 100, reliability: 0.96 },
  { name: "Baltic Industrial", code: "BAL", leadTimeDays: 45, minOrderQty: 250, reliability: 0.88 },
  { name: "Meridian Fasteners", code: "MER", leadTimeDays: 14, minOrderQty: 50, reliability: 0.97 },
  { name: "Shenzhen Ridgeline", code: "SZR", leadTimeDays: 60, minOrderQty: 500, reliability: 0.83 },
  { name: "Atlas Polymers", code: "ATP", leadTimeDays: 30, minOrderQty: 200, reliability: 0.92 },
  { name: "Caledon Electrical", code: "CAL", leadTimeDays: 10, minOrderQty: 25, reliability: 0.98 },
  { name: "Vantage Hydraulics", code: "VAN", leadTimeDays: 35, minOrderQty: 40, reliability: 0.9 },
  { name: "Kestrel Safety Supply", code: "KES", leadTimeDays: 7, minOrderQty: 60, reliability: 0.99 },
];

const CATEGORIES = [
  { name: "Fasteners & Fixings", words: ["Hex Bolt", "Socket Screw", "Anchor Set", "Threaded Rod", "Locking Washer"] },
  { name: "Electrical", words: ["Contactor", "Cable Reel", "Junction Box", "Relay Module", "Terminal Block"] },
  { name: "Hydraulics", words: ["Hose Assembly", "Gear Pump", "Pressure Valve", "Cylinder Seal", "Manifold Block"] },
  { name: "Safety & PPE", words: ["Nitrile Glove Box", "Safety Harness", "Visor Shield", "Ear Defender", "Hi-Vis Vest"] },
  { name: "Polymers & Seals", words: ["O-Ring Kit", "Gasket Sheet", "PTFE Bushing", "Rubber Matting", "Sealant Cartridge"] },
];

type Profile = "fast" | "slow" | "excess" | "stockout" | "healthy" | "dead";

const PROFILE_MIX: Profile[] = [
  ...Array<Profile>(10).fill("fast"),
  ...Array<Profile>(9).fill("healthy"),
  ...Array<Profile>(9).fill("stockout"),
  ...Array<Profile>(9).fill("excess"),
  ...Array<Profile>(10).fill("slow"),
  ...Array<Profile>(3).fill("dead"),
];

export function buildDemoDataset(): CanonicalDataset {
  const rand = mulberry32(20260809);
  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }

  const dataset: CanonicalDataset = {
    suppliers: SUPPLIERS.map((s) => ({ ...s, externalRef: s.code })),
    products: [],
    inventory: [],
    sales: [],
  };
  const asOf = now.toISOString().slice(0, 10);

  for (let i = 0; i < 50; i++) {
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const supplier = SUPPLIERS[(i * 3) % SUPPLIERS.length]!;
    const profile = PROFILE_MIX[i]!;
    const word = category.words[Math.floor(rand() * category.words.length)]!;
    const sku = `${category.name.slice(0, 2).toUpperCase()}-${1000 + i * 7}`;
    const name = `${word} ${["M8", "M12", "24V", '3/4"', "Series 400", "Heavy Duty", "Grade A", "Compact"][i % 8]}`;
    const unitCost = Math.round((2 + rand() * 180) * 100) / 100;
    const safetyStockDays = [7, 10, 14, 21][i % 4]!;

    const baseDemand =
      profile === "fast"
        ? 400 + Math.floor(rand() * 700)
        : profile === "slow"
          ? 8 + Math.floor(rand() * 25)
          : profile === "dead"
            ? 0
            : 60 + Math.floor(rand() * 220);

    const trend = profile === "fast" ? 0.03 : profile === "excess" ? -0.05 : 0;

    let recentAvg = 0;
    months.forEach((month, idx) => {
      const seasonal = 1 + 0.18 * Math.sin((idx / 12) * Math.PI * 2 + i);
      const noise = 0.85 + rand() * 0.3;
      const qty = Math.max(0, Math.round(baseDemand * seasonal * noise * (1 + trend * idx)));
      if (idx >= 6) recentAvg += qty / 6;
      dataset.sales.push({
        sku,
        periodMonth: month,
        quantity: qty,
        revenue: Math.round(qty * unitCost * (1.28 + rand() * 0.25)),
      });
    });

    const dailyDemand = recentAvg / 30.44;
    const coverTarget =
      profile === "stockout"
        ? supplier.leadTimeDays * (0.25 + rand() * 0.35)
        : profile === "excess"
          ? supplier.leadTimeDays + safetyStockDays + 150 + rand() * 180
          : profile === "dead"
            ? 0
            : supplier.leadTimeDays + safetyStockDays + 35 + rand() * 55;

    const onHand =
      profile === "dead"
        ? 40 + Math.floor(rand() * 200)
        : Math.max(0, Math.round(dailyDemand * coverTarget));
    const onOrder = profile === "stockout" && rand() > 0.6 ? Math.round(dailyDemand * 10) : 0;

    dataset.products.push({
      sku,
      name,
      category: category.name,
      unitCost,
      supplierCode: supplier.code,
      leadTimeDays: supplier.leadTimeDays,
      minOrderQty: supplier.minOrderQty,
      safetyStockDays,
    });
    dataset.inventory.push({ sku, onHand, onOrder, location: "MAIN", asOf });
  }

  return dataset;
}

/** Same dataset rendered as CSV, for the downloadable template. */
export function demoDatasetToCsv(): string {
  const ds = buildDemoDataset();
  const supplierByCode = new Map(ds.suppliers.map((s) => [s.code, s]));
  const invBySku = new Map(ds.inventory.map((i) => [i.sku, i]));
  const prodBySku = new Map(ds.products.map((p) => [p.sku, p]));
  const header =
    "sku,product_name,category,unit_cost,supplier_name,supplier_code,lead_time_days,moq,safety_stock_days,on_hand,on_order,month,units_sold";
  const rows = ds.sales.map((s) => {
    const p = prodBySku.get(s.sku)!;
    const sup = supplierByCode.get(p.supplierCode)!;
    const inv = invBySku.get(s.sku)!;
    return [
      p.sku,
      `"${p.name}"`,
      `"${p.category}"`,
      p.unitCost,
      `"${sup.name}"`,
      sup.code,
      p.leadTimeDays,
      p.minOrderQty,
      p.safetyStockDays,
      inv.onHand,
      inv.onOrder,
      s.periodMonth.slice(0, 7),
      s.quantity,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}