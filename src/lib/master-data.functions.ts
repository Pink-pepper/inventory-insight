import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { audit, resolveOrg } from "@/lib/data/repository";
import {
  loadProductMaster,
  loadSupplierMaster,
  updateProductMaster,
  updateSupplierMaster,
} from "@/lib/data/master-repository";

const uuid = z.string().uuid();
const text = (max = 500) => z.string().max(max).trim();
const numeric = z.number().finite().min(0).max(1_000_000_000);

export const getProductMaster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return loadProductMaster(supabase, orgId);
  });

export const getSupplierMaster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return loadSupplierMaster(supabase, orgId);
  });

const productSchema = z.object({
  name: text(200).min(1).optional(),
  category: text(80).optional(),
  is_active: z.boolean().optional(),
  unit_price: numeric.nullable().optional(),
  unit_cost: numeric.optional(),
  pack_size: numeric.nullable().optional(),
  pack_uom: text(20).nullable().optional(),
  specification: text(4000).nullable().optional(),
  regulatory_notes: text(4000).nullable().optional(),
  is_hazardous: z.boolean().nullable().optional(),
  lead_time_days: z.number().int().min(0).max(3650).nullable().optional(),
  min_order_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

export const saveProductMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, values: productSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await updateProductMaster(supabase, orgId, data.id, data.values);
    await audit(supabase, orgId, userId, "product.update", { id: data.id });
    return { ok: true };
  });

const supplierSchema = z.object({
  name: text(200).min(1).optional(),
  code: text(40).nullable().optional(),
  external_ref: text(80).nullable().optional(),
  country: text(80).nullable().optional(),
  payment_terms: text(120).nullable().optional(),
  incoterm: text(20).nullable().optional(),
  is_active: z.boolean().optional(),
  notes: text(4000).nullable().optional(),
  lead_time_days: z.number().int().min(0).max(3650).optional(),
  min_order_qty: z.number().int().min(0).max(10_000_000).optional(),
});

export const saveSupplierMaster = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, values: supplierSchema }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await updateSupplierMaster(supabase, orgId, data.id, data.values);
    await audit(supabase, orgId, userId, "supplier.update", { id: data.id });
    return { ok: true };
  });
