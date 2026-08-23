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
  /** Selling price, when the source provides it. Never invented. */
  unitPrice?: number | null;
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
  /** Cost of goods sold for the period, when the source provides it. */
  cogs?: number | null;
}

/** A customer as any source describes it. */
export interface CanonicalCustomer {
  externalRef: string;
  name: string;
  segment?: string | null;
}

/** A route to market as any source describes it. */
export interface CanonicalChannel {
  code: string;
  name: string;
}

/**
 * A single demand line at day grain. The finest fact Ionic stores; monthly
 * sales are derived from these when transactions are supplied.
 */
export interface CanonicalTransaction {
  sku: string;
  occurredOn: string; // ISO date
  quantity: number;
  value?: number | null;
  unitPrice?: number | null;
  cogs?: number | null;
  customerRef?: string | null;
  channelCode?: string | null;
  location?: string | null;
  region?: string | null;
  stateProvince?: string | null;
  currencyCode?: string | null;
  originalAmount?: number | null;
  /** Document/line identifier from the source system, when present. */
  sourceRef?: string | null;
  /** Deterministic fingerprint of the business fields, for re-import detection. */
  rowHash: string;
}

/**
 * A single purchase order line as any source describes it. Supply Planning
 * phases the outstanding quantity by its expected date; nothing is inferred
 * when the date is absent — the supply is reported as unscheduled.
 */
export interface CanonicalPurchaseOrder {
  /** Purchase order reference from the source system, when present. */
  poRef: string | null;
  status: PurchaseOrderStatus;
  /**
   * Approval signal carried by the source data, when one exists. Distinct
   * from the fulfilment lifecycle — a PO can be approved and still open.
   */
  approvalStatus: PurchaseOrderApprovalStatus;
  sku: string;
  supplierCode: string | null;
  supplierName: string | null;
  quantity: number;
  receivedQuantity: number;
  /** Line unit cost; persistence falls back to the product's recorded cost. */
  unitCost: number | null;
  orderedAt: string | null;
  expectedAt: string | null;
  /** Actual delivery date, when the source reports one. */
  receivedAt: string | null;
  /** Receiving location code, matched to the workspace's locations. */
  location: string | null;
  currencyCode: string | null;
  buyer: string | null;
  /** Deterministic fingerprint of the business fields, for re-import detection. */
  rowHash: string;
}

/**
 * Forward-looking demand for a SKU in a future period. Forecasts are their
 * own canonical domain: they are never folded into sales history, and they
 * stay distinct from Scenario Planning assumptions.
 */
export interface CanonicalForecast {
  sku: string;
  periodMonth: string; // ISO date, first of month
  baselineQty: number;
  lowQty?: number | null;
  highQty?: number | null;
  method?: string | null;
  location: string;
  sourceRef?: string | null;
  /** Deterministic fingerprint (SKU, period, location) for re-import detection. */
  rowHash: string;
}

/** A complete ingestion payload produced by any connector. */
export interface CanonicalDataset {
  suppliers: CanonicalSupplier[];
  products: CanonicalProduct[];
  inventory: CanonicalInventory[];
  sales: CanonicalSale[];
  customers?: CanonicalCustomer[];
  channels?: CanonicalChannel[];
  transactions?: CanonicalTransaction[];
  purchaseOrders?: CanonicalPurchaseOrder[];
  forecasts?: CanonicalForecast[];
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

/** Values an audit entry may carry; JSON-serialisable by construction. */
export type AuditDetailValue = string | number | boolean | null;

/** An append-only workspace activity entry. */
export interface AuditEvent {
  id: string;
  event: string;
  detail: Record<string, AuditDetailValue>;
  occurredAt: string;
}

/**
 * PO lifecycle (fulfilment-side vocabulary). Approval state is a separate
 * dimension — never fold the two into one status.
 */
export type PurchaseOrderStatus = "draft" | "placed" | "received" | "closed" | "cancelled";

export type PurchaseOrderApprovalStatus = "needs_review" | "approved" | "rejected";

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

/** A stored purchase order line as the PO Inbox talks about it. */
export interface PurchaseOrderRecord {
  id: string;
  poNumber: string | null;
  sku: string | null;
  productName: string | null;
  supplierName: string | null;
  supplierCode: string | null;
  quantity: number;
  receivedQuantity: number;
  outstanding: number;
  unitCost: number;
  currencyCode: string | null;
  status: PurchaseOrderStatus;
  approvalStatus: PurchaseOrderApprovalStatus;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  locationCode: string | null;
  locationName: string | null;
  buyer: string | null;
  importBatchId: string | null;
  createdAt: string;
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