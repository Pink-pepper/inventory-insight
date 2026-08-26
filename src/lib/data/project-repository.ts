/**
 * Project data access. Projects group the commercial records that already
 * exist; linking is a foreign key on those records, never a copy of them.
 */
import type { Db } from "./repository";
import type {
  ProjectActivity,
  ProjectProductLine,
  ProjectRecord,
  ProjectStage,
} from "@/lib/domain/project";

type Named = { id: string; name: string } | null;
type Prod = { id: string; sku: string; name: string } | null;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listProjects(supabase: Db, orgId: string): Promise<ProjectRecord[]> {
  const [{ data, error }, { data: lines, error: lErr }, { data: acts, error: aErr }] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, customer_id, name, stage, status, expected_value, currency_code, expected_close, owner, notes, created_at, updated_at, customers(id, name)",
        )
        .eq("org_id", orgId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("project_products")
        .select(
          "id, project_id, product_id, quantity, unit, expected_unit_price, currency_code, notes, products(id, sku, name)",
        )
        .eq("org_id", orgId),
      supabase
        .from("project_activities")
        .select("id, project_id, occurred_on, kind, summary, detail")
        .eq("org_id", orgId)
        .order("occurred_on", { ascending: false }),
    ]);
  fail(error);
  fail(lErr);
  fail(aErr);

  const linesByProject = new Map<string, ProjectProductLine[]>();
  for (const r of lines ?? []) {
    const p = r.products as unknown as Prod;
    const list = linesByProject.get(r.project_id) ?? [];
    list.push({
      id: r.id,
      projectId: r.project_id,
      productId: r.product_id,
      sku: p?.sku ?? null,
      productName: p?.name ?? null,
      quantity: r.quantity == null ? null : Number(r.quantity),
      unit: r.unit,
      expectedUnitPrice: r.expected_unit_price == null ? null : Number(r.expected_unit_price),
      currencyCode: r.currency_code,
      notes: r.notes,
    });
    linesByProject.set(r.project_id, list);
  }

  const actsByProject = new Map<string, ProjectActivity[]>();
  for (const r of acts ?? []) {
    const list = actsByProject.get(r.project_id) ?? [];
    list.push({
      id: r.id,
      projectId: r.project_id,
      occurredOn: r.occurred_on,
      kind: r.kind,
      summary: r.summary,
      detail: r.detail,
    });
    actsByProject.set(r.project_id, list);
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: (r.customers as unknown as Named)?.name ?? null,
    name: r.name,
    stage: r.stage as ProjectStage,
    status: r.status,
    expectedValue: r.expected_value == null ? null : Number(r.expected_value),
    currencyCode: r.currency_code,
    expectedClose: r.expected_close,
    owner: r.owner,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    products: linesByProject.get(r.id) ?? [],
    activities: actsByProject.get(r.id) ?? [],
  }));
}

export async function saveProject(
  supabase: Db,
  orgId: string,
  id: string | null,
  values: Record<string, unknown>,
): Promise<string> {
  if (id) {
    const { error } = await supabase.from("projects").update(values).eq("org_id", orgId).eq("id", id);
    fail(error);
    return id;
  }
  const { data, error } = await supabase
    .from("projects")
    .insert({ ...values, org_id: orgId } as never)
    .select("id")
    .single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteProject(supabase: Db, orgId: string, id: string) {
  const { error } = await supabase.from("projects").delete().eq("org_id", orgId).eq("id", id);
  fail(error);
}

export async function saveProjectProduct(
  supabase: Db,
  orgId: string,
  id: string | null,
  values: Record<string, unknown>,
): Promise<string> {
  if (id) {
    const { error } = await supabase
      .from("project_products")
      .update(values)
      .eq("org_id", orgId)
      .eq("id", id);
    fail(error);
    return id;
  }
  const { data, error } = await supabase
    .from("project_products")
    .insert({ ...values, org_id: orgId } as never)
    .select("id")
    .single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteProjectProduct(supabase: Db, orgId: string, id: string) {
  const { error } = await supabase
    .from("project_products")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  fail(error);
}

export async function addProjectActivity(
  supabase: Db,
  orgId: string,
  values: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase
    .from("project_activities")
    .insert({ ...values, org_id: orgId } as never)
    .select("id")
    .single();
  fail(error);
  return (data as { id: string }).id;
}

/**
 * Links an existing commercial record to a project. The record keeps its own
 * identity and its demand signal; the project simply gains context.
 */
export async function linkRecordToProject(
  supabase: Db,
  orgId: string,
  table: "requirements" | "opportunities" | "quotations" | "customer_orders",
  recordId: string,
  projectId: string | null,
) {
  const { error } = await supabase
    .from(table)
    .update({ project_id: projectId } as never)
    .eq("org_id", orgId)
    .eq("id", recordId);
  fail(error);
}
