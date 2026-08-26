/**
 * Product and supplier master data access.
 *
 * Reads the existing product, inventory, supplier and supplier_products
 * tables and folds in the landed-cost engine's answer. There is no second
 * store and no second cost calculation.
 */
import type { Db } from "./repository";
import type {
  ProductMaster,
  ProductSupplyOption,
  SupplierMaster,
  SupplierProductLine,
} from "@/lib/domain/master-data";
import { computeLandedCost, selectComponents } from "@/lib/economics/landed-cost";
import { listCostComponents, listSupplierProducts } from "./supply-repository";

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const n = (v: unknown) => (v == null ? null : Number(v));

export async function loadProductMaster(supabase: Db, orgId: string): Promise<ProductMaster[]> {
  const [{ data: products, error: pErr }, { data: inventory, error: iErr }, supplierProducts, components] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, sku, name, category, unit_cost, unit_price, is_active, pack_size, pack_uom, specification, regulatory_notes, is_hazardous, lead_time_days, min_order_qty, supplier_id",
        )
        .eq("org_id", orgId)
        .order("sku"),
      supabase.from("inventory").select("product_id, on_hand, on_order").eq("org_id", orgId),
      listSupplierProducts(supabase, orgId),
      listCostComponents(supabase, orgId),
    ]);
  fail(pErr);
  fail(iErr);

  const stock = new Map<string, { onHand: number; onOrder: number }>();
  for (const row of inventory ?? []) {
    const cur = stock.get(row.product_id) ?? { onHand: 0, onOrder: 0 };
    cur.onHand += Number(row.on_hand ?? 0);
    cur.onOrder += Number(row.on_order ?? 0);
    stock.set(row.product_id, cur);
  }

  const optionsByProduct = new Map<string, ProductSupplyOption[]>();
  for (const sp of supplierProducts) {
    if (!sp.productId || !sp.supplierId) continue;
    const list = optionsByProduct.get(sp.productId) ?? [];
    list.push({
      supplierId: sp.supplierId,
      supplierName: sp.supplierName ?? "Supplier",
      supplierPrice: sp.supplierPrice,
      currencyCode: sp.currencyCode,
      minOrderQty: sp.minOrderQty,
      leadTimeDays: sp.leadTimeDays,
      isActive: sp.isActive,
    });
    optionsByProduct.set(sp.productId, list);
  }

  return (products ?? []).map((p) => {
    const options = optionsByProduct.get(p.id) ?? [];
    const preferred =
      options.find((o) => o.isActive && o.supplierPrice != null) ??
      options.find((o) => o.supplierPrice != null) ??
      null;
    const scoped = selectComponents(components, {
      productId: p.id,
      supplierId: preferred?.supplierId ?? p.supplier_id ?? null,
      shipmentId: null,
    });
    const landed =
      preferred?.supplierPrice != null || scoped.length > 0
        ? computeLandedCost({
            quantity: 1,
            supplierPrice: preferred?.supplierPrice ?? null,
            components: scoped.map((c) => ({ kind: c.kind, amount: c.amount, basis: c.basis })),
            fallbackUnitCost: Number(p.unit_cost ?? 0),
            sellingPrice: n(p.unit_price),
          }).landedUnitCost
        : null;

    const s = stock.get(p.id) ?? { onHand: 0, onOrder: 0 };
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      isActive: p.is_active,
      packSize: n(p.pack_size),
      packUom: p.pack_uom,
      unitsInStock: s.onHand,
      unitsOnOrder: s.onOrder,
      unitPrice: n(p.unit_price),
      unitCost: Number(p.unit_cost ?? 0),
      landedCost: landed,
      specification: p.specification,
      regulatoryNotes: p.regulatory_notes,
      isHazardous: p.is_hazardous,
      leadTimeDays: p.lead_time_days,
      minOrderQty: p.min_order_qty,
      suppliers: options,
    } satisfies ProductMaster;
  });
}

export async function loadSupplierMaster(supabase: Db, orgId: string): Promise<SupplierMaster[]> {
  const [
    { data: suppliers, error: sErr },
    { data: contacts, error: cErr },
    { data: shipments, error: shErr },
    { data: pos, error: poErr },
    supplierProducts,
  ] = await Promise.all([
    supabase
      .from("suppliers")
      .select(
        "id, name, code, external_ref, country, payment_terms, incoterm, is_active, notes, lead_time_days, min_order_qty, reliability",
      )
      .eq("org_id", orgId)
      .order("name"),
    supabase.from("contacts").select("id, name, role, email, phone, notes").eq("org_id", orgId),
    supabase
      .from("shipments")
      .select("supplier_id, eta, revised_eta, arrived_on, status")
      .eq("org_id", orgId),
    supabase.from("purchase_orders").select("supplier_id, status").eq("org_id", orgId),
    listSupplierProducts(supabase, orgId),
  ]);
  fail(sErr);
  fail(cErr);
  fail(shErr);
  fail(poErr);

  const linesBySupplier = new Map<string, SupplierProductLine[]>();
  for (const sp of supplierProducts) {
    if (!sp.supplierId || !sp.productId) continue;
    const list = linesBySupplier.get(sp.supplierId) ?? [];
    list.push({
      productId: sp.productId,
      sku: sp.sku ?? "",
      productName: sp.productName ?? "",
      supplierPrice: sp.supplierPrice,
      currencyCode: sp.currencyCode,
      minOrderQty: sp.minOrderQty,
      leadTimeDays: sp.leadTimeDays,
      isActive: sp.isActive,
    });
    linesBySupplier.set(sp.supplierId, list);
  }

  // On-time performance is only reported where an arrival was actually
  // recorded against a promised date. No arrivals, no percentage.
  const perf = new Map<string, { tracked: number; onTime: number }>();
  for (const s of shipments ?? []) {
    if (!s.supplier_id || !s.arrived_on) continue;
    const promised = s.revised_eta ?? s.eta;
    if (!promised) continue;
    const cur = perf.get(s.supplier_id) ?? { tracked: 0, onTime: 0 };
    cur.tracked += 1;
    if (s.arrived_on <= promised) cur.onTime += 1;
    perf.set(s.supplier_id, cur);
  }

  const openPos = new Map<string, number>();
  for (const po of pos ?? []) {
    if (!po.supplier_id) continue;
    if (po.status !== "placed" && po.status !== "draft") continue;
    openPos.set(po.supplier_id, (openPos.get(po.supplier_id) ?? 0) + 1);
  }

  return (suppliers ?? []).map((s) => {
    const p = perf.get(s.id);
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      externalRef: s.external_ref,
      country: s.country,
      paymentTerms: s.payment_terms,
      incoterm: s.incoterm,
      isActive: s.is_active,
      notes: s.notes,
      leadTimeDays: s.lead_time_days,
      minOrderQty: s.min_order_qty,
      reliability: Number(s.reliability ?? 0),
      // Contacts are customer-linked in the current model; only unassigned
      // contacts are shown here, and none are invented for a supplier.
      contacts: (contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
      })),

      products: linesBySupplier.get(s.id) ?? [],
      shipmentsTracked: p?.tracked ?? 0,
      onTimePct: p && p.tracked > 0 ? (p.onTime / p.tracked) * 100 : null,
      openPurchaseOrders: openPos.get(s.id) ?? 0,
    } satisfies SupplierMaster;
  });
}

export async function updateProductMaster(
  supabase: Db,
  orgId: string,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase.from("products").update(values).eq("org_id", orgId).eq("id", id);
  fail(error);
}

export async function updateSupplierMaster(
  supabase: Db,
  orgId: string,
  id: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase.from("suppliers").update(values).eq("org_id", orgId).eq("id", id);
  fail(error);
}
