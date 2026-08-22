import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildDemoDataset } from "@/lib/connectors/demo-dataset";
import { csvConnector } from "@/lib/connectors/csv-connector";
import {
  audit,
  buildRecommendationView,
  createImportBatch,
  getEffectivePolicy,
  getLastRun,
  getProfile,
  listAuditEvents,
  listDataSources,
  listPurchaseOrders,
  loadDemandFacts,
  loadOpenSupply,
  persistDataset,
  persistPurchaseOrders,
  persistTransactions,
  regenerateRecommendations,
  resolveOrg,
  savePlanningPolicy,
  updatePurchaseOrderApproval,
} from "@/lib/data/repository";
import type { IngestionIssue, IngestionStats } from "@/lib/connectors/types";
import { canonicalise, type SheetPlan } from "@/lib/ingestion/canonicalise";
import { formatOf, inspectSheets, toSheets } from "@/lib/ingestion/inspect";
import { LIMITS } from "@/lib/ingestion/sheet-table";
import {
  EMPTY_PLANNING_POLICY,
  type PlanningPolicy,
} from "@/lib/domain/planning-policy";
import { summarise } from "@/lib/analytics/summary";
import {
  DEMAND_DIMENSIONS,
  applyPlanningFilter,
  planningFilterSchema,
  type PlanningFilter,
} from "@/lib/query/filters";
import { buildDemandPlan, filterOptions } from "@/lib/demand/plan";
import { buildSupplyPlan } from "@/lib/supply/plan";
import { buildDistributionPlan } from "@/lib/distribution/plan";

/**
 * Supply Planning: demand plan + inventory position + open purchase orders →
 * net requirement, order-by dates, and explicit fulfilment risks. Everything
 * is computed on the fly from authoritative tables — nothing is pre-computed.
 */
export const getSupplyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ filter: planningFilterSchema.optional() }).parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const filter: PlanningFilter = data.filter ?? {};
    const [facts, policy, rows, openSupply, lastRun] = await Promise.all([
      loadDemandFacts(supabase, orgId),
      getEffectivePolicy(supabase, orgId),
      buildRecommendationView(supabase, orgId),
      loadOpenSupply(supabase, orgId),
      getLastRun(supabase, orgId),
    ]);
    const plan = buildSupplyPlan({ facts, engineRows: rows, openSupply, policy, filter });
    return {
      ...plan,
      options: filterOptions(facts),
      policy,
      lastRun,
      calculatedAt: new Date().toISOString(),
    };
  });

/**
 * Distribution Planning: the supply plan's purchase requirements checked
 * against per-location excess. A transfer suggestion only ever substitutes
 * for a requirement the supply plan already computed — it never invents one.
 */
export const getDistributionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ filter: planningFilterSchema.optional() }).parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const filter: PlanningFilter = data.filter ?? {};
    const [facts, policy, rows, openSupply] = await Promise.all([
      loadDemandFacts(supabase, orgId),
      getEffectivePolicy(supabase, orgId),
      buildRecommendationView(supabase, orgId),
      loadOpenSupply(supabase, orgId),
    ]);
    const supply = buildSupplyPlan({ facts, engineRows: rows, openSupply, policy, filter });
    const plan = buildDistributionPlan({ supplyRows: supply.rows, facts, openSupply, policy, filter });
    return {
      ...plan,
      options: filterOptions(facts),
      calculatedAt: new Date().toISOString(),
    };
  });

export const getDemandPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      filter: planningFilterSchema.optional(),
      dimension: z.enum(DEMAND_DIMENSIONS).optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const filter: PlanningFilter = data.filter ?? {};
    const [facts, policy, rows, lastRun] = await Promise.all([
      loadDemandFacts(supabase, orgId),
      getEffectivePolicy(supabase, orgId),
      buildRecommendationView(supabase, orgId),
      getLastRun(supabase, orgId),
    ]);

    const plan = buildDemandPlan({
      facts,
      filter,
      policy,
      dimension: data.dimension ?? "product",
    });

    // Inventory implications for exactly the products in scope, carrying the
    // observed demand direction so the planner sees signal and position side
    // by side. Every number still comes from the existing engine.
    const directionBySku = new Map(plan.skuDirection.map((d) => [d.sku, d]));
    const scoped = applyPlanningFilter(
      rows.map((r) => ({
        ...r,
        locationCodes: r.locations.map((l) => l.location),
      })),
      filter,
    );
    const planningRows = scoped
      .filter((r) => plan.totals.skus === 0 || directionBySku.has(r.sku))
      .map((r) => ({
        sku: r.sku,
        name: r.name,
        category: r.category,
        supplierName: r.supplierName,
        action: r.action,
        onHand: r.onHand,
        onOrder: r.onOrder,
        daysOfCover: r.daysOfCover,
        reorderPoint: r.reorderPoint,
        recommendedQty: r.recommendedQty,
        estimatedCost: r.estimatedCost,
        avgMonthlyDemand: r.avgMonthlyDemand,
        blocked: r.blocked,
        observedDemand: directionBySku.get(r.sku)?.quantity ?? 0,
        demandChangePct: directionBySku.get(r.sku)?.changePct ?? null,
      }));

    return {
      plan,
      planningRows,
      options: filterOptions(facts),
      policy,
      lastRun,
      calculatedAt: new Date().toISOString(),
    };
  });

export const getWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { org, role, orgId } = await resolveOrg(supabase, userId);
    const [profile, dataSources, planningPolicy, { count }] = await Promise.all([
      getProfile(supabase, userId),
      listDataSources(supabase, orgId),
      getEffectivePolicy(supabase, orgId),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    return {
      org,
      role,
      profile,
      dataSources,
      planningPolicy,
      productCount: count ?? 0,
    };
  });

export const ingestDataset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      source: z.enum(["demo", "csv"]),
      filename: z.string().max(200).optional(),
      content: z.string().max(8_000_000).optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);

    let dataset;
    let issues: IngestionIssue[] = [];
    let stats: IngestionStats = { rowsRead: 0, rowsAccepted: 0, rowsRejected: 0, warnings: 0 };
    let label = "Demo dataset";

    if (data.source === "csv") {
      // Never trust the client filename: take the basename only, strip control
      // characters and bound the length before it is stored or displayed.
      const rawName = (data.filename ?? "upload.csv").split(/[\\/]/).pop() ?? "upload.csv";
      const filename = rawName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "upload.csv";
      if (!/\.csv$/i.test(filename)) throw new Error("Only .csv files are supported.");
      if (!data.content) throw new Error("The uploaded file was empty.");
      const bytes = new TextEncoder().encode(data.content).byteLength;
      if (bytes > 5_000_000) throw new Error("File exceeds the 5 MB limit.");
      const parsed = csvConnector.parse(data.content);
      if (parsed.dataset.products.length === 0) {
        throw new Error(
          parsed.issues.find((i) => i.severity === "error")?.message ??
            "No valid rows found in the file.",
        );
      }
      dataset = parsed.dataset;
      issues = parsed.issues.slice(0, 50);
      stats = parsed.stats;
      label = filename;
    } else {
      dataset = buildDemoDataset();
      stats = {
        rowsRead: dataset.sales.length,
        rowsAccepted: dataset.sales.length,
        rowsRejected: 0,
        warnings: 0,
      };
    }

    const counts = await persistDataset(supabase, orgId, dataset);
    const { error: dsError } = await supabase.from("data_sources").insert({
      org_id: orgId,
      connector: "csv",
      name: label,
      status: "active",
      last_sync_at: new Date().toISOString(),
      rows_ingested: counts.sales + counts.products,
      error_count: stats.rowsRejected,
    });
    if (dsError) throw new Error(dsError.message);

    const run = await regenerateRecommendations(supabase, orgId);
    await audit(supabase, orgId, userId, "data.upload", {
      source: data.source,
      label,
      products: counts.products,
      sales: counts.sales,
      rows_accepted: stats.rowsAccepted,
      rows_rejected: stats.rowsRejected,
      warnings: stats.warnings,
    });
    await audit(supabase, orgId, userId, "recommendations.generated", {
      evaluated: run.evaluated,
      blocked: run.blocked,
      run_id: run.runId,
    });

    return { ...counts, evaluated: run.evaluated, issues, stats, run };
  });

export const getOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const [rows, lastRun] = await Promise.all([
      buildRecommendationView(supabase, orgId),
      getLastRun(supabase, orgId),
    ]);
    return { ...summarise(rows), lastRun, calculatedAt: new Date().toISOString() };
  });

export const getRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const [rows, lastRun] = await Promise.all([
      buildRecommendationView(supabase, orgId),
      getLastRun(supabase, orgId),
    ]);
    return { rows, lastRun, calculatedAt: new Date().toISOString() };
  });

export const getSkuDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ sku: z.string().min(1).max(64) }).parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const [rows, lastRun] = await Promise.all([
      buildRecommendationView(supabase, orgId),
      getLastRun(supabase, orgId),
    ]);
    const row = rows.find((r) => r.sku === data.sku);
    if (!row) return null;
    return { ...row, lastRun, calculatedAt: new Date().toISOString() };
  });

export const regenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const result = await regenerateRecommendations(supabase, orgId);
    await audit(supabase, orgId, userId, "recommendations.generated", {
      evaluated: result.evaluated,
      blocked: result.blocked,
      run_id: result.runId,
    });
    return result;
  });

export const clearWorkspaceData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId, role } = await resolveOrg(supabase, userId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only workspace owners and admins can delete data.");
    }
    for (const table of ["recommendations", "sales", "inventory", "products", "suppliers", "data_sources"] as const) {
      const { error } = await supabase.from(table).delete().eq("org_id", orgId);
      if (error) throw new Error(error.message);
    }
    await audit(supabase, orgId, userId, "data.delete", { scope: "workspace" });
    return { ok: true };
  });

export const getAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return listAuditEvents(supabase, orgId, 50);
  });

/** Nullable numeric policy input: null means "not configured". */
const optNum = (max: number) => z.number().min(0).max(max).nullable().optional();

const planningPolicyInput = z.object({
  demandWindowMonths: z.number().int().min(1).max(60).nullable().optional(),
  planningHorizonDays: z.number().int().min(1).max(730).nullable().optional(),
  safetyStockDays: z.number().int().min(0).max(365).nullable().optional(),
  defaultLeadTimeDays: z.number().int().min(0).max(730).nullable().optional(),
  defaultMinOrderQty: z.number().int().min(0).max(1_000_000).nullable().optional(),
  orderMultiple: z.number().int().min(1).max(1_000_000).nullable().optional(),
  reorderPointOverride: optNum(1_000_000_000),
  minimumStockLevel: optNum(1_000_000_000),
  targetStockLevel: optNum(1_000_000_000),
  daysOfCoverTarget: optNum(3650),
  serviceLevel: z.number().min(0).max(1).nullable().optional(),
  demandMethod: z.literal("trailing_average").nullable().optional(),
  demandGrowthPct: z.number().min(-100).max(1000).nullable().optional(),
  seasonalityEnabled: z.boolean().nullable().optional(),
  demandVariability: optNum(100),
  leadTimeVariabilityDays: optNum(365),
  productDisplay: z.enum(["sku", "name", "sku_name"]),
});

export const getPlanningPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return getEffectivePolicy(supabase, orgId);
  });

export const updatePlanningPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(planningPolicyInput.parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId, role } = await resolveOrg(supabase, userId);
    // Defence in depth: RLS also restricts writes to owners and admins.
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only workspace owners and admins can change the planning policy.");
    }
    const merged = { ...EMPTY_PLANNING_POLICY, ...data } as PlanningPolicy;
    const saved = await savePlanningPolicy(supabase, orgId, merged);
    await audit(supabase, orgId, userId, "planning.policy.updated", {
      product_display: saved.productDisplay,
      demand_window_months: saved.demandWindowMonths,
      planning_horizon_days: saved.planningHorizonDays,
    });
    return saved;
  });

export const recordLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await audit(supabase, orgId, userId, "auth.login", {});
    return { ok: true };
  });

/* ------------------------------------------------------------------ *
 * Spreadsheet ingestion: inspect first, import only after confirmation
 * ------------------------------------------------------------------ */

const uploadInput = z.object({
  filename: z.string().min(1).max(200),
  encoding: z.enum(["text", "base64"]),
  content: z.string().min(1).max(9_000_000),
});

const ENTITY_KINDS = [
  "combined",
  "products",
  "suppliers",
  "inventory",
  "sales_monthly",
  "transactions",
  "customers",
  "channels",
  "purchase_orders",
  "ignored",
] as const;

const importInput = uploadInput.extend({
  plans: z
    .array(
      z.object({
        sheetName: z.string().min(1).max(200),
        kind: z.enum(ENTITY_KINDS),
        mapping: z.record(z.string().max(64), z.number().int().min(0).max(500)),
      }),
    )
    .min(1)
    .max(30),
});

/** Sanitises a client-supplied filename down to a safe basename. */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "upload";
  if (!/\.(csv|xlsx)$/i.test(cleaned)) {
    throw new Error("Only .csv and .xlsx files are supported.");
  }
  return cleaned;
}

/** Decodes the upload into the shape its source adapter needs, enforcing the size limit. */
function decodeUpload(encoding: "text" | "base64", content: string) {
  if (encoding === "base64") {
    const binary = atob(content);
    if (binary.length > LIMITS.maxBytes) throw new Error("File exceeds the 5 MB limit.");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes };
  }
  if (new TextEncoder().encode(content).byteLength > LIMITS.maxBytes) {
    throw new Error("File exceeds the 5 MB limit.");
  }
  return { text: content };
}

/**
 * Step one: parse the upload in memory and report what was found. Nothing is
 * written to the workspace and the file is never stored.
 */
export const inspectUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(uploadInput.parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await resolveOrg(supabase, userId);
    const filename = safeFilename(data.filename);
    const payload = decodeUpload(data.encoding, data.content);
    const format = formatOf(filename, payload.bytes);
    const sheets = toSheets(format, payload);
    return inspectSheets(filename, format, sheets);
  });

/**
 * Step two: canonicalise the confirmed sheets and commit them. The
 * organisation is derived server-side and every row is validated again here —
 * the preview is never trusted as authorisation or as validated input.
 */
export const importUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(importInput.parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const filename = safeFilename(data.filename);
    const payload = decodeUpload(data.encoding, data.content);
    const format = formatOf(filename, payload.bytes);
    const sheets = toSheets(format, payload);

    const plans: SheetPlan[] = data.plans.filter((p) => sheets.some((s) => s.sheetName === p.sheetName));
    if (plans.every((p) => p.kind === "ignored")) {
      throw new Error("No sheets were selected for import.");
    }

    const result = canonicalise(sheets, plans);
    if (
      result.dataset.products.length === 0 &&
      result.dataset.inventory.length === 0 &&
      result.dataset.sales.length === 0 &&
      (result.dataset.transactions?.length ?? 0) === 0 &&
      (result.dataset.purchaseOrders?.length ?? 0) === 0
    ) {
      throw new Error(
        result.issues.find((i) => i.severity === "error")?.message ??
          "No valid rows were found in the selected sheets.",
      );
    }

    const batchId = await createImportBatch(supabase, orgId, userId, {
      source: format,
      filename,
      sheetSummary: plans.map((p) => ({
        sheet: p.sheetName,
        kind: p.kind,
        rows: sheets.find((s) => s.sheetName === p.sheetName)?.rowCount ?? 0,
      })),
      rowsRead: result.stats.rowsRead,
      rowsAccepted: result.stats.rowsAccepted,
      rowsRejected: result.stats.rowsRejected,
      warnings: result.stats.warnings,
    });

    const counts = await persistDataset(supabase, orgId, result.dataset);
    const tx = await persistTransactions(supabase, orgId, result.dataset, batchId);
    const pos = await persistPurchaseOrders(supabase, orgId, result.dataset.purchaseOrders, batchId);

    const { error: dsError } = await supabase.from("data_sources").insert({
      org_id: orgId,
      connector: "csv",
      name: filename,
      status: "active",
      last_sync_at: new Date().toISOString(),
      rows_ingested: result.stats.rowsAccepted,
      error_count: result.stats.rowsRejected,
    });
    if (dsError) throw new Error(dsError.message);

    const run = await regenerateRecommendations(supabase, orgId);
    await audit(supabase, orgId, userId, "data.import", {
      format,
      filename,
      batch_id: batchId,
      sheets: plans.filter((p) => p.kind !== "ignored").length,
      rows_accepted: result.stats.rowsAccepted,
      rows_rejected: result.stats.rowsRejected,
      transactions: tx.inserted,
      duplicates: tx.duplicates,
      purchase_orders: pos.inserted,
      purchase_orders_updated: pos.updated,
      po_duplicates: pos.duplicates,
      po_unknown_locations: pos.unknownLocations.length,
    });
    await audit(supabase, orgId, userId, "recommendations.generated", {
      evaluated: run.evaluated,
      blocked: run.blocked,
      run_id: run.runId,
    });

    return {
      batchId,
      ...counts,
      transactions: tx,
      purchaseOrders: pos,
      issues: result.issues,
      stats: result.stats,
      evaluated: run.evaluated,
      run,
    };
  });

/**
 * PO Inbox: every purchase order line in the workspace with derived
 * fulfilment status. Any member may read; only owners and admins may change
 * approval state (setPurchaseOrderApproval).
 */
export const getPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId, role } = await resolveOrg(supabase, userId);
    const orders = await listPurchaseOrders(supabase, orgId);
    return { orders, canApprove: role === "owner" || role === "admin" };
  });

const PO_APPROVAL_ACTIONS = ["approved", "rejected", "needs_review"] as const;

/** Sets a PO's approval state. Restricted to workspace owners and admins. */
export const setPurchaseOrderApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        poId: z.string().uuid(),
        approvalStatus: z.enum(PO_APPROVAL_ACTIONS),
      })
      .parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId, role } = await resolveOrg(supabase, userId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only workspace owners and admins can change purchase order approvals.");
    }
    const updated = await updatePurchaseOrderApproval(supabase, orgId, data.poId, data.approvalStatus);
    if (!updated) throw new Error("Purchase order not found in this workspace.");
    await audit(supabase, orgId, userId, "po.approval_changed", {
      po_id: data.poId,
      approval_status: data.approvalStatus,
    });
    return { ok: true };
  });