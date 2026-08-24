/**
 * Supply-side domain — supplier pricing, landed-cost components and the
 * physical shipments a purchase order actually arrives on.
 *
 * A purchase order is a commercial commitment; a shipment is the physical
 * event. One PO can arrive across several shipments, so arrival timing lives
 * here rather than on the order.
 */

export type ShipmentStatus =
  | "planned"
  | "booked"
  | "in_transit"
  | "arrived"
  | "clearing"
  | "cleared"
  | "delivered"
  | "cancelled";

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "planned",
  "booked",
  "in_transit",
  "arrived",
  "clearing",
  "cleared",
  "delivered",
  "cancelled",
];

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  planned: "Planned",
  booked: "Booked",
  in_transit: "In transit",
  arrived: "Arrived",
  clearing: "Clearing",
  cleared: "Cleared",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Statuses where the goods are still inbound — they are future supply. */
export const isInboundStatus = (s: ShipmentStatus) =>
  s === "planned" || s === "booked" || s === "in_transit" || s === "arrived" || s === "clearing";

/** Statuses that sit inside the import/clearance workflow. */
export const isClearanceStatus = (s: ShipmentStatus) =>
  s === "arrived" || s === "clearing" || s === "cleared";

export type CostComponentKind = "freight" | "duty" | "clearance" | "other" | "fx";

export const COST_COMPONENT_KINDS: CostComponentKind[] = [
  "freight",
  "duty",
  "clearance",
  "other",
  "fx",
];

export const COST_KIND_LABEL: Record<CostComponentKind, string> = {
  freight: "Freight",
  duty: "Duty",
  clearance: "Clearance",
  other: "Other",
  fx: "FX",
};

/** How a cost component turns into a per-unit number. */
export type CostBasis = "per_unit" | "per_shipment" | "percent_of_value";

export const COST_BASES: CostBasis[] = ["per_unit", "per_shipment", "percent_of_value"];

export const COST_BASIS_LABEL: Record<CostBasis, string> = {
  per_unit: "Per unit",
  per_shipment: "Per shipment (spread over units)",
  percent_of_value: "% of goods value",
};

export interface SupplierProductRecord {
  id: string;
  supplierId: string;
  supplierName: string | null;
  productId: string;
  sku: string | null;
  productName: string | null;
  supplierPrice: number | null;
  currencyCode: string | null;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  isActive: boolean;
  notes: string | null;
}

export interface CostComponentRecord {
  id: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  shipmentId: string | null;
  shipmentReference: string | null;
  kind: CostComponentKind;
  label: string | null;
  amount: number;
  basis: CostBasis;
  currencyCode: string | null;
  effectiveFrom: string | null;
  notes: string | null;
}

export interface ShipmentLineRecord {
  id: string;
  shipmentId: string;
  purchaseOrderId: string | null;
  poNumber: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  quantity: number;
  unitCost: number | null;
  notes: string | null;
}

export interface ShipmentRecord {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  locationId: string | null;
  locationCode: string | null;
  reference: string;
  mode: string | null;
  status: ShipmentStatus;
  etd: string | null;
  eta: string | null;
  revisedEta: string | null;
  arrivedOn: string | null;
  clearedOn: string | null;
  deliveredOn: string | null;
  incoterm: string | null;
  currencyCode: string | null;
  fxRate: number | null;
  notes: string | null;
  lines: ShipmentLineRecord[];
}

/**
 * The date the goods are currently expected. Actual arrival wins over a
 * revised ETA, which wins over the original ETA. Nothing is invented: when no
 * date is recorded the shipment is simply unscheduled.
 */
export function effectiveEta(s: {
  eta: string | null;
  revisedEta: string | null;
  arrivedOn: string | null;
}): string | null {
  return s.arrivedOn ?? s.revisedEta ?? s.eta ?? null;
}

/** Days late against the originally promised ETA. Null when not derivable. */
export function shipmentDelayDays(s: {
  eta: string | null;
  revisedEta: string | null;
  arrivedOn: string | null;
}): number | null {
  if (!s.eta) return null;
  const current = s.arrivedOn ?? s.revisedEta;
  if (!current) return null;
  const ms = Date.parse(`${current}T00:00:00Z`) - Date.parse(`${s.eta}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000);
}

/** Everything the Supply section renders, in one shape. */
export interface SupplyBook {
  shipments: ShipmentRecord[];
  supplierProducts: SupplierProductRecord[];
  costComponents: CostComponentRecord[];
  products: { id: string; sku: string; name: string }[];
  suppliers: { id: string; name: string }[];
  purchaseOrders: { id: string; poNumber: string | null; sku: string | null }[];
}
