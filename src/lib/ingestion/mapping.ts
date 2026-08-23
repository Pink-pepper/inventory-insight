import type { SheetTable } from "./sheet-table";

/**
 * What a sheet is understood to contain. Detection is a suggestion only —
 * the user always confirms before anything is written.
 */
export type EntityKind =
  | "combined"
  | "products"
  | "suppliers"
  | "inventory"
  | "sales_monthly"
  | "transactions"
  | "customers"
  | "channels"
  | "purchase_orders"
  | "ignored";

export interface EntityDefinition {
  kind: EntityKind;
  label: string;
  description: string;
  /** Canonical fields that must be mapped before the sheet can be imported. */
  required: string[];
  /** Canonical fields the sheet may also provide. */
  optional: string[];
}

/** Alternative column names accepted from other systems, per canonical field. */
export const FIELD_ALIASES: Record<string, string[]> = {
  sku: ["sku", "item_code", "item", "product_code", "material", "material_number", "part_number", "product_sku", "stock_code", "item_no", "product_id", "item_number", "stock_keeping_unit"],
  product_name: ["product_name", "name", "description", "product", "item_name", "item_description", "desc", "product_description", "item_desc"],
  category: ["category", "product_group", "family", "product_category", "group", "department", "dept", "class", "product_class"],
  unit_cost: ["unit_cost", "cost", "standard_cost", "cost_price", "buy_price", "purchase_price", "unit_purchase_price"],
  unit_price: ["unit_price", "selling_price", "sell_price", "list_price", "price", "retail_price"],
  supplier_name: ["supplier_name", "supplier", "vendor", "vendor_name", "supplier_desc", "vendor_desc"],
  supplier_code: ["supplier_code", "vendor_code", "supplier_id", "vendor_id", "vendor_no", "vendor_number", "supplier_number", "supplier_no"],
  lead_time_days: ["lead_time_days", "lead_time", "leadtime", "lead_time_in_days", "lead_time_d", "lt_days", "lead_days"],
  moq: ["moq", "min_order_qty", "minimum_order_quantity", "min_qty", "minimum_order_qty", "min_order_quantity", "order_minimum"],
  reliability: ["reliability", "otif", "on_time_rate", "service_rate", "fill_rate"],
  safety_stock_days: ["safety_stock_days", "safety_days", "buffer_days"],
  on_hand: ["on_hand", "qty_on_hand", "stock", "quantity_on_hand", "inventory", "closing_stock", "stock_on_hand", "available_qty", "current_stock", "soh", "onhand"],
  on_order: ["on_order", "qty_on_order", "incoming", "open_po_qty", "open_order_qty", "on_po", "inbound_qty"],
  as_of: ["as_of", "as_of_date", "stock_date", "snapshot_date", "count_date"],
  location: ["location", "warehouse", "site", "store", "branch", "depot", "warehouse_code", "loc", "facility", "dc", "location_code"],
  region: ["region", "zone", "territory", "sales_region"],
  state_province: ["state", "province", "state_province", "county"],
  country: ["country", "country_code", "country_name"],
  month: ["month", "period", "sales_month", "period_month", "yyyy_mm", "month_year", "fiscal_period"],
  units_sold: ["units_sold", "qty_sold", "sales_qty", "demand", "quantity_sold", "sales_units", "units"],
  revenue: ["revenue", "sales_value", "net_sales", "turnover", "amount", "value", "line_total", "net_revenue", "sales_amount", "ext_price", "line_value", "net_amount"],
  cogs: ["cogs", "cost_of_goods", "cost_of_sales", "total_cost", "cost_amount"],
  transaction_date: ["date", "transaction_date", "order_date", "invoice_date", "posting_date", "document_date", "sales_date", "txn_date", "day", "invoice_dt", "doc_date"],
  quantity: ["quantity", "qty", "units", "qty_sold", "units_sold", "demand", "order_qty", "qty_ordered", "ordered_qty"],
  customer_ref: ["customer_id", "customer_code", "customer_ref", "account_number", "account_code", "cust_no", "cust_code", "sold_to", "ship_to", "account"],
  customer_name: ["customer_name", "customer", "account_name", "client", "buyer", "client_name", "customer_desc"],
  segment: ["segment", "customer_segment", "tier", "customer_type", "customer_group"],
  channel_code: ["channel_code", "channel_id", "channel"],
  channel_name: ["channel_name", "channel", "sales_channel", "route_to_market", "channel_description", "channel_desc"],
  currency_code: ["currency", "currency_code", "ccy", "curr", "currency_cd"],
  original_amount: ["original_amount", "amount_original", "document_amount", "local_amount", "doc_amount"],
  source_ref: ["source_ref", "document_no", "document_number", "invoice_no", "invoice_number", "order_no", "order_number", "line_id", "transaction_id", "doc_no", "inv_no", "receipt_no"],
  po_ref: ["po_number", "po_no", "po_ref", "purchase_order", "purchase_order_number", "po_id", "po", "po_num", "po_nbr"],
  po_status: ["po_status", "status", "order_status", "state", "po_state"],
  approval_status: ["approval_status", "approval", "approval_state", "approved"],
  ordered_at: ["ordered_at", "po_date", "placed_date", "date_ordered", "created_date", "raised_date", "order_date", "issue_date", "po_created"],
  expected_at: ["expected_at", "eta", "expected_date", "expected_delivery", "delivery_date", "due_date", "promised_date", "arrival_date", "delivery_due", "req_date", "need_by", "requested_date"],
  received_quantity: ["received_quantity", "received_qty", "qty_received", "quantity_received", "grn_qty"],
  received_at: ["received_at", "received_date", "actual_delivery", "actual_delivery_date", "goods_received_date", "delivered_date", "grn_date"],
  buyer: ["buyer", "planner", "purchaser", "buyer_name", "ordered_by", "purchased_by", "agent", "buyer_code"],
};

export const ENTITY_DEFINITIONS: EntityDefinition[] = [
  {
    kind: "combined",
    label: "Combined inventory & sales",
    description: "One row per SKU and month, carrying product, stock and demand columns together.",
    required: ["sku"],
    optional: ["product_name", "category", "unit_cost", "supplier_name", "supplier_code", "lead_time_days", "moq", "safety_stock_days", "on_hand", "on_order", "location", "month", "units_sold"],
  },
  {
    kind: "products",
    label: "Products",
    description: "The item master: SKU, description, category, cost and ordering terms.",
    required: ["sku"],
    optional: ["product_name", "category", "unit_cost", "unit_price", "supplier_code", "supplier_name", "lead_time_days", "moq", "safety_stock_days"],
  },
  {
    kind: "suppliers",
    label: "Suppliers",
    description: "Vendor master: name, code, lead time and ordering minimums.",
    required: ["supplier_name"],
    optional: ["supplier_code", "lead_time_days", "moq", "reliability"],
  },
  {
    kind: "inventory",
    label: "Inventory positions",
    description: "Stock on hand and on order, optionally by location.",
    required: ["sku", "on_hand"],
    optional: ["on_order", "location", "as_of", "region", "state_province", "country"],
  },
  {
    kind: "sales_monthly",
    label: "Monthly sales history",
    description: "One row per SKU and month with quantity sold.",
    required: ["sku", "month", "units_sold"],
    optional: ["revenue", "cogs"],
  },
  {
    kind: "transactions",
    label: "Sales transactions",
    description: "Day-level demand lines, optionally by customer, channel and location.",
    required: ["sku", "transaction_date", "quantity"],
    optional: ["revenue", "unit_price", "cogs", "customer_ref", "customer_name", "channel_code", "channel_name", "location", "region", "state_province", "currency_code", "original_amount", "source_ref"],
  },
  {
    kind: "customers",
    label: "Customers",
    description: "Customer master: reference, name and segment.",
    required: ["customer_name"],
    optional: ["customer_ref", "segment"],
  },
  {
    kind: "channels",
    label: "Channels",
    description: "Sales channel or route-to-market master.",
    required: ["channel_name"],
    optional: ["channel_code"],
  },
  {
    kind: "purchase_orders",
    label: "Purchase orders",
    description:
      "Open or historical purchase orders: one row per PO line. Suppliers are matched to existing suppliers by code or name. Feeds ETA-phased supply into Supply Planning and the Purchasing inbox.",
    required: ["sku", "quantity"],
    optional: [
      "po_ref",
      "po_status",
      "approval_status",
      "supplier_code",
      "supplier_name",
      "unit_cost",
      "ordered_at",
      "expected_at",
      "received_quantity",
      "received_at",
      "location",
      "currency_code",
      "buyer",
    ],
  },
];

export function definitionFor(kind: EntityKind): EntityDefinition | null {
  return ENTITY_DEFINITIONS.find((d) => d.kind === kind) ?? null;
}

/** Header text → comparable key. Case, spacing and punctuation are ignored. */
export function headerKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s.\-/]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** Canonical field a header most likely refers to, or null when unrecognised. */
export function canonicalField(raw: string, allowed: string[]): string | null {
  const key = headerKey(raw);
  if (key === "") return null;
  for (const field of allowed) {
    if (field === key) return field;
    if (FIELD_ALIASES[field]?.includes(key)) return field;
  }
  return null;
}

/** A confirmed column mapping: canonical field → column index in the sheet. */
export type ColumnMapping = Record<string, number>;

export interface SheetSuggestion {
  kind: EntityKind;
  confidence: number;
  mapping: ColumnMapping;
  unmappedHeaders: string[];
  missingRequired: string[];
}

function score(sheet: SheetTable, def: EntityDefinition): SheetSuggestion {
  const fields = [...def.required, ...def.optional];
  const mapping: ColumnMapping = {};
  const unmapped: string[] = [];
  sheet.headers.forEach((header, index) => {
    if (header.trim() === "") return;
    const field = canonicalField(header, fields);
    if (field && !(field in mapping)) mapping[field] = index;
    else if (!field) unmapped.push(header);
  });
  const missingRequired = def.required.filter((f) => !(f in mapping));
  const matched = Object.keys(mapping).length;
  const requiredHit = def.required.length - missingRequired.length;
  const confidence = missingRequired.length > 0 ? 0 : requiredHit * 2 + matched;
  return { kind: def.kind, confidence, mapping, unmappedHeaders: unmapped, missingRequired };
}

/**
 * Best-guess entity for a sheet, with the columns it recognised. Combined
 * sheets win only when they carry both stock and demand columns, so a plain
 * product master is not mistaken for one.
 */
export function suggestSheet(sheet: SheetTable): SheetSuggestion {
  if (sheet.headers.length === 0 || sheet.rows.length === 0) {
    return { kind: "ignored", confidence: 0, mapping: {}, unmappedHeaders: [], missingRequired: [] };
  }
  const scored = ENTITY_DEFINITIONS.map((def) => score(sheet, def));
  const byKind = new Map(scored.map((s) => [s.kind, s]));
  const combined = byKind.get("combined")!;
  const hasStock = "on_hand" in combined.mapping;
  const hasDemand = "units_sold" in combined.mapping && "month" in combined.mapping;
  if (combined.confidence > 0 && hasStock && hasDemand) return combined;

  const best = scored
    .filter((s) => s.kind !== "combined" && s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (best) return best;
  return { kind: "ignored", confidence: 0, mapping: {}, unmappedHeaders: sheet.headers.filter((h) => h.trim() !== ""), missingRequired: [] };
}