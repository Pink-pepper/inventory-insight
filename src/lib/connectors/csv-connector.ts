import type { CanonicalDataset } from "@/lib/domain/model";
import type { Connector, ConnectorResult, IngestionIssue } from "./types";

export const CSV_TEMPLATE_HEADERS = [
  "sku",
  "product_name",
  "category",
  "unit_cost",
  "supplier_name",
  "supplier_code",
  "lead_time_days",
  "moq",
  "safety_stock_days",
  "on_hand",
  "on_order",
  "month",
  "units_sold",
] as const;

/** Alternative column names accepted from other systems. */
const ALIASES: Record<string, string[]> = {
  sku: ["sku", "item_code", "item", "product_code", "material"],
  product_name: ["product_name", "name", "description", "product"],
  category: ["category", "product_group", "family"],
  unit_cost: ["unit_cost", "cost", "standard_cost", "unit_price"],
  supplier_name: ["supplier_name", "supplier", "vendor", "vendor_name"],
  supplier_code: ["supplier_code", "vendor_code", "supplier_id"],
  lead_time_days: ["lead_time_days", "lead_time", "leadtime"],
  moq: ["moq", "min_order_qty", "minimum_order_quantity"],
  safety_stock_days: ["safety_stock_days", "safety_days"],
  on_hand: ["on_hand", "qty_on_hand", "stock", "quantity", "inventory"],
  on_order: ["on_order", "qty_on_order", "incoming"],
  month: ["month", "period", "sales_month", "date"],
  units_sold: ["units_sold", "qty_sold", "sales_qty", "demand"],
};

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function normaliseHeader(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }
  return null;
}

function num(value: string | undefined, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function monthKey(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const iso = /^(\d{4})-(\d{1,2})/.exec(v);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-01`;
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  return null;
}

/**
 * CSV → canonical model. One row per SKU-month; product/supplier/inventory
 * attributes are de-duplicated across rows.
 */
export const csvConnector: Connector<string> = {
  type: "csv",
  label: "CSV upload",
  parse(text: string): ConnectorResult {
    const issues: IngestionIssue[] = [];
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) {
      return {
        dataset: { suppliers: [], products: [], inventory: [], sales: [] },
        issues: [{ row: 0, field: "file", message: "File is empty or has no data rows." }],
        rowsParsed: 0,
      };
    }

    const headers = splitLine(lines[0]!).map(normaliseHeader);
    if (!headers.includes("sku")) {
      return {
        dataset: { suppliers: [], products: [], inventory: [], sales: [] },
        issues: [{ row: 1, field: "sku", message: "No recognisable SKU column found in the header row." }],
        rowsParsed: 0,
      };
    }

    const suppliers = new Map<string, CanonicalDataset["suppliers"][number]>();
    const products = new Map<string, CanonicalDataset["products"][number]>();
    const inventory = new Map<string, CanonicalDataset["inventory"][number]>();
    const sales = new Map<string, CanonicalDataset["sales"][number]>();
    const asOf = new Date().toISOString().slice(0, 10);
    let rowsParsed = 0;

    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i]!);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h) row[h] = cells[idx] ?? "";
      });

      const sku = row["sku"];
      if (!sku) {
        issues.push({ row: i + 1, field: "sku", message: "Missing SKU — row skipped." });
        continue;
      }
      rowsParsed++;

      const supplierName = row["supplier_name"] || "Unassigned supplier";
      const supplierCode =
        row["supplier_code"] || supplierName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "UNASSIGNED";
      const leadTime = Math.max(1, Math.round(num(row["lead_time_days"], 14)));
      const moq = Math.max(1, Math.round(num(row["moq"], 1)));

      if (!suppliers.has(supplierCode)) {
        suppliers.set(supplierCode, {
          externalRef: supplierCode,
          name: supplierName,
          code: supplierCode,
          leadTimeDays: leadTime,
          minOrderQty: moq,
          reliability: 0.95,
        });
      }

      if (!products.has(sku)) {
        products.set(sku, {
          sku,
          name: row["product_name"] || sku,
          category: row["category"] || "Uncategorised",
          unitCost: num(row["unit_cost"], 0),
          supplierCode,
          leadTimeDays: leadTime,
          minOrderQty: moq,
          safetyStockDays: Math.max(0, Math.round(num(row["safety_stock_days"], 14))),
        });
      }

      if (!inventory.has(sku) && row["on_hand"] !== undefined) {
        inventory.set(sku, {
          sku,
          onHand: num(row["on_hand"], 0),
          onOrder: num(row["on_order"], 0),
          location: "MAIN",
          asOf,
        });
      }

      const month = monthKey(row["month"]);
      if (month) {
        const key = `${sku}|${month}`;
        const qty = num(row["units_sold"], 0);
        const existing = sales.get(key);
        const product = products.get(sku)!;
        sales.set(key, {
          sku,
          periodMonth: month,
          quantity: (existing?.quantity ?? 0) + qty,
          revenue: (existing?.revenue ?? 0) + qty * product.unitCost * 1.35,
        });
      } else if (row["month"]) {
        issues.push({ row: i + 1, field: "month", message: `Unrecognised date "${row["month"]}".` });
      }
    }

    return {
      dataset: {
        suppliers: [...suppliers.values()],
        products: [...products.values()],
        inventory: [...inventory.values()],
        sales: [...sales.values()],
      },
      issues,
      rowsParsed,
    };
  },
};