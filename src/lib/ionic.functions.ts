import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildDemoDataset } from "@/lib/connectors/demo-dataset";
import { csvConnector } from "@/lib/connectors/csv-connector";
import {
  audit,
  buildRecommendationView,
  getEffectivePolicy,
  getLastRun,
  getProfile,
  listAuditEvents,
  listDataSources,
  persistDataset,
  regenerateRecommendations,
  resolveOrg,
  savePlanningPolicy,
} from "@/lib/data/repository";
import type { IngestionIssue, IngestionStats } from "@/lib/connectors/types";
import { summarise } from "@/lib/analytics/summary";

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

export const getAuditLogLegacyUnused = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return listAuditEvents(supabase, orgId, 50);
  });

export const recordLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await audit(supabase, orgId, userId, "auth.login", {});
    return { ok: true };
  });