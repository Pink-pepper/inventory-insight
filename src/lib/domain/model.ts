/**
 * Canonical internal data model.
 *
 * Connectors (CSV today; Odoo / SAP / Dynamics / NetSuite / custom APIs later)
 * map their own shapes into these types. Nothing downstream of this file knows
 * anything about CSV column names or ERP schemas.
 */

export type ConnectorType = "csv" | "odoo" | "sap" | "dynamics" | "netsuite" | "custom_api";

export type RecommendationAction = "REORDER" | "WATCH" | "HOLD" | "EXCESS";

export interface CanonicalSupplier {
  externalRef: string;
  name: string;
  code: string;
  leadTimeDays: number;
  minOrderQty: number;
  reliability: number;
}

export interface CanonicalProduct {
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  supplierCode: string;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  safetyStockDays: number;
}

export interface CanonicalInventory {
  sku: string;
  onHand: number;
  onOrder: number;
  location: string;
  asOf: string; // ISO date
  /** Earliest expected arrival for the on-order quantity, when known. */
  expectedAt?: string | null;
}

export interface CanonicalSale {
  sku: string;
  periodMonth: string; // ISO date, first of month
  quantity: number;
  revenue: number;
}

/** A complete ingestion payload produced by any connector. */
export interface CanonicalDataset {
  suppliers: CanonicalSupplier[];
  products: CanonicalProduct[];
  inventory: CanonicalInventory[];
  sales: CanonicalSale[];
}

/** A stock position at a single physical location. */
export interface InventoryPosition {
  location: string;
  onHand: number;
  onOrder: number;
  asOf: string;
  expectedAt?: string | null;
}

/** Where a lead time came from, so the UI never implies precision it does not have. */
export type LeadTimeSource = "product" | "supplier" | "missing";

/** Application-level roles within a workspace. */
export type OrgRole = "owner" | "admin" | "member";

/** A tenant workspace as the application talks about it. */
export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/** The signed-in person, in application terms. */
export interface UserProfile {
  name: string;
  email: string;
}

/** A configured ingestion source, independent of how it is stored. */
export interface DataSource {
  id: string;
  name: string;
  connector: ConnectorType;
  status: string;
  lastSyncAt: string | null;
  rowsIngested: number;
  errorCount: number;
}

/** An append-only workspace activity entry. */
export interface AuditEvent {
  id: string;
  event: string;
  detail: Record<string, unknown>;
  occurredAt: string;
}

export type PurchaseOrderStatus = "draft" | "placed" | "received" | "cancelled";

/** An inbound order against a SKU. */
export interface PurchaseOrder {
  id: string;
  sku: string | null;
  supplierName: string | null;
  quantity: number;
  unitCost: number;
  status: PurchaseOrderStatus;
  expectedAt: string | null;
}

/** Provenance of a stored recommendation run. */
export interface RunProvenance {
  runId: string | null;
  runStartedAt: string | null;
  generatedAt: string;
}

/** Inputs the decision engine needs for a single SKU. */
export interface SkuSignal {
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  supplierName: string;
  /** Null when neither the product nor its supplier declares a lead time. */
  leadTimeDays: number | null;
  leadTimeSource: LeadTimeSource;
  minOrderQty: number;
  safetyStockDays: number;
  /** Aggregate physical stock across all locations. */
  onHand: number;
  /** Aggregate inbound stock across all locations. Not yet physically available. */
  onOrder: number;
  /** Per-location breakdown. Planning is aggregate; allocation is not optimised. */
  locations: InventoryPosition[];
  /** Earliest known expected arrival across open purchase orders. */
  expectedArrival: string | null;
  monthlySales: { periodMonth: string; quantity: number }[];
}