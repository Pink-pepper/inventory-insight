/**
 * Product and supplier master data — the operator's single reference for the
 * portfolio and the people they buy it from. These records reuse the existing
 * `products`, `suppliers` and `supplier_products` tables; nothing here is a
 * parallel store.
 */

export interface ProductSupplyOption {
  supplierId: string;
  supplierName: string;
  supplierPrice: number | null;
  currencyCode: string | null;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  isActive: boolean;
}

export interface ProductMaster {
  id: string;
  sku: string;
  name: string;
  category: string;
  isActive: boolean;
  /** Physical content of one package, in packUom. */
  packSize: number | null;
  packUom: string | null;
  /** Packages currently in stock across locations. */
  unitsInStock: number;
  unitsOnOrder: number;
  /** Default selling price. A transaction may override it without changing this. */
  unitPrice: number | null;
  /** Standing cost. Landed cost refines it where components exist. */
  unitCost: number;
  landedCost: number | null;
  specification: string | null;
  regulatoryNotes: string | null;
  isHazardous: boolean | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  suppliers: ProductSupplyOption[];
}

export function grossProfit(p: ProductMaster): number | null {
  if (p.unitPrice == null) return null;
  const cost = p.landedCost ?? p.unitCost;
  return p.unitPrice - cost;
}

export function marginPct(p: ProductMaster): number | null {
  const gp = grossProfit(p);
  if (gp == null || !p.unitPrice) return null;
  return (gp / p.unitPrice) * 100;
}

export interface SupplierProductLine {
  productId: string;
  sku: string;
  productName: string;
  supplierPrice: number | null;
  currencyCode: string | null;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  isActive: boolean;
}

export interface SupplierMaster {
  id: string;
  name: string;
  code: string | null;
  externalRef: string | null;
  country: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  isActive: boolean;
  notes: string | null;
  leadTimeDays: number;
  minOrderQty: number;
  reliability: number;
  contacts: { id: string; name: string; role: string | null; email: string | null; phone: string | null }[];
  products: SupplierProductLine[];
  /** Shipment performance derived from recorded arrivals; null when unknown. */
  shipmentsTracked: number;
  onTimePct: number | null;
  openPurchaseOrders: number;
}
