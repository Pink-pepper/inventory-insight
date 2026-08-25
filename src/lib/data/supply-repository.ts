/**
 * Supply-side data access — supplier pricing, landed-cost components,
 * shipments and shipment lines.
 *
 * Same contract as the other repositories: storage rows in, domain records
 * out, tenant scoping applied here with a server-derived org id.
 */
import type { Db } from "./repository";
import type {
  CostBasis,
  CostComponentKind,
  CostComponentRecord,
  ShipmentLineRecord,
  ShipmentRecord,
  ShipmentStatus,
  SupplierProductRecord,
  SupplyBook,
} from "@/lib/domain/supply-chain";

type Named = { id: string; name: string } | null;
type Prod = { id: string; sku: string; name: string } | null;

const nm = (v: unknown) => (v as Named)?.name ?? null;
const sku = (v: unknown) => (v as Prod)?.sku ?? null;
const pname = (v: unknown) => (v as Prod)?.name ?? null;
const num = (v: unknown) => (v == null ? null : Number(v));

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listSupplierProducts(
  supabase: Db,
  orgId: string,
): Promise<SupplierProductRecord[]> {
  const { data, error } = await supabase
    .from("supplier_products")
    .select(
      "id, supplier_id, product_id, supplier_price, currency_code, min_order_qty, lead_time_days, is_active, notes, suppliers!supplier_products_supplier_id_fkey(id, name), products!supplier_products_product_id_fkey(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: nm(r.suppliers),
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    supplierPrice: num(r.supplier_price),
    currencyCode: r.currency_code,
    minOrderQty: r.min_order_qty,
    leadTimeDays: r.lead_time_days,
    isActive: r.is_active,
    notes: r.notes,
  }));
}

export async function listCostComponents(
  supabase: Db,
  orgId: string,
): Promise<CostComponentRecord[]> {
  const { data, error } = await supabase
    .from("cost_components")
    .select(
      "id, product_id, supplier_id, shipment_id, kind, label, amount, basis, currency_code, effective_from, notes, suppliers!cost_components_supplier_id_fkey(id, name), products!cost_components_product_id_fkey(id, sku, name), shipments!cost_components_shipment_id_fkey(id, reference)",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    supplierId: r.supplier_id,
    supplierName: nm(r.suppliers),
    shipmentId: r.shipment_id,
    shipmentReference:
      (r.shipments as unknown as { reference: string } | null)?.reference ?? null,
    kind: r.kind as CostComponentKind,
    label: r.label,
    amount: Number(r.amount ?? 0),
    basis: r.basis as CostBasis,
    currencyCode: r.currency_code,
    effectiveFrom: r.effective_from,
    notes: r.notes,
  }));
}

export async function listShipments(supabase: Db, orgId: string): Promise<ShipmentRecord[]> {
  const [{ data, error }, { data: lineRows, error: lineErr }] = await Promise.all([
    supabase
      .from("shipments")
      .select(
        "id, supplier_id, location_id, reference, mode, status, etd, eta, revised_eta, arrived_on, cleared_on, delivered_on, incoterm, currency_code, fx_rate, notes, suppliers!shipments_supplier_id_fkey(id, name), locations!shipments_location_id_fkey(id, code)",
      )
      .eq("org_id", orgId)
      .order("eta", { ascending: true, nullsFirst: false }),
    supabase
      .from("shipment_lines")
      .select(
        "id, shipment_id, purchase_order_id, product_id, quantity, unit_cost, notes, products!shipment_lines_product_id_fkey(id, sku, name), purchase_orders!shipment_lines_purchase_order_id_fkey(id, po_number)",
      )
      .eq("org_id", orgId),
  ]);
  fail(error);
  fail(lineErr);

  const byShipment = new Map<string, ShipmentLineRecord[]>();
  for (const r of lineRows ?? []) {
    const line: ShipmentLineRecord = {
      id: r.id,
      shipmentId: r.shipment_id,
      purchaseOrderId: r.purchase_order_id,
      poNumber:
        (r.purchase_orders as unknown as { po_number: string | null } | null)?.po_number ?? null,
      productId: r.product_id,
      sku: sku(r.products),
      productName: pname(r.products),
      quantity: Number(r.quantity ?? 0),
      unitCost: num(r.unit_cost),
      notes: r.notes,
    };
    const list = byShipment.get(line.shipmentId) ?? [];
    list.push(line);
    byShipment.set(line.shipmentId, list);
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: nm(r.suppliers),
    locationId: r.location_id,
    locationCode: (r.locations as unknown as { code: string } | null)?.code ?? null,
    reference: r.reference,
    mode: r.mode,
    status: r.status as ShipmentStatus,
    etd: r.etd,
    eta: r.eta,
    revisedEta: r.revised_eta,
    arrivedOn: r.arrived_on,
    clearedOn: r.cleared_on,
    deliveredOn: r.delivered_on,
    incoterm: r.incoterm,
    currencyCode: r.currency_code,
    fxRate: num(r.fx_rate),
    notes: r.notes,
    lines: byShipment.get(r.id) ?? [],
  }));
}

/** Everything the Supply section renders, in one round trip. */
export async function loadSupplyBook(supabase: Db, orgId: string): Promise<SupplyBook> {
  const [shipments, supplierProducts, costComponents, productRes, supplierRes, poRes] =
    await Promise.all([
      listShipments(supabase, orgId),
      listSupplierProducts(supabase, orgId),
      listCostComponents(supabase, orgId),
      supabase.from("products").select("id, sku, name").eq("org_id", orgId).order("sku"),
      supabase.from("suppliers").select("id, name").eq("org_id", orgId).order("name"),
      supabase
        .from("purchase_orders")
        .select("id, po_number, products(sku)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
  fail(productRes.error);
  fail(supplierRes.error);
  fail(poRes.error);
  return {
    shipments,
    supplierProducts,
    costComponents,
    products: productRes.data ?? [],
    suppliers: supplierRes.data ?? [],
    purchaseOrders: (poRes.data ?? []).map((r) => ({
      id: r.id,
      poNumber: r.po_number,
      sku: sku(r.products),
    })),
  };
}

/** Tables the generic supply writer is allowed to touch. */
export const SUPPLY_TABLES = [
  "supplier_products",
  "cost_components",
  "shipments",
  "shipment_lines",
] as const;

export type SupplyTable = (typeof SUPPLY_TABLES)[number];

/**
 * Insert or update one supply record. `org_id` is forced from the
 * server-derived tenant, so a client cannot write into another workspace.
 */
export async function saveSupplyRecord(
  supabase: Db,
  orgId: string,
  table: SupplyTable,
  id: string | null,
  values: Record<string, unknown>,
) {
  const payload = { ...values, org_id: orgId } as never;
  if (id) {
    const { error } = await supabase.from(table).update(payload).eq("id", id).eq("org_id", orgId);
    fail(error);
    return id;
  }
  const { data, error } = await supabase.from(table).insert(payload).select("id").single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteSupplyRecord(
  supabase: Db,
  orgId: string,
  table: SupplyTable,
  id: string,
) {
  const { error } = await supabase.from(table).delete().eq("id", id).eq("org_id", orgId);
  fail(error);
}
