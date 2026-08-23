import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type {
  AuditDetailValue,
  AuditEvent,
  CanonicalDataset,
  CanonicalForecast,
  CanonicalPurchaseOrder,
  ConnectorType,
  DataSource,
  InventoryPosition,
  Organization,
  PurchaseOrderApprovalStatus,
  PurchaseOrderRecord,
  PurchaseOrderStatus,
  RunProvenance,
  SkuSignal,
  UserProfile,
} from "@/lib/domain/model";
import {
  EMPTY_PLANNING_POLICY,
  type PlanningPolicy,
  type ProductDisplay,
  type DemandMethod,
} from "@/lib/domain/planning-policy";
import { evaluateAll, resolveEngineConfig } from "@/lib/engine/inventory-engine";
import { rowHash } from "@/lib/ingestion/validate";
import type { DemandFact } from "@/lib/demand/series";
import type { PlanningFilter } from "@/lib/query/filters";
import type { ScenarioAssumptions } from "@/lib/scenario/assumptions";
import type { ScenarioRunResult } from "@/lib/scenario/run";
import type {
  ScenarioRecord,
  ScenarioRunRecord,
  ScenarioRunSummaryRecord,
} from "@/lib/scenario/types";

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
  const organization: Organization = { id: org.id, name: org.name, slug: org.slug };
  return { orgId: org.id, org: organization, role: data.role };
}

/** The signed-in user's profile, mapped out of the storage row shape. */
export async function getProfile(supabase: Db, userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { name: data?.full_name ?? "", email: data?.email ?? "" };
}

/** Ingestion sources for a workspace, as domain objects. */
export async function listDataSources(supabase: Db, orgId: string): Promise<DataSource[]> {
  const { data, error } = await supabase
    .from("data_sources")
    .select("id, name, connector, status, last_sync_at, rows_ingested, error_count")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    connector: row.connector as ConnectorType,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    rowsIngested: row.rows_ingested ?? 0,
    errorCount: row.error_count ?? 0,
  }));
}

/** Recent workspace activity, as domain objects. */
export async function listAuditEvents(
  supabase: Db,
  orgId: string,
  limit = 50,
): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, event, detail, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    event: row.event,
    detail: (row.detail ?? {}) as Record<string, AuditDetailValue>,
    occurredAt: row.created_at,
  }));
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
        ...(p.unitPrice == null ? {} : { unit_price: p.unitPrice }),
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
      ...(s.cogs == null ? {} : { cogs: s.cogs }),
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

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * The organisation's planning policy, or null when it has never configured one.
 * Null is meaningful: the engine then runs on its documented defaults.
 */
export async function getPlanningPolicy(
  supabase: Db,
  orgId: string,
): Promise<PlanningPolicy | null> {
  const { data, error } = await supabase
    .from("planning_policies")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    demandWindowMonths: data.demand_window_months,
    planningHorizonDays: data.planning_horizon_days,
    safetyStockDays: data.safety_stock_days,
    defaultLeadTimeDays: data.default_lead_time_days,
    defaultMinOrderQty: data.default_min_order_qty,
    orderMultiple: data.order_multiple,
    reorderPointOverride: numOrNull(data.reorder_point_override),
    minimumStockLevel: numOrNull(data.minimum_stock_level),
    targetStockLevel: numOrNull(data.target_stock_level),
    daysOfCoverTarget: numOrNull(data.days_of_cover_target),
    serviceLevel: numOrNull(data.service_level),
    demandMethod: (data.demand_method as DemandMethod | null) ?? null,
    demandGrowthPct: numOrNull(data.demand_growth_pct),
    seasonalityEnabled: data.seasonality_enabled,
    demandVariability: numOrNull(data.demand_variability),
    leadTimeVariabilityDays: numOrNull(data.lead_time_variability_days),
    productDisplay: (data.product_display as ProductDisplay) ?? "sku_name",
  };
}

/** The effective policy for display purposes: defaults when nothing is configured. */
export async function getEffectivePolicy(supabase: Db, orgId: string): Promise<PlanningPolicy> {
  return (await getPlanningPolicy(supabase, orgId)) ?? EMPTY_PLANNING_POLICY;
}

/** Creates or updates the tenant's policy. Role enforcement lives in RLS. */
export async function savePlanningPolicy(
  supabase: Db,
  orgId: string,
  policy: PlanningPolicy,
): Promise<PlanningPolicy> {
  const { error } = await supabase.from("planning_policies").upsert(
    {
      org_id: orgId,
      demand_window_months: policy.demandWindowMonths,
      planning_horizon_days: policy.planningHorizonDays,
      safety_stock_days: policy.safetyStockDays,
      default_lead_time_days: policy.defaultLeadTimeDays,
      default_min_order_qty: policy.defaultMinOrderQty,
      order_multiple: policy.orderMultiple,
      reorder_point_override: policy.reorderPointOverride,
      minimum_stock_level: policy.minimumStockLevel,
      target_stock_level: policy.targetStockLevel,
      days_of_cover_target: policy.daysOfCoverTarget,
      service_level: policy.serviceLevel,
      demand_method: policy.demandMethod,
      demand_growth_pct: policy.demandGrowthPct,
      seasonality_enabled: policy.seasonalityEnabled,
      demand_variability: policy.demandVariability,
      lead_time_variability_days: policy.leadTimeVariabilityDays,
      product_display: policy.productDisplay,
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(error.message);
  return (await getPlanningPolicy(supabase, orgId)) ?? policy;
}

/** Reads the canonical model back out and shapes it for the decision engine. */
export async function loadSignals(
  supabase: Db,
  orgId: string,
  policy: PlanningPolicy | null = null,
): Promise<LoadedSku[]> {
  const [
    { data: products, error: pErr },
    { data: inventory, error: iErr },
    { data: sales, error: sErr },
    { data: openPos, error: poErr },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, sku, name, category, unit_cost, lead_time_days, min_order_qty, safety_stock_days, suppliers(name, code, lead_time_days, min_order_qty)",
      )
      .eq("org_id", orgId),
    supabase
      .from("inventory")
      .select("product_id, on_hand, on_order, location, as_of")
      .eq("org_id", orgId),
    supabase.from("sales").select("product_id, period_month, quantity").eq("org_id", orgId),
    supabase
      .from("purchase_orders")
      .select("product_id, expected_at")
      .eq("org_id", orgId)
      .eq("status", "placed")
      .not("expected_at", "is", null),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  if (sErr) throw new Error(sErr.message);
  if (poErr) throw new Error(poErr.message);

  // Location context is preserved: every position is kept and the planning
  // figure is the aggregate, never a silently-dropped single row.
  const positionsByProduct = new Map<string, InventoryPosition[]>();
  for (const i of inventory ?? []) {
    const list = positionsByProduct.get(i.product_id) ?? [];
    list.push({
      location: i.location,
      onHand: Number(i.on_hand),
      onOrder: Number(i.on_order),
      asOf: i.as_of,
    });
    positionsByProduct.set(i.product_id, list);
  }

  const arrivalByProduct = new Map<string, string>();
  for (const po of openPos ?? []) {
    if (!po.product_id || !po.expected_at) continue;
    const current = arrivalByProduct.get(po.product_id);
    if (!current || po.expected_at < current) arrivalByProduct.set(po.product_id, po.expected_at);
  }

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
    const positions = positionsByProduct.get(p.id) ?? [];
    // No invented lead time: if neither the product nor the supplier declares
    // one, it stays null and the engine reports it as a data-quality block.
    const productLead = p.lead_time_days && p.lead_time_days > 0 ? p.lead_time_days : null;
    const supplierLead =
      supplier?.lead_time_days && supplier.lead_time_days > 0 ? supplier.lead_time_days : null;
    // Policy defaults are a last resort only: they never override a lead time
    // that the product or supplier actually declares.
    const policyLead =
      policy?.defaultLeadTimeDays && policy.defaultLeadTimeDays > 0
        ? policy.defaultLeadTimeDays
        : null;
    const leadTimeDays = productLead ?? supplierLead ?? policyLead;
    const leadTimeSource: SkuSignal["leadTimeSource"] =
      productLead != null ? "product" : supplierLead != null ? "supplier" : "missing";
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unitCost: Number(p.unit_cost),
      supplierName: supplier?.name ?? "Unassigned",
      supplierCode: supplier?.code ?? "—",
      leadTimeDays,
      leadTimeSource,
      minOrderQty: p.min_order_qty ?? supplier?.min_order_qty ?? policy?.defaultMinOrderQty ?? 1,
      safetyStockDays: p.safety_stock_days ?? policy?.safetyStockDays ?? 0,
      onHand: positions.reduce((sum, l) => sum + l.onHand, 0),
      onOrder: positions.reduce((sum, l) => sum + l.onOrder, 0),
      locations: positions,
      expectedArrival: arrivalByProduct.get(p.id) ?? null,
      monthlySales: salesByProduct.get(p.id) ?? [],
    };
  });
}

/** Runs the decision engine over the tenant's canonical data and stores results. */
export async function regenerateRecommendations(supabase: Db, orgId: string) {
  const policy = await getPlanningPolicy(supabase, orgId);
  const signals = await loadSignals(supabase, orgId, policy);
  const bySku = new Map(signals.map((s) => [s.sku, s]));
  const results = evaluateAll(signals, resolveEngineConfig(policy));

  // Provenance: one run id per regeneration, stamped on every row it produced.
  const runId = crypto.randomUUID();
  const runStartedAt = new Date().toISOString();

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
    run_id: runId,
    run_started_at: runStartedAt,
  }));

  for (const part of chunk(rows, 500)) {
    const { error } = await supabase
      .from("recommendations")
      .upsert(part, { onConflict: "org_id,product_id" });
    if (error) throw new Error(error.message);
  }
  return {
    evaluated: results.length,
    runId,
    runStartedAt,
    blocked: results.filter((r) => r.blocked).length,
  };
}

/** Provenance of the most recent stored run, for the "when was this generated" question. */
export async function getLastRun(supabase: Db, orgId: string): Promise<RunProvenance | null> {
  const { data, error } = await supabase
    .from("recommendations")
    .select("run_id, run_started_at, generated_at")
    .eq("org_id", orgId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    runId: data.run_id,
    runStartedAt: data.run_started_at,
    generatedAt: data.generated_at,
  };
}

/** Joins stored signals with engine output for presentation. */
export async function buildRecommendationView(supabase: Db, orgId: string) {
  const policy = await getPlanningPolicy(supabase, orgId);
  const signals = await loadSignals(supabase, orgId, policy);
  const results = evaluateAll(signals, resolveEngineConfig(policy));
  const signalBySku = new Map(signals.map((s) => [s.sku, s]));
  return results.map((r) => {
    const s = signalBySku.get(r.sku)!;
    return { ...r, ...s };
  });
}

export type RecommendationRow = Awaited<ReturnType<typeof buildRecommendationView>>[number];

/** Metadata recorded for every spreadsheet import, so any row can be traced back. */
export interface ImportBatchInput {
  source: "csv" | "xlsx" | "demo";
  filename: string;
  sheetSummary: { sheet: string; kind: string; rows: number }[];
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  warnings: number;
}

/** Creates the provenance record an import's rows point at. */
export async function createImportBatch(
  supabase: Db,
  orgId: string,
  userId: string,
  input: ImportBatchInput,
): Promise<string> {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      org_id: orgId,
      created_by: userId,
      source: input.source,
      filename: input.filename,
      sheet_summary: input.sheetSummary,
      rows_read: input.rowsRead,
      rows_accepted: input.rowsAccepted,
      rows_rejected: input.rowsRejected,
      warnings: input.warnings,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// ---------------------------------------------------------------------------
// Import batch lifecycle (active -> inactive -> deleted)
// ---------------------------------------------------------------------------

export type ImportLifecycle = "active" | "inactive" | "deleted";

export interface ImportBatchRecord {
  id: string;
  filename: string;
  source: string;
  status: string;
  lifecycle: ImportLifecycle;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  warnings: number;
  sheets: { sheet: string; kind: string; rows: number; confidence?: string; role?: string }[];
  createdAt: string;
  transactions: number;
  purchaseOrders: number;
}

export function lifecycleOf(status: string): ImportLifecycle {
  if (status === "deleted") return "deleted";
  return status === "inactive" ? "inactive" : "active";
}

/** Ids of inactive batches — their rows never feed planning facts. */
export async function inactiveBatchIds(supabase: Db, orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "inactive");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id);
}

/** All non-deleted batches for the workspace, with row counts, newest first. */
export async function listImportBatches(supabase: Db, orgId: string): Promise<ImportBatchRecord[]> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(
      "id, filename, source, status, rows_read, rows_accepted, rows_rejected, warnings, sheet_summary, created_at",
    )
    .eq("org_id", orgId)
    .neq("status", "deleted")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const batches = data ?? [];
  return Promise.all(
    batches.map(async (b) => {
      const [tx, po] = await Promise.all([
        supabase
          .from("sales_transactions")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("import_batch_id", b.id),
        supabase
          .from("purchase_orders")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("import_batch_id", b.id),
      ]);
      if (tx.error) throw new Error(tx.error.message);
      if (po.error) throw new Error(po.error.message);
      const sheets = Array.isArray(b.sheet_summary)
        ? (b.sheet_summary as { sheet: string; kind: string; rows: number; confidence?: string; role?: string }[])
        : [];
      return {
        id: b.id,
        filename: b.filename,
        source: b.source,
        status: b.status,
        lifecycle: lifecycleOf(b.status),
        rowsRead: b.rows_read,
        rowsAccepted: b.rows_accepted,
        rowsRejected: b.rows_rejected,
        warnings: b.warnings,
        sheets,
        createdAt: b.created_at,
        transactions: tx.count ?? 0,
        purchaseOrders: po.count ?? 0,
      } satisfies ImportBatchRecord;
    }),
  );
}

export interface ImportBatchMeta {
  id: string;
  filename: string;
  source: string;
  status: string;
}

export async function getImportBatch(
  supabase: Db,
  orgId: string,
  batchId: string,
): Promise<ImportBatchMeta | null> {
  const { data, error } = await supabase
    .from("import_batches")
    .select("id, filename, source, status")
    .eq("org_id", orgId)
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Transition a batch status. Returns true when a row was actually updated. */
export async function setImportBatchStatus(
  supabase: Db,
  orgId: string,
  batchId: string,
  status: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("import_batches")
    .update({ status })
    .eq("org_id", orgId)
    .eq("id", batchId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** First-of-month date for a YYYY-MM-DD day — the `sales.period_month` convention. */
function monthKey(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Distinct products and months a batch's transactions touched — the aggregate
 *  cells that must be rebuilt when the batch is (de)activated or deleted. */
export async function batchDemandFootprint(
  supabase: Db,
  orgId: string,
  batchId: string,
): Promise<{ productIds: string[]; months: string[] }> {
  const { data, error } = await supabase
    .from("sales_transactions")
    .select("product_id, occurred_on")
    .eq("org_id", orgId)
    .eq("import_batch_id", batchId);
  if (error) throw new Error(error.message);
  const productIds = new Set<string>();
  const months = new Set<string>();
  for (const row of data ?? []) {
    productIds.add(row.product_id);
    months.add(monthKey(row.occurred_on));
  }
  return { productIds: [...productIds], months: [...months] };
}

/** Rebuild the monthly demand grain for specific products/months only. Rows
 *  derived from inactive batches are never written back. */
export async function rebuildMonthlyForProducts(
  supabase: Db,
  orgId: string,
  productIds: string[],
  months: string[],
  excludeBatchIds: string[],
): Promise<number> {
  if (productIds.length === 0) return 0;
  for (const part of chunk(productIds, 100)) {
    let query = supabase.from("sales").delete().eq("org_id", orgId).in("product_id", part);
    if (months.length > 0) query = query.in("period_month", months);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }
  return refreshMonthlySales(supabase, orgId, productIds, excludeBatchIds);
}

/** Permanently remove a batch's fact rows. Master data (products, suppliers,
 *  customers, channels, locations) is shared and is never removed here. */
export async function deleteBatchRows(
  supabase: Db,
  orgId: string,
  batchId: string,
): Promise<{ transactions: number; purchaseOrders: number; forecasts: number }> {
  const tx = await supabase
    .from("sales_transactions")
    .delete()
    .eq("org_id", orgId)
    .eq("import_batch_id", batchId)
    .select("id");
  if (tx.error) throw new Error(tx.error.message);
  const po = await supabase
    .from("purchase_orders")
    .delete()
    .eq("org_id", orgId)
    .eq("import_batch_id", batchId)
    .select("id");
  if (po.error) throw new Error(po.error.message);
  const fc = await supabase
    .from("demand_forecasts")
    .delete()
    .eq("org_id", orgId)
    .eq("import_batch_id", batchId)
    .select("id");
  if (fc.error) throw new Error(fc.error.message);
  return {
    transactions: (tx.data ?? []).length,
    purchaseOrders: (po.data ?? []).length,
    forecasts: (fc.data ?? []).length,
  };
}

type CustomerRow = Database["public"]["Tables"]["customers"]["Insert"];
type ChannelRow = Database["public"]["Tables"]["channels"]["Insert"];
type TransactionRow = Database["public"]["Tables"]["sales_transactions"]["Insert"];

async function upsertCustomers(supabase: Db, rows: CustomerRow[]) {
  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("customers").upsert(part, { onConflict: "org_id,external_ref" });
    if (error) throw new Error(error.message);
  }
}

async function upsertChannels(supabase: Db, rows: ChannelRow[]) {
  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("channels").upsert(part, { onConflict: "org_id,code" });
    if (error) throw new Error(error.message);
  }
}

export interface TransactionPersistResult {
  inserted: number;
  duplicates: number;
  unknownSkus: string[];
  monthsRefreshed: number;
}

/**
 * Writes day-grain demand lines and refreshes the monthly grain the planning
 * engine reads. Rows whose fingerprint already exists are treated as a
 * re-import and skipped rather than double counted.
 */
export async function persistTransactions(
  supabase: Db,
  orgId: string,
  dataset: CanonicalDataset,
  batchId: string | null,
): Promise<TransactionPersistResult> {
  const transactions = dataset.transactions ?? [];
  if (transactions.length === 0) {
    return { inserted: 0, duplicates: 0, unknownSkus: [], monthsRefreshed: 0 };
  }

  await upsertCustomers(
    supabase,
    (dataset.customers ?? []).map((c) => ({
      org_id: orgId,
      external_ref: c.externalRef,
      name: c.name,
      segment: c.segment ?? null,
    })),
  );
  await upsertChannels(
    supabase,
    (dataset.channels ?? []).map((c) => ({ org_id: orgId, code: c.code, name: c.name })),
  );

  const [{ data: products, error: pErr }, { data: customers, error: cErr }, { data: channels, error: chErr }, { data: locations, error: lErr }] =
    await Promise.all([
      supabase.from("products").select("id, sku").eq("org_id", orgId),
      supabase.from("customers").select("id, external_ref").eq("org_id", orgId),
      supabase.from("channels").select("id, code").eq("org_id", orgId),
      supabase.from("locations").select("id, code").eq("org_id", orgId),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (cErr) throw new Error(cErr.message);
  if (chErr) throw new Error(chErr.message);
  if (lErr) throw new Error(lErr.message);

  const productIdBySku = new Map((products ?? []).map((p) => [p.sku, p.id]));
  const customerIdByRef = new Map((customers ?? []).map((c) => [c.external_ref, c.id]));
  const channelIdByCode = new Map((channels ?? []).map((c) => [c.code, c.id]));
  const locationIdByCode = new Map((locations ?? []).map((l) => [l.code, l.id]));

  // Re-import detection: a row whose fingerprint already exists is not written again.
  const hashes = [...new Set(transactions.map((t) => t.rowHash))];
  const existing = new Set<string>();
  for (const part of chunk(hashes, 500)) {
    const { data, error } = await supabase
      .from("sales_transactions")
      .select("source_row_hash")
      .eq("org_id", orgId)
      .in("source_row_hash", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) existing.add(row.source_row_hash);
  }

  const unknown = new Set<string>();
  const seen = new Set<string>();
  const affected = new Set<string>();
  const rows: TransactionRow[] = [];
  let duplicates = 0;

  for (const tx of transactions) {
    const productId = productIdBySku.get(tx.sku);
    if (!productId) {
      unknown.add(tx.sku);
      continue;
    }
    if (existing.has(tx.rowHash) || seen.has(tx.rowHash)) {
      duplicates++;
      continue;
    }
    seen.add(tx.rowHash);
    affected.add(productId);
    rows.push({
      org_id: orgId,
      product_id: productId,
      occurred_on: tx.occurredOn,
      quantity: tx.quantity,
      value: tx.value ?? null,
      unit_price: tx.unitPrice ?? null,
      cogs: tx.cogs ?? null,
      customer_id: tx.customerRef ? (customerIdByRef.get(tx.customerRef) ?? null) : null,
      channel_id: tx.channelCode ? (channelIdByCode.get(tx.channelCode) ?? null) : null,
      location_id: tx.location ? (locationIdByCode.get(tx.location) ?? null) : null,
      region: tx.region ?? null,
      state_province: tx.stateProvince ?? null,
      currency_code: tx.currencyCode ?? null,
      original_amount: tx.originalAmount ?? null,
      source_ref: tx.sourceRef ?? null,
      source_row_hash: tx.rowHash,
      import_batch_id: batchId,
    });
  }

  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("sales_transactions").insert(part);
    if (error) throw new Error(error.message);
  }

  // Inactive imports never contribute to the monthly grain the engine reads.
  const monthsRefreshed = await refreshMonthlySales(
    supabase,
    orgId,
    [...affected],
    await inactiveBatchIds(supabase, orgId),
  );
  return { inserted: rows.length, duplicates, unknownSkus: [...unknown].slice(0, 25), monthsRefreshed };
}

/**
 * Rebuilds the monthly `sales` grain from stored transactions for the given
 * products. Monthly remains the engine's read path; transactions are the
 * source of truth wherever they exist.
 */
export async function refreshMonthlySales(
  supabase: Db,
  orgId: string,
  productIds: string[],
  excludeBatchIds: string[] = [],
): Promise<number> {
  if (productIds.length === 0) return 0;
  const totals = new Map<string, { productId: string; month: string; quantity: number; revenue: number; cogs: number | null }>();

  for (const part of chunk(productIds, 100)) {
    let query = supabase
      .from("sales_transactions")
      .select("product_id, occurred_on, quantity, value, unit_price, cogs")
      .eq("org_id", orgId)
      .in("product_id", part);
    if (excludeBatchIds.length > 0) {
      query = query.not("import_batch_id", "in", `(${excludeBatchIds.join(",")})`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const month = `${row.occurred_on.slice(0, 7)}-01`;
      const key = `${row.product_id}|${month}`;
      const qty = Number(row.quantity);
      const value = row.value != null ? Number(row.value) : row.unit_price != null ? Number(row.unit_price) * qty : 0;
      const current = totals.get(key) ?? { productId: row.product_id, month, quantity: 0, revenue: 0, cogs: null };
      current.quantity += qty;
      current.revenue += value;
      if (row.cogs != null) current.cogs = (current.cogs ?? 0) + Number(row.cogs);
      totals.set(key, current);
    }
  }

  const rows = [...totals.values()].map((t) => ({
    org_id: orgId,
    product_id: t.productId,
    period_month: t.month,
    quantity: t.quantity,
    revenue: t.revenue,
    ...(t.cogs == null ? {} : { cogs: t.cogs }),
  }));
  for (const part of chunk(rows, 500)) {
    const { error } = await supabase.from("sales").upsert(part, { onConflict: "org_id,product_id,period_month" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
/**
 * Loads every demand observation for a workspace as flat facts.
 *
 * Both grains are returned side by side and tagged with their source; the
 * demand module decides which one may legitimately answer a given question.
 * Monthly rows are never split into days to satisfy a finer grain.
 */
export async function loadDemandFacts(supabase: Db, orgId: string): Promise<DemandFact[]> {
  const inactive = await inactiveBatchIds(supabase, orgId);
  let txQuery = supabase
    .from("sales_transactions")
    .select(
      "product_id, occurred_on, quantity, value, cogs, region, state_province, customers(external_ref, name), channels(code, name), locations(code, name, country, region, state_province)",
    )
    .eq("org_id", orgId);
  if (inactive.length > 0) {
    txQuery = txQuery.not("import_batch_id", "in", `(${inactive.join(",")})`);
  }
  const [{ data: products, error: pErr }, { data: monthly, error: mErr }, { data: txns, error: tErr }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, sku, name, category, suppliers(name, code)")
        .eq("org_id", orgId),
      supabase
        .from("sales")
        .select("product_id, period_month, quantity, revenue, cogs")
        .eq("org_id", orgId),
      txQuery,
    ]);
  if (pErr) throw new Error(pErr.message);
  if (mErr) throw new Error(mErr.message);
  if (tErr) throw new Error(tErr.message);

  const productById = new Map(
    (products ?? []).map((p) => {
      const supplier = p.suppliers as unknown as { name: string; code: string } | null;
      return [
        p.id,
        {
          sku: p.sku,
          name: p.name,
          category: p.category,
          supplierName: supplier?.name ?? "Unassigned",
          supplierCode: supplier?.code ?? "",
        },
      ] as const;
    }),
  );

  const facts: DemandFact[] = [];

  for (const s of monthly ?? []) {
    const p = productById.get(s.product_id);
    if (!p) continue;
    facts.push({
      ...p,
      date: s.period_month,
      quantity: Number(s.quantity),
      revenue: s.revenue == null ? null : Number(s.revenue),
      cogs: s.cogs == null ? null : Number(s.cogs),
      channelCode: null,
      channelName: null,
      customerRef: null,
      customerName: null,
      locationCode: null,
      locationName: null,
      region: null,
      stateProvince: null,
      country: null,
      source: "monthly",
    });
  }

  for (const t of txns ?? []) {
    const p = productById.get(t.product_id);
    if (!p) continue;
    const customer = t.customers as unknown as { external_ref: string; name: string } | null;
    const channel = t.channels as unknown as { code: string; name: string } | null;
    const location = t.locations as unknown as {
      code: string;
      name: string;
      country: string | null;
      region: string | null;
      state_province: string | null;
    } | null;
    facts.push({
      ...p,
      date: t.occurred_on,
      quantity: Number(t.quantity),
      revenue: t.value == null ? null : Number(t.value),
      cogs: t.cogs == null ? null : Number(t.cogs),
      channelCode: channel?.code ?? null,
      channelName: channel?.name ?? null,
      customerRef: customer?.external_ref ?? null,
      customerName: customer?.name ?? null,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      region: t.region ?? location?.region ?? null,
      stateProvince: t.state_province ?? location?.state_province ?? null,
      country: location?.country ?? null,
      source: "transactions",
    });
  }

  return facts;
}

/** A purchase order line that still represents inbound supply. */
export interface OpenSupplyLine {
  poId: string;
  productId: string | null;
  sku: string;
  productName: string;
  supplierName: string | null;
  quantity: number;
  receivedQuantity: number;
  outstanding: number;
  expectedAt: string | null;
  orderedAt: string | null;
  /** Receiving location code, when the PO declares one. */
  locationCode: string | null;
}

/**
 * Open purchase orders (placed, with an outstanding quantity). Received and
 * cancelled orders are history, not supply, and are never returned here.
 */
export async function loadOpenSupply(supabase: Db, orgId: string): Promise<OpenSupplyLine[]> {
  const inactive = await inactiveBatchIds(supabase, orgId);
  let query = supabase
    .from("purchase_orders")
    .select("id, product_id, quantity, received_quantity, expected_at, ordered_at, products(sku, name), suppliers(name), locations(code)")
    .eq("org_id", orgId)
    .eq("status", "placed");
  if (inactive.length > 0) {
    query = query.not("import_batch_id", "in", `(${inactive.join(",")})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => {
      const quantity = Number(row.quantity) || 0;
      const receivedQuantity = Math.min(quantity, Math.max(0, Number(row.received_quantity) || 0));
      const product = row.products as unknown as { sku: string; name: string } | null;
      const supplier = row.suppliers as unknown as { name: string } | null;
      const location = row.locations as unknown as { code: string } | null;
      return {
        poId: row.id,
        productId: row.product_id,
        sku: product?.sku ?? "",
        productName: product?.name ?? "",
        supplierName: supplier?.name ?? null,
        quantity,
        receivedQuantity,
        outstanding: quantity - receivedQuantity,
        expectedAt: row.expected_at,
        orderedAt: row.ordered_at,
        locationCode: location?.code ?? null,
      };
    })
    .filter((line) => line.outstanding > 0 && line.sku !== "");
}

/**
 * Every purchase order line for the workspace, any lifecycle state — the PO
 * Inbox reads history as well as open supply, unlike loadOpenSupply.
 */
export async function listPurchaseOrders(supabase: Db, orgId: string): Promise<PurchaseOrderRecord[]> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(
      "id, po_number, quantity, received_quantity, unit_cost, currency_code, status, approval_status, ordered_at, expected_at, received_at, buyer, import_batch_id, created_at, products(sku, name), suppliers(name, code), locations(code, name)",
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const quantity = Number(row.quantity) || 0;
    const receivedQuantity = Math.min(quantity, Math.max(0, Number(row.received_quantity) || 0));
    const product = row.products as unknown as { sku: string; name: string } | null;
    const supplier = row.suppliers as unknown as { name: string; code: string | null } | null;
    const location = row.locations as unknown as { code: string; name: string } | null;
    return {
      id: row.id,
      poNumber: row.po_number,
      sku: product?.sku ?? null,
      productName: product?.name ?? null,
      supplierName: supplier?.name ?? null,
      supplierCode: supplier?.code ?? null,
      quantity,
      receivedQuantity,
      outstanding: Math.max(0, quantity - receivedQuantity),
      unitCost: Number(row.unit_cost) || 0,
      currencyCode: row.currency_code,
      status: row.status as PurchaseOrderStatus,
      approvalStatus: row.approval_status as PurchaseOrderApprovalStatus,
      orderedAt: row.ordered_at,
      expectedAt: row.expected_at,
      receivedAt: row.received_at,
      locationCode: location?.code ?? null,
      locationName: location?.name ?? null,
      buyer: row.buyer,
      importBatchId: row.import_batch_id,
      createdAt: row.created_at,
    };
  });
}

/**
 * Sets a PO's approval state. Org-scoped twice — the role check lives in the
 * calling server function, and the org filter here means a foreign id is a
 * no-op rather than a cross-tenant write.
 */
export async function updatePurchaseOrderApproval(
  supabase: Db,
  orgId: string,
  poId: string,
  approvalStatus: PurchaseOrderApprovalStatus,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ approval_status: approvalStatus })
    .eq("org_id", orgId)
    .eq("id", poId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export interface PurchaseOrderPersistResult {
  inserted: number;
  duplicates: number;
  unknownSkus: string[];
  unknownSuppliers: string[];
}

/**
 * Writes imported purchase orders with re-import detection and batch
 * provenance. Suppliers are only linked when the code or name matches an
 * existing supplier — ingestion never invents vendor master data.
 */
export interface PurchaseOrderPersistResult {
  inserted: number;
  updated: number;
  duplicates: number;
  unknownSkus: string[];
  unknownSuppliers: string[];
  unknownLocations: string[];
}

/**
 * Persists purchase order lines with re-import UPDATE semantics.
 *
 * The row hash fingerprints the business line only (SKU, quantity, PO
 * reference, supplier) — mutable operational fields such as status, receipts,
 * approvals and dates are updated in place, so an updated PO from the source
 * system is recognised as the same PO rather than inserted again.
 *
 * Two provenance rules hold:
 * - `import_batch_id` is preserved from first insert: it is evidence of where
 *   the line first entered the workspace.
 * - `source_row_hash` is re-stamped to the current fingerprint so a third
 *   import of the same line matches directly.
 *
 * Rows imported before the mutable-field semantics (Package 4 fingerprint,
 * which mixed operational fields into the hash) are still recognised: the
 * legacy fingerprint is computed and matched as a fallback.
 */
export async function persistPurchaseOrders(
  supabase: Db,
  orgId: string,
  rows: CanonicalPurchaseOrder[] | undefined,
  batchId: string | null,
): Promise<PurchaseOrderPersistResult> {
  const empty: PurchaseOrderPersistResult = {
    inserted: 0,
    updated: 0,
    duplicates: 0,
    unknownSkus: [],
    unknownSuppliers: [],
    unknownLocations: [],
  };
  const pos = rows ?? [];
  if (pos.length === 0) return empty;

  const [{ data: products, error: pErr }, { data: suppliers, error: sErr }, { data: locations, error: lErr }] =
    await Promise.all([
      supabase.from("products").select("id, sku, unit_cost").eq("org_id", orgId),
      supabase.from("suppliers").select("id, code, name").eq("org_id", orgId),
      supabase.from("locations").select("id, code").eq("org_id", orgId),
    ]);
  if (pErr) throw new Error(pErr.message);
  if (sErr) throw new Error(sErr.message);
  if (lErr) throw new Error(lErr.message);

  const productIdBySku = new Map((products ?? []).map((p) => [p.sku, p]));
  const supplierByCode = new Map(
    (suppliers ?? []).filter((s) => s.code).map((s) => [s.code!.toLowerCase(), s]),
  );
  const supplierByName = new Map(
    (suppliers ?? []).map((s) => [s.name.toLowerCase(), s]),
  );
  const locationIdByCode = new Map((locations ?? []).map((l) => [l.code.toLowerCase(), l.id]));

  /** Package-4 fingerprint: operational fields were mixed into the hash. */
  const legacyHash = (p: CanonicalPurchaseOrder) =>
    rowHash([
      p.sku,
      p.quantity,
      p.receivedQuantity,
      p.orderedAt,
      p.expectedAt,
      p.status,
      p.poRef,
      p.supplierCode ?? p.supplierName,
    ]);

  const existingIdByHash = new Map<string, string>();
  const candidateHashes = [...new Set(pos.flatMap((p) => [p.rowHash, legacyHash(p)]))];
  for (const part of chunk(candidateHashes, 500)) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, source_row_hash")
      .eq("org_id", orgId)
      .in("source_row_hash", part);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.source_row_hash) existingIdByHash.set(row.source_row_hash, row.id);
    }
  }

  const inserts: Database["public"]["Tables"]["purchase_orders"]["Insert"][] = [];
  const updates: { id: string; fields: Database["public"]["Tables"]["purchase_orders"]["Update"] }[] = [];
  const unknownSkus = new Set<string>();
  const unknownSuppliers = new Set<string>();
  const unknownLocations = new Set<string>();
  const seenHashes = new Set<string>();
  let duplicates = 0;

  for (const po of pos) {
    const product = productIdBySku.get(po.sku);
    if (!product) {
      unknownSkus.add(po.sku);
      continue;
    }
    let supplierId: string | null = null;
    if (po.supplierCode || po.supplierName) {
      const supplier =
        (po.supplierCode ? supplierByCode.get(po.supplierCode.toLowerCase()) : undefined) ??
        (po.supplierName ? supplierByName.get(po.supplierName.toLowerCase()) : undefined);
      if (supplier) supplierId = supplier.id;
      else unknownSuppliers.add(po.supplierCode ?? po.supplierName ?? "");
    }
    let locationId: string | null = null;
    if (po.location) {
      const resolved = locationIdByCode.get(po.location.toLowerCase());
      if (resolved) locationId = resolved;
      else unknownLocations.add(po.location);
    }
    if (seenHashes.has(po.rowHash)) {
      duplicates++;
      continue;
    }
    seenHashes.add(po.rowHash);

    const mutableFields = {
      product_id: product.id,
      supplier_id: supplierId,
      location_id: locationId,
      quantity: po.quantity,
      received_quantity: po.receivedQuantity,
      unit_cost: po.unitCost ?? product.unit_cost,
      currency_code: po.currencyCode,
      status: po.status,
      approval_status: po.approvalStatus,
      ordered_at: po.orderedAt,
      expected_at: po.expectedAt,
      received_at: po.receivedAt,
      buyer: po.buyer,
      po_number: po.poRef,
    } satisfies Database["public"]["Tables"]["purchase_orders"]["Update"];

    const existingId = existingIdByHash.get(po.rowHash) ?? existingIdByHash.get(legacyHash(po));
    if (existingId) {
      // Re-import of a known line: update mutable fields and re-stamp the
      // fingerprint. import_batch_id and created_at stay untouched.
      updates.push({ id: existingId, fields: { ...mutableFields, source_row_hash: po.rowHash } });
      continue;
    }
    inserts.push({
      org_id: orgId,
      ...mutableFields,
      source_row_hash: po.rowHash,
      import_batch_id: batchId,
    });
  }

  for (const part of chunk(inserts, 500)) {
    const { error } = await supabase.from("purchase_orders").insert(part);
    if (error) throw new Error(error.message);
  }
  for (const part of chunk(updates, 25)) {
    const results = await Promise.all(
      part.map((u) =>
        supabase.from("purchase_orders").update(u.fields).eq("org_id", orgId).eq("id", u.id),
      ),
    );
    for (const { error } of results) if (error) throw new Error(error.message);
  }
  return {
    inserted: inserts.length,
    updated: updates.length,
    duplicates,
    unknownSkus: [...unknownSkus],
    unknownSuppliers: [...unknownSuppliers],
    unknownLocations: [...unknownLocations],
  };
}

// ---------------------------------------------------------------------------
// Scenario Planning
// ---------------------------------------------------------------------------

function mapScenarioRow(
  row: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    scope: unknown;
    assumptions: unknown;
    created_by: string;
    created_at: string;
    updated_at: string;
  },
  latest: { version: number; created_at: string } | null,
): ScenarioRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ScenarioRecord["status"],
    scope: (row.scope ?? {}) as ScenarioRecord["scope"],
    assumptions: (row.assumptions ?? {}) as ScenarioRecord["assumptions"],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: latest?.version ?? null,
    latestRunAt: latest?.created_at ?? null,
  };
}

/** All scenarios for the workspace, each with its latest run marker. */
export async function listScenarios(supabase: Db, orgId: string): Promise<ScenarioRecord[]> {
  const [{ data: scenarios, error }, { data: runs, error: runError }] = await Promise.all([
    supabase
      .from("scenarios")
      .select("id, name, description, status, scope, assumptions, created_by, created_at, updated_at")
      .eq("org_id", orgId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("scenario_runs")
      .select("scenario_id, version, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  if (runError) throw new Error(runError.message);
  const latestByScenario = new Map<string, { version: number; created_at: string }>();
  for (const run of runs ?? []) {
    if (!latestByScenario.has(run.scenario_id)) {
      latestByScenario.set(run.scenario_id, run);
    }
  }
  return (scenarios ?? []).map((row) => mapScenarioRow(row, latestByScenario.get(row.id) ?? null));
}

export async function createScenario(
  supabase: Db,
  orgId: string,
  userId: string,
  input: {
    name: string;
    description: string | null;
    scope: PlanningFilter;
    assumptions: ScenarioAssumptions;
  },
): Promise<ScenarioRecord> {
  const { data, error } = await supabase
    .from("scenarios")
    .insert({
      org_id: orgId,
      name: input.name,
      description: input.description,
      scope: input.scope,
      assumptions: input.assumptions,
      created_by: userId,
    })
    .select("id, name, description, status, scope, assumptions, created_by, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return mapScenarioRow(data, null);
}

export async function updateScenario(
  supabase: Db,
  orgId: string,
  scenarioId: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: ScenarioRecord["status"];
    scope?: PlanningFilter;
    assumptions?: ScenarioAssumptions;
  },
): Promise<ScenarioRecord> {
  const fields: Database["public"]["Tables"]["scenarios"]["Update"] = {};
  if (patch.name !== undefined) fields["name"] = patch.name;
  if (patch.description !== undefined) fields["description"] = patch.description;
  if (patch.status !== undefined) fields["status"] = patch.status;
  if (patch.scope !== undefined) fields["scope"] = patch.scope as unknown as Json;
  if (patch.assumptions !== undefined) fields["assumptions"] = patch.assumptions as unknown as Json;
  const { data, error } = await supabase
    .from("scenarios")
    .update(fields)
    .eq("org_id", orgId)
    .eq("id", scenarioId)
    .select("id, name, description, status, scope, assumptions, created_by, created_at, updated_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Scenario not found.");
  const { data: latestRun } = await supabase
    .from("scenario_runs")
    .select("version, created_at")
    .eq("org_id", orgId)
    .eq("scenario_id", scenarioId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return mapScenarioRow(data, latestRun);
}

/** Deletion is restricted to owner/admin by RLS. Runs cascade with the scenario. */
export async function deleteScenario(
  supabase: Db,
  orgId: string,
  scenarioId: string,
): Promise<void> {
  const { error, count } = await supabase
    .from("scenarios")
    .delete({ count: "exact" })
    .eq("org_id", orgId)
    .eq("id", scenarioId);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Scenario not found, or your role cannot delete it.");
}

/** One scenario plus its run history (summaries only). */
export async function getScenario(
  supabase: Db,
  orgId: string,
  scenarioId: string,
): Promise<{ scenario: ScenarioRecord; runs: ScenarioRunSummaryRecord[] }> {
  const { data, error } = await supabase
    .from("scenarios")
    .select("id, name, description, status, scope, assumptions, created_by, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("id", scenarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Scenario not found.");
  const { data: runs, error: runError } = await supabase
    .from("scenario_runs")
    .select("id, scenario_id, version, baseline_summary, scenario_summary, created_by, created_at")
    .eq("org_id", orgId)
    .eq("scenario_id", scenarioId)
    .order("version", { ascending: false });
  if (runError) throw new Error(runError.message);
  return {
    scenario: mapScenarioRow(data, runs?.[0] ?? null),
    runs: (runs ?? []).map((r) => ({
      id: r.id,
      scenarioId: r.scenario_id,
      version: r.version,
      baselineSummary: r.baseline_summary as unknown as ScenarioRunSummaryRecord["baselineSummary"],
      scenarioSummary: r.scenario_summary as unknown as ScenarioRunSummaryRecord["scenarioSummary"],
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Persists one run snapshot. The version is the next integer for the scenario;
 * on the (rare) concurrent-run conflict the insert fails and the caller
 * retries once with a freshly computed version.
 */
export async function insertScenarioRun(
  supabase: Db,
  orgId: string,
  userId: string,
  scenarioId: string,
  snapshot: {
    assumptions: ScenarioAssumptions;
    scope: PlanningFilter;
    result: ScenarioRunResult;
    inputProvenance: ScenarioRunRecord["inputProvenance"];
  },
): Promise<{ id: string; version: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: latest } = await supabase
      .from("scenario_runs")
      .select("version")
      .eq("org_id", orgId)
      .eq("scenario_id", scenarioId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? 0) + 1;
    const { data, error } = await supabase
      .from("scenario_runs")
      .insert({
        org_id: orgId,
        scenario_id: scenarioId,
        version,
        assumptions: snapshot.assumptions as unknown as Json,
        scope: snapshot.scope as unknown as Json,
        baseline_summary: snapshot.result.baselineSummary as unknown as Json,
        scenario_summary: snapshot.result.scenarioSummary as unknown as Json,
        row_results: {
          summaryComparison: snapshot.result.summaryComparison,
          rows: snapshot.result.rows,
          rowsTruncated: snapshot.result.rowsTruncated,
          explanation: snapshot.result.explanation,
          assumptionLines: snapshot.result.assumptionLines,
          horizonStart: snapshot.result.horizonStart,
          horizonPeriods: snapshot.result.horizonPeriods,
        } as unknown as Json,
        input_provenance: snapshot.inputProvenance as unknown as Json,
        created_by: userId,
      })
      .select("id, version")
      .maybeSingle();
    if (!error && data) return data;
    if (error && attempt === 0 && error.code === "23505") continue; // version race: retry
    if (error) throw new Error(error.message);
    throw new Error("Run could not be recorded.");
  }
  throw new Error("Run could not be recorded.");
}

/** The full immutable snapshot of one run. */
export async function getScenarioRun(
  supabase: Db,
  orgId: string,
  runId: string,
): Promise<ScenarioRunRecord> {
  const { data, error } = await supabase
    .from("scenario_runs")
    .select(
      "id, scenario_id, version, assumptions, scope, baseline_summary, scenario_summary, row_results, input_provenance, created_by, created_at",
    )
    .eq("org_id", orgId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Scenario run not found.");
  const stored = data.row_results as unknown as Omit<
    ScenarioRunResult,
    "baselineSummary" | "scenarioSummary"
  >;
  const baselineSummary =
    data.baseline_summary as unknown as ScenarioRunRecord["baselineSummary"];
  const scenarioSummary =
    data.scenario_summary as unknown as ScenarioRunRecord["scenarioSummary"];
  return {
    id: data.id,
    scenarioId: data.scenario_id,
    version: data.version,
    assumptions: (data.assumptions ?? {}) as ScenarioAssumptions,
    scope: (data.scope ?? {}) as PlanningFilter,
    baselineSummary,
    scenarioSummary,
    result: { ...stored, baselineSummary, scenarioSummary },
    inputProvenance: data.input_provenance as unknown as ScenarioRunRecord["inputProvenance"],
    createdBy: data.created_by,
    createdAt: data.created_at,
  };
}
