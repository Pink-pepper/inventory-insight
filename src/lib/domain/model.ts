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

/** Inputs the decision engine needs for a single SKU. */
export interface SkuSignal {
  sku: string;
  name: string;
  category: string;
  unitCost: number;
  supplierName: string;
  leadTimeDays: number;
  minOrderQty: number;
  safetyStockDays: number;
  onHand: number;
  onOrder: number;
  monthlySales: { periodMonth: string; quantity: number }[];
}