import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolveOrg, audit } from "@/lib/data/repository";
import {
  deleteSupplyRecord,
  loadSupplyBook,
  saveSupplyRecord,
  type SupplyTable,
} from "@/lib/data/supply-repository";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max = 500) => z.string().max(max).trim();
const qty = z.number().finite().min(0).max(1_000_000_000);
const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);

/** Everything the Supply section renders, in one round trip. */
export const getSupplyBook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return loadSupplyBook(supabase, orgId);
  });

const recordSchemas = {
  supplier_products: z.object({
    supplier_id: uuid,
    product_id: uuid,
    supplier_price: money.nullable().optional(),
    currency_code: text(8).nullable().optional(),
    min_order_qty: z.number().int().min(0).max(10_000_000).nullable().optional(),
    lead_time_days: z.number().int().min(0).max(3650).nullable().optional(),
    // The record editor submits selects as strings; both shapes mean the same thing.
    is_active: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true"),
    notes: text(2000).nullable().optional(),
  }),
  cost_components: z.object({
    product_id: uuid.nullable().optional(),
    supplier_id: uuid.nullable().optional(),
    shipment_id: uuid.nullable().optional(),
    kind: z.enum(["freight", "duty", "clearance", "other", "fx"]),
    label: text(120).nullable().optional(),
    amount: money,
    basis: z.enum(["per_unit", "per_shipment", "percent_of_value"]),
    currency_code: text(8).nullable().optional(),
    effective_from: isoDate.nullable().optional(),
    notes: text(2000).nullable().optional(),
  }),
  shipments: z.object({
    supplier_id: uuid.nullable().optional(),
    location_id: uuid.nullable().optional(),
    reference: text(80).min(1),
    mode: text(40).nullable().optional(),
    status: z.enum([
      "planned",
      "booked",
      "in_transit",
      "arrived",
      "clearing",
      "cleared",
      "delivered",
      "cancelled",
    ]),
    etd: isoDate.nullable().optional(),
    eta: isoDate.nullable().optional(),
    revised_eta: isoDate.nullable().optional(),
    arrived_on: isoDate.nullable().optional(),
    cleared_on: isoDate.nullable().optional(),
    delivered_on: isoDate.nullable().optional(),
    incoterm: text(20).nullable().optional(),
    currency_code: text(8).nullable().optional(),
    fx_rate: z.number().finite().min(0).max(1_000_000).nullable().optional(),
    notes: text(2000).nullable().optional(),
  }),
  shipment_lines: z.object({
    shipment_id: uuid,
    purchase_order_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    quantity: qty,
    unit_cost: money.nullable().optional(),
    notes: text(2000).nullable().optional(),
  }),
} as const;

const saveInput = z.discriminatedUnion("table", [
  z.object({
    table: z.literal("supplier_products"),
    id: uuid.nullable(),
    values: recordSchemas.supplier_products,
  }),
  z.object({
    table: z.literal("cost_components"),
    id: uuid.nullable(),
    values: recordSchemas.cost_components,
  }),
  z.object({ table: z.literal("shipments"), id: uuid.nullable(), values: recordSchemas.shipments }),
  z.object({
    table: z.literal("shipment_lines"),
    id: uuid.nullable(),
    values: recordSchemas.shipment_lines,
  }),
]);

/**
 * Create or update one supply record. Mass assignment is impossible: the
 * schema above is the entire writable surface, and org_id is server-derived.
 */
export const saveSupplyRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(saveInput.parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveSupplyRecord(
      supabase,
      orgId,
      data.table as SupplyTable,
      data.id,
      data.values as Record<string, unknown>,
    );
    await audit(supabase, orgId, userId, data.id ? "supply.update" : "supply.create", {
      entity: data.table,
      recordId: id,
    });
    return { id };
  });

export const deleteSupplyRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      table: z.enum(["supplier_products", "cost_components", "shipments", "shipment_lines"]),
      id: uuid,
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteSupplyRecord(supabase, orgId, data.table as SupplyTable, data.id);
    await audit(supabase, orgId, userId, "supply.delete", {
      entity: data.table,
      recordId: data.id,
    });
    return { ok: true };
  });
