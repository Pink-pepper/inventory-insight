import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  AuditDetailValue,
  AuditEvent,
  CanonicalDataset,
  ConnectorType,
  DataSource,
  InventoryPosition,
  Organization,
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
import type { DemandFact } from "@/lib/demand/series";

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

  const monthsRefreshed = await refreshMonthlySales(supabase, orgId, [...affected]);
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
): Promise<number> {
  if (productIds.length === 0) return 0;
  const totals = new Map<string, { productId: string; month: string; quantity: number; revenue: number; cogs: number | null }>();

  for (const part of chunk(productIds, 100)) {
    const { data, error } = await supabase
      .from("sales_transactions")
      .select("product_id, occurred_on, quantity, value, unit_price, cogs")
      .eq("org_id", orgId)
      .in("product_id", part);
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
      supabase
        .from("sales_transactions")
        .select(
          "product_id, occurred_on, quantity, value, cogs, region, state_province, customers(external_ref, name), channels(code, name), locations(code, name, country, region, state_province)",
        )
        .eq("org_id", orgId),
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
