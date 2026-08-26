import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { audit, resolveOrg } from "@/lib/data/repository";
import {
  addProjectActivity,
  deleteProject,
  deleteProjectProduct,
  linkRecordToProject,
  listProjects,
  saveProject,
  saveProjectProduct,
} from "@/lib/data/project-repository";
import { PROJECT_STAGES } from "@/lib/domain/project";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max = 500) => z.string().max(max).trim();
const qty = z.number().finite().min(0).max(1_000_000_000);

export const getProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return listProjects(supabase, orgId);
  });

const projectSchema = z.object({
  customer_id: uuid.nullable().optional(),
  name: text(200).min(1),
  stage: z.enum(PROJECT_STAGES),
  status: z.enum(["open", "won", "lost", "cancelled"]).optional(),
  expected_value: qty.nullable().optional(),
  currency_code: text(3).nullable().optional(),
  expected_close: isoDate.nullable().optional(),
  owner: text(120).nullable().optional(),
  notes: text(4000).nullable().optional(),
});

export const saveProjectRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid.nullable().optional(), values: projectSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveProject(supabase, orgId, data.id ?? null, data.values);
    await audit(supabase, orgId, userId, data.id ? "project.update" : "project.create", { id });
    return { id };
  });

export const removeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteProject(supabase, orgId, data.id);
    await audit(supabase, orgId, userId, "project.delete", { id: data.id });
    return { ok: true };
  });

const lineSchema = z.object({
  project_id: uuid,
  product_id: uuid.nullable().optional(),
  quantity: qty.nullable().optional(),
  unit: text(20).nullable().optional(),
  expected_unit_price: qty.nullable().optional(),
  currency_code: text(3).nullable().optional(),
  notes: text(2000).nullable().optional(),
});

export const saveProjectLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid.nullable().optional(), values: lineSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveProjectProduct(supabase, orgId, data.id ?? null, data.values);
    return { id };
  });

export const removeProjectLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteProjectProduct(supabase, orgId, data.id);
    return { ok: true };
  });

export const logProjectActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        project_id: uuid,
        occurred_on: isoDate,
        kind: text(40).min(1),
        summary: text(300).min(1),
        detail: text(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await addProjectActivity(supabase, orgId, data);
    return { id };
  });

export const linkProjectRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        table: z.enum(["requirements", "opportunities", "quotations", "customer_orders"]),
        recordId: uuid,
        projectId: uuid.nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await linkRecordToProject(supabase, orgId, data.table, data.recordId, data.projectId);
    return { ok: true };
  });
