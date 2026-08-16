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
  "location",
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
  location: ["location", "warehouse", "site", "store"],
};

function splitLine(line: string): string[] {
  return splitLineImpl(line);
}

/** Ingestion guard rails. Bound work and stored value sizes regardless of input. */
const MAX_ROWS = 50_000;
const MAX_SKUS = 20_000;
const MAX_ISSUES = 500;
const MAX_TEXT = 120;
const MAX_NUMBER = 1e9;

/** Trims a free-text cell to a storable length and strips control characters. */
function safeText(value: string | undefined, fallback = ""): string {
  const cleaned = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned === "" ? fallback : cleaned).slice(0, MAX_TEXT);
}

function splitLineImpl(line: string): string[] {
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

/** Parses a numeric cell, distinguishing "absent" from "not a number". */
function parseNumber(value: string | undefined): { value: number | null; malformed: boolean } {
  if (value == null || value.trim() === "") return { value: null, malformed: false };
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? { value: parsed, malformed: false } : { value: null, malformed: true };
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
        issues: [
          { row: 0, field: "file", message: "File is empty or has no data rows.", severity: "error" },
        ],
        rowsParsed: 0,
        stats: { rowsRead: 0, rowsAccepted: 0, rowsRejected: 0, warnings: 0 },
      };
    }

    const rawHeaders = splitLine(lines[0]!);
    const headers = rawHeaders.map(normaliseHeader);
    const totalRows = lines.length - 1;
    const rowLimitHit = totalRows > MAX_ROWS;
    const lastLine = rowLimitHit ? MAX_ROWS + 1 : lines.length - 1;
    if (!headers.includes("sku")) {
      return {
        dataset: { suppliers: [], products: [], inventory: [], sales: [] },
        issues: [
          {
            row: 1,
            field: "sku",
            message: `No recognisable SKU column in the header row. Found: ${rawHeaders.join(", ")}.`,
            severity: "error",
          },
        ],
        rowsParsed: 0,
        stats: { rowsRead: totalRows, rowsAccepted: 0, rowsRejected: totalRows, warnings: 0 },
      };
    }

    // Columns we could not map are reported once, not per row.
    rawHeaders.forEach((raw, idx) => {
      if (raw.trim() !== "" && headers[idx] === null) {
        issues.push({
          row: 1,
          field: raw,
          message: `Column "${raw}" is not recognised and was ignored.`,
          severity: "warning",
        });
      }
    });
    for (const required of ["unit_cost", "on_hand", "units_sold"] as const) {
      if (!headers.includes(required)) {
        issues.push({
          row: 1,
          field: required,
          message: `No "${required}" column found. Recommendations that depend on it will be limited.`,
          severity: "warning",
        });
      }
    }

    const suppliers = new Map<string, CanonicalDataset["suppliers"][number]>();
    const products = new Map<string, CanonicalDataset["products"][number]>();
    const inventory = new Map<string, CanonicalDataset["inventory"][number]>();
    const sales = new Map<string, CanonicalDataset["sales"][number]>();
    const asOf = new Date().toISOString().slice(0, 10);
    let rowsParsed = 0;
    let rowsRejected = 0;
    const seenRowBySku = new Map<string, number>();
    const today = new Date().toISOString().slice(0, 10);

    if (rowLimitHit) {
      issues.push({
        row: MAX_ROWS + 1,
        field: "file",
        message: `File contains ${totalRows} data rows. Only the first ${MAX_ROWS} were processed.`,
        severity: "warning",
      });
    }

    for (let i = 1; i <= lastLine; i++) {
      const cells = splitLine(lines[i]!);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h) row[h] = cells[idx] ?? "";
      });

      const sku = safeText(row["sku"]);
      if (!sku) {
        issues.push({
          row: i + 1,
          field: "sku",
          message: "Missing SKU. Row rejected.",
          severity: "error",
        });
        rowsRejected++;
        continue;
      }
      if (!products.has(sku) && products.size >= MAX_SKUS) {
        rowsRejected++;
        continue;
      }

      // Numeric validation before anything is written into the canonical model.
      const numeric: Record<string, number | null> = {};
      let rejected = false;
      for (const field of ["unit_cost", "on_hand", "on_order", "units_sold", "lead_time_days", "moq", "safety_stock_days"] as const) {
        const { value, malformed } = parseNumber(row[field]);
        if (malformed) {
          issues.push({
            row: i + 1,
            field,
            message: `"${row[field]}" is not a valid number. Row rejected.`,
            severity: "error",
          });
          rejected = true;
        }
        numeric[field] = value;
      }
      for (const field of ["on_hand", "on_order", "units_sold", "unit_cost"] as const) {
        const v = numeric[field];
        if (v != null && v < 0) {
          issues.push({
            row: i + 1,
            field,
            message: `Negative value (${v}) is not valid for ${field.replace(/_/g, " ")}. Row rejected.`,
            severity: "error",
          });
          rejected = true;
        }
      }
      for (const field of ["unit_cost", "on_hand", "on_order", "units_sold", "lead_time_days", "moq", "safety_stock_days"] as const) {
        const v = numeric[field];
        if (v != null && Math.abs(v) > MAX_NUMBER) {
          issues.push({
            row: i + 1,
            field,
            message: `Value for ${field.replace(/_/g, " ")} is outside the supported range. Row rejected.`,
            severity: "error",
          });
          rejected = true;
        }
      }
      if (rejected) {
        rowsRejected++;
        continue;
      }

      if (numeric["unit_cost"] == null || numeric["unit_cost"] === 0) {
        issues.push({
          row: i + 1,
          field: "unit_cost",
          message: `Unit cost is missing for ${sku}. Spend and inventory value cannot be calculated.`,
          severity: "warning",
        });
      }
      if (!row["supplier_name"] && !row["supplier_code"]) {
        issues.push({
          row: i + 1,
          field: "supplier_name",
          message: `No supplier for ${sku}. Ordering terms cannot be applied.`,
          severity: "warning",
        });
      }
      if (numeric["lead_time_days"] == null) {
        issues.push({
          row: i + 1,
          field: "lead_time_days",
          message: `No supplier lead time for ${sku}. A reorder point cannot be calculated for this SKU.`,
          severity: "warning",
        });
      }

      rowsParsed++;

      const supplierName = safeText(row["supplier_name"], "Unassigned supplier");
      const supplierCode =
        safeText(row["supplier_code"]).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) ||
        supplierName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) ||
        "UNASSIGNED";
      // No invented lead time: absent stays absent all the way to the engine.
      const leadTime =
        numeric["lead_time_days"] != null ? Math.max(1, Math.round(numeric["lead_time_days"])) : null;
      const moq = numeric["moq"] != null ? Math.max(1, Math.round(numeric["moq"])) : 1;

      if (!suppliers.has(supplierCode)) {
        suppliers.set(supplierCode, {
          externalRef: supplierCode,
          name: supplierName,
          code: supplierCode,
          leadTimeDays: leadTime ?? 0,
          minOrderQty: moq,
          reliability: 0.95,
        });
      }

      const firstSeen = seenRowBySku.get(sku);
      if (firstSeen == null) {
        seenRowBySku.set(sku, i + 1);
        products.set(sku, {
          sku,
          name: safeText(row["product_name"], sku),
          category: safeText(row["category"], "Uncategorised"),
          unitCost: numeric["unit_cost"] ?? 0,
          supplierCode,
          leadTimeDays: leadTime,
          minOrderQty: moq,
          safetyStockDays: Math.max(0, Math.round(numeric["safety_stock_days"] ?? 14)),
        });
      } else {
        const existing = products.get(sku)!;
        const conflicting =
          (numeric["unit_cost"] != null && numeric["unit_cost"] !== existing.unitCost) ||
          (row["product_name"] && row["product_name"] !== existing.name);
        if (conflicting) {
          issues.push({
            row: i + 1,
            field: "sku",
            message: `${sku} appears again with different product details. The values from row ${firstSeen} were kept.`,
            severity: "warning",
          });
        }
      }

      const location = safeText(row["location"], "MAIN");
      const invKey = `${sku}|${location}`;
      if (!inventory.has(invKey) && numeric["on_hand"] != null) {
        inventory.set(invKey, {
          sku,
          onHand: numeric["on_hand"],
          onOrder: numeric["on_order"] ?? 0,
          location,
          asOf,
        });
      }

      const month = monthKey(row["month"]);
      if (month) {
        if (month > today) {
          issues.push({
            row: i + 1,
            field: "month",
            message: `Period ${month.slice(0, 7)} is in the future and was excluded from demand history.`,
            severity: "warning",
          });
        } else {
        const key = `${sku}|${month}`;
        const qty = numeric["units_sold"] ?? 0;
        const existing = sales.get(key);
        const product = products.get(sku)!;
        sales.set(key, {
          sku,
          periodMonth: month,
          quantity: (existing?.quantity ?? 0) + qty,
          revenue: (existing?.revenue ?? 0) + qty * product.unitCost * 1.35,
        });
        }
      } else if (row["month"]) {
        issues.push({
          row: i + 1,
          field: "month",
          message: `Unrecognised date "${row["month"]}". Sales for this row were not counted.`,
          severity: "warning",
        });
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
      stats: {
        rowsRead: totalRows,
        rowsAccepted: rowsParsed,
        rowsRejected,
        warnings: issues.filter((i) => i.severity === "warning").length,
      },
    };
  },
};