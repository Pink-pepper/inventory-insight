import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CanonicalDataset, SkuSignal } from "@/lib/domain/model";
import { evaluateAll } from "@/lib/engine/inventory-engine";

export type Db = SupabaseClient<Database>;

/**
 * Tenant resolution. The organization is ALWAYS derived server-side from the
 * authenticated user's membership — never from client-supplied input.
 */
export async function resolveOrg(supabase: Db, userId: string) {
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(id, name, slug, created_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.organizations) throw new Error("No workspace found for this account.");
  const org = data.organizations as unknown as {
    id: string;
    name: string;
    slug: string;
    created_at: string;
  };
  return { orgId: org.id, org, role: data.role };
}

export async function audit(
  supabase: Db,
  orgId: string,
  userId: string,
  event: string,
  detail: Record<string, string | number | boolean | null> = {},
) {
  await supabase.from("audit_logs").insert({ org_id: orgId, user_id: userId, event, detail });
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Writes a canonical dataset into the tenant's tables (idempotent upserts). */
export async function persistDataset(supabase: Db, orgId: string, dataset: CanonicalDataset) {
  if (dataset.suppliers.length) {
    const { error } = await supabase
      .from("suppliers")
      .upsert(
        dataset.suppliers.map((s) => ({
          org_id: orgId,
          external_ref: s.externalRef,
          name: s.name,
          code: s.code,
          lead_time_days: s.leadTimeDays,
          min_order_qty: s.minOrderQty,
          reliability: s.reliability,
        })),
        { onConflict: "org_id,code" },
      );
    if (error) throw new Error(error.message);
  }

  const { data: suppliers, error: supErr } = await supabase
    .from("suppliers")
    .select("id, code")
    .eq("org_id", orgId);
  if (supErr) throw new Error(supErr.message);
  const supplierIdByCode = new Map((suppliers ?? []).map((s) => [s.code, s.id]));

  if (dataset.products.length) {
    const { error } = await supabase.from("products").upsert(
      dataset.products.map((p) => ({
        org_id: orgId,
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit_cost: p.unitCost,
        supplier_id: supplierIdByCode.get(p.supplierCode) ?? null,
        lead_time_days: p.leadTimeDays,
        min_order_qty: p.minOrderQty,
        safety_stock_days: p.safetyStockDays,
      })),
      { onConflict: "org_id,sku" },
    );
    if (error) throw new Error(error.message);
  }

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, sku")
    .eq("org_id", orgId);
  if (prodErr) throw new Error(prodErr.message);
  const productIdBySku = new Map((products ?? []).map((p) => [p.sku, p.id]));

  const invRows = dataset.inventory
    .filter((i) => productIdBySku.has(i.sku))
    .map((i) => ({
      org_id: orgId,
      product_id: productIdBySku.get(i.sku)!,
      on_hand: i.onHand,
      on_order: i.onOrder,
      location: i.location,
      as_of: i.asOf,
    }));
  for (const part of chunk(invRows, 500)) {
    const { error } = await supabase
      .from("inventory")
      .upsert(part, { onConflict: "org_id,product_id,location" });
    if (error) throw new Error(error.message);
  }

  const saleRows = dataset.sales
    .filter((s) => productIdBySku.has(s.sku))
    .map((s) => ({
      org_id: orgId,
      product_id: productIdBySku.get(s.sku)!,
      period_month: s.periodMonth,
      quantity: s.quantity,
      revenue: s.revenue,
    }));
  for (const part of chunk(saleRows, 500)) {
    const { error } = await supabase
      .from("sales")
      .upsert(part, { onConflict: "org_id,product_id,period_month" });
    if (error) throw new Error(error.message);
  }

  return { products: dataset.products.length, sales: saleRows.length, inventory: invRows.length };
}

export interface LoadedSku extends SkuSignal {
  productId: string;
  supplierCode: string;
}

/** Reads the canonical model back out and shapes it for the decision engine. */
export async function loadSignals(supabase: Db, orgId: string): Promise<LoadedSku[]> {
  const [{ data: products, error: pErr }, { data: inventory, error: iErr }, { data: sales, error: sErr }] =
    await Promise.all([
      supabase
        .from("products")
        .select(
          "id, sku, name, category, unit_cost, lead_time_days, min_order_qty, safety_stock_days, suppliers(name, code, lead_time_days, min_order_qty)",
        )
        .eq("org_id", orgId),
      supabase.from("inventory").select("product_id, on_hand, on_order").eq("org_id", orgId),
      supabase.from("sales").select("product_id, period_month, quantity").eq("org_id", orgId),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  if (sErr) throw new Error(sErr.message);

  const invByProduct = new Map((inventory ?? []).map((i) => [i.product_id, i]));
  const salesByProduct = new Map<string, { periodMonth: string; quantity: number }[]>();
  for (const s of sales ?? []) {
    const list = salesByProduct.get(s.product_id) ?? [];
    list.push({ periodMonth: s.period_month, quantity: Number(s.quantity) });
    salesByProduct.set(s.product_id, list);
  }

  return (products ?? []).map((p) => {
    const supplier = p.suppliers as unknown as {
      name: string;
      code: string;
      lead_time_days: number;
      min_order_qty: number;
    } | null;
    const inv = invByProduct.get(p.id);
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unitCost: Number(p.unit_cost),
      supplierName: supplier?.name ?? "Unassigned",
      supplierCode: supplier?.code ?? "—",
      leadTimeDays: p.lead_time_days ?? supplier?.lead_time_days ?? 14,
      minOrderQty: p.min_order_qty ?? supplier?.min_order_qty ?? 1,
      safetyStockDays: p.safety_stock_days,
      onHand: Number(inv?.on_hand ?? 0),
      onOrder: Number(inv?.on_order ?? 0),
      monthlySales: salesByProduct.get(p.id) ?? [],
    };
  });
}

/** Runs the decision engine over the tenant's canonical data and stores results. */
export async function regenerateRecommendations(supabase: Db, orgId: string) {
  const signals = await loadSignals(supabase, orgId);
  const bySku = new Map(signals.map((s) => [s.sku, s]));
  const results = evaluateAll(signals);

  const rows = results.map((r) => ({
    org_id: orgId,
    product_id: bySku.get(r.sku)!.productId,
    action: r.action,
    recommended_qty: r.recommendedQty,
    estimated_cost: r.estimatedCost,
    avg_monthly_demand: r.avgMonthlyDemand,
    avg_daily_demand: r.avgDailyDemand,
    days_of_cover: r.daysOfCover,
    safety_stock: r.safetyStock,
    reorder_point: r.reorderPoint,
    reason: r.reason,
    generated_at: new Date().toISOString(),
  }));

  for (const part of chunk(rows, 500)) {
    const { error } = await supabase
      .from("recommendations")
      .upsert(part, { onConflict: "org_id,product_id" });
    if (error) throw new Error(error.message);
  }
  return { evaluated: results.length };
}

/** Joins stored signals with engine output for presentation. */
export async function buildRecommendationView(supabase: Db, orgId: string) {
  const signals = await loadSignals(supabase, orgId);
  const results = evaluateAll(signals);
  const signalBySku = new Map(signals.map((s) => [s.sku, s]));
  return results.map((r) => {
    const s = signalBySku.get(r.sku)!;
    return { ...r, ...s };
  });
}

export type RecommendationRow = Awaited<ReturnType<typeof buildRecommendationView>>[number];