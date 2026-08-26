/**
 * Business plan data access. The plan stores targets and contribution lines;
 * the arithmetic lives in `@/lib/domain/business-plan`.
 */
import type { Db } from "./repository";
import type {
  BusinessPlanLine,
  BusinessPlanRecord,
  PlanDirection,
  PlanLineSource,
} from "@/lib/domain/business-plan";

type Named = { id: string; name: string } | null;
type Prod = { id: string; sku: string; name: string } | null;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listBusinessPlans(
  supabase: Db,
  orgId: string,
): Promise<BusinessPlanRecord[]> {
  const [{ data, error }, { data: lines, error: lErr }] = await Promise.all([
    supabase
      .from("business_plans")
      .select(
        "id, name, plan_year, direction, revenue_target, gross_profit_target, currency_code, notes, created_at, updated_at",
      )
      .eq("org_id", orgId)
      .order("plan_year", { ascending: false }),
    supabase
      .from("business_plan_lines")
      .select(
        "id, plan_id, supplier_id, product_id, customer_id, label, expected_quantity, expected_revenue, expected_gross_profit, source, notes, suppliers(id, name), products(id, sku, name), customers(id, name)",
      )
      .eq("org_id", orgId),
  ]);
  fail(error);
  fail(lErr);

  const byPlan = new Map<string, BusinessPlanLine[]>();
  for (const r of lines ?? []) {
    const prod = r.products as unknown as Prod;
    const list = byPlan.get(r.plan_id) ?? [];
    list.push({
      id: r.id,
      planId: r.plan_id,
      supplierId: r.supplier_id,
      supplierName: (r.suppliers as unknown as Named)?.name ?? null,
      productId: r.product_id,
      sku: prod?.sku ?? null,
      productName: prod?.name ?? null,
      customerId: r.customer_id,
      customerName: (r.customers as unknown as Named)?.name ?? null,
      label: r.label,
      expectedQuantity: Number(r.expected_quantity ?? 0),
      expectedRevenue: Number(r.expected_revenue ?? 0),
      expectedGrossProfit: Number(r.expected_gross_profit ?? 0),
      source: r.source as PlanLineSource,
      notes: r.notes,
    });
    byPlan.set(r.plan_id, list);
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    planYear: p.plan_year,
    direction: p.direction as PlanDirection,
    revenueTarget: Number(p.revenue_target ?? 0),
    grossProfitTarget: Number(p.gross_profit_target ?? 0),
    currencyCode: p.currency_code,
    notes: p.notes,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    lines: byPlan.get(p.id) ?? [],
  }));
}

export async function saveBusinessPlan(
  supabase: Db,
  orgId: string,
  id: string | null,
  values: Record<string, unknown>,
  createdBy: string,
): Promise<string> {
  if (id) {
    const { error } = await supabase
      .from("business_plans")
      .update(values)
      .eq("org_id", orgId)
      .eq("id", id);
    fail(error);
    return id;
  }
  const { data, error } = await supabase
    .from("business_plans")
    .insert({ ...values, org_id: orgId, created_by: createdBy } as never)
    .select("id")
    .single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteBusinessPlan(supabase: Db, orgId: string, id: string) {
  const { error } = await supabase.from("business_plans").delete().eq("org_id", orgId).eq("id", id);
  fail(error);
}

export async function saveBusinessPlanLine(
  supabase: Db,
  orgId: string,
  id: string | null,
  values: Record<string, unknown>,
): Promise<string> {
  if (id) {
    const { error } = await supabase
      .from("business_plan_lines")
      .update(values)
      .eq("org_id", orgId)
      .eq("id", id);
    fail(error);
    return id;
  }
  const { data, error } = await supabase
    .from("business_plan_lines")
    .insert({ ...values, org_id: orgId } as never)
    .select("id")
    .single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteBusinessPlanLine(supabase: Db, orgId: string, id: string) {
  const { error } = await supabase
    .from("business_plan_lines")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  fail(error);
}

/** Replaces every line on a plan in one pass — used by allocation and seeding. */
export async function replacePlanLines(
  supabase: Db,
  orgId: string,
  planId: string,
  rows: Record<string, unknown>[],
) {
  const { error: delErr } = await supabase
    .from("business_plan_lines")
    .delete()
    .eq("org_id", orgId)
    .eq("plan_id", planId);
  fail(delErr);
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("business_plan_lines")
    .insert(rows.map((r) => ({ ...r, org_id: orgId, plan_id: planId })) as never);
  fail(error);
}
