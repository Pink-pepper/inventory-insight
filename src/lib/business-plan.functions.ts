import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { audit, resolveOrg } from "@/lib/data/repository";
import {
  deleteBusinessPlan,
  deleteBusinessPlanLine,
  listBusinessPlans,
  replacePlanLines,
  saveBusinessPlan,
  saveBusinessPlanLine,
} from "@/lib/data/plan-repository";
import { allocateTopDown } from "@/lib/domain/business-plan";
import { listDemandSignals, loadHistoryBaseline } from "@/lib/data/commercial-repository";
import { resolveDemandBook } from "@/lib/demand/resolve";
import { loadProductMaster } from "@/lib/data/master-repository";

const uuid = z.string().uuid();
const text = (max = 500) => z.string().max(max).trim();
const money = z.number().finite().min(0).max(1_000_000_000_000);

export const getBusinessPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return listBusinessPlans(supabase, orgId);
  });

const planSchema = z.object({
  name: text(160).min(1),
  plan_year: z.number().int().min(2000).max(2100),
  direction: z.enum(["bottom_up", "top_down"]),
  revenue_target: money,
  gross_profit_target: money,
  currency_code: text(3).nullable().optional(),
  notes: text(4000).nullable().optional(),
});

export const savePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid.nullable().optional(), values: planSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveBusinessPlan(supabase, orgId, data.id ?? null, data.values, userId);
    await audit(supabase, orgId, userId, data.id ? "plan.update" : "plan.create", { id });
    return { id };
  });

export const removePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteBusinessPlan(supabase, orgId, data.id);
    return { ok: true };
  });

const lineSchema = z.object({
  plan_id: uuid,
  supplier_id: uuid.nullable().optional(),
  product_id: uuid.nullable().optional(),
  customer_id: uuid.nullable().optional(),
  label: text(200).nullable().optional(),
  expected_quantity: money,
  expected_revenue: money,
  expected_gross_profit: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  source: z.enum(["manual", "demand_book", "allocation"]).optional(),
  notes: text(2000).nullable().optional(),
});

export const savePlanLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid.nullable().optional(), values: lineSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveBusinessPlanLine(supabase, orgId, data.id ?? null, data.values);
    return { id };
  });

export const removePlanLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteBusinessPlanLine(supabase, orgId, data.id);
    return { ok: true };
  });

/**
 * Bottom-up seeding. Lines come from the resolved Demand Book — the same
 * resolution the planning chain uses — priced with the product's selling price
 * and landed cost. Nothing is invented: rows without a price contribute
 * quantity only.
 */
export const seedPlanFromDemand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const [signals, baseline, products] = await Promise.all([
      listDemandSignals(supabase, orgId),
      loadHistoryBaseline(supabase, orgId),
      loadProductMaster(supabase, orgId),
    ]);
    const rows = resolveDemandBook({ signals, history: baseline.points });
    const byProduct = new Map(products.map((p) => [p.id, p]));

    const agg = new Map<string, { quantity: number; revenue: number; gp: number }>();
    for (const r of rows) {
      if (!r.productId) continue;
      const p = byProduct.get(r.productId);
      const price = p?.unitPrice ?? null;
      const cost = p?.landedCost ?? p?.unitCost ?? null;
      const cur = agg.get(r.productId) ?? { quantity: 0, revenue: 0, gp: 0 };
      cur.quantity += r.quantity;
      if (price != null) {
        cur.revenue += r.quantity * price;
        if (cost != null) cur.gp += r.quantity * (price - cost);
      }
      agg.set(r.productId, cur);
    }

    await replacePlanLines(
      supabase,
      orgId,
      data.planId,
      [...agg.entries()].map(([productId, v]) => ({
        product_id: productId,
        label: byProduct.get(productId)?.name ?? null,
        expected_quantity: v.quantity,
        expected_revenue: v.revenue,
        expected_gross_profit: v.gp,
        source: "demand_book",
      })),
    );
    await audit(supabase, orgId, userId, "plan.seed_from_demand", {
      planId: data.planId,
      lines: agg.size,
    });
    return { lines: agg.size };
  });

/** Top-down allocation across the plan's existing lines, holding each margin. */
export const allocatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: uuid, revenueTarget: money }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const plans = await listBusinessPlans(supabase, orgId);
    const plan = plans.find((p) => p.id === data.planId);
    if (!plan) throw new Error("Plan not found");
    const allocated = allocateTopDown(plan.lines, data.revenueTarget);
    await replacePlanLines(
      supabase,
      orgId,
      plan.id,
      allocated.map((l) => ({
        supplier_id: l.supplierId,
        product_id: l.productId,
        customer_id: l.customerId,
        label: l.label,
        expected_quantity: l.expectedQuantity,
        expected_revenue: l.expectedRevenue,
        expected_gross_profit: l.expectedGrossProfit,
        source: "allocation",
        notes: l.notes,
      })),
    );
    await audit(supabase, orgId, userId, "plan.allocate", { planId: plan.id });
    return { lines: allocated.length };
  });
