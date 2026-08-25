import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { resolveOrg, audit } from "@/lib/data/repository";
import {
  deleteCommercialRecord,
  listDemandSignals,
  loadBusinessBook,
  loadHistoryBaseline,
  saveCommercialRecord,
  type CommercialTable,
} from "@/lib/data/commercial-repository";
import { resolveDemandBook } from "@/lib/demand/resolve";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max = 500) => z.string().max(max).trim();
const channel = z.enum(["direct_shipment", "dropship", "stock"]);
const status = z.enum(["open", "won", "lost", "cancelled", "expired", "superseded", "fulfilled"]);
const qty = z.number().finite().min(0).max(1_000_000_000);
const price = z.number().finite().min(0).max(1_000_000_000);

/** Everything the Business section renders, in one round trip. */
export const getBusinessBook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    return loadBusinessBook(supabase, orgId);
  });

/**
 * The Demand Book: every signal, plus the single resolved demand picture the
 * planning chain consumes. Resolution happens in one place only.
 */
export const getDemandBook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const [signals, baseline] = await Promise.all([
      listDemandSignals(supabase, orgId),
      loadHistoryBaseline(supabase, orgId),
    ]);
    const horizon = new Set(baseline.periods);
    const forward = signals.filter(
      (s) => horizon.has(s.expectedPeriod) || s.expectedPeriod >= (baseline.periods[0] ?? ""),
    );
    const rows = resolveDemandBook({ signals: forward, history: baseline.points });
    return { signals, rows, periods: baseline.periods };
  });

const recordSchemas = {
  contacts: z.object({
    customer_id: uuid.nullable().optional(),
    name: text(120).min(1),
    role: text(120).nullable().optional(),
    email: text(200).nullable().optional(),
    phone: text(60).nullable().optional(),
    notes: text(2000).nullable().optional(),
  }),
  requirements: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    quantity: qty,
    unit: text(20).nullable().optional(),
    period_start: isoDate,
    period_end: isoDate.nullable().optional(),
    channel,
    status,
    notes: text(2000).nullable().optional(),
  }),
  opportunities: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    title: text(200).min(1),
    quantity: qty,
    unit: text(20).nullable().optional(),
    expected_period: isoDate,
    expected_unit_price: price.nullable().optional(),
    currency_code: text(8).nullable().optional(),
    probability: z.number().min(0).max(1),
    channel,
    status,
    notes: text(2000).nullable().optional(),
  }),
  quotations: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    opportunity_id: uuid.nullable().optional(),
    reference: text(80).nullable().optional(),
    quantity: qty,
    unit: text(20).nullable().optional(),
    unit_price: price.nullable().optional(),
    currency_code: text(8).nullable().optional(),
    expected_period: isoDate,
    issued_on: isoDate.nullable().optional(),
    valid_until: isoDate.nullable().optional(),
    channel,
    status,
    notes: text(2000).nullable().optional(),
  }),
  customer_orders: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    quotation_id: uuid.nullable().optional(),
    reference: text(80).nullable().optional(),
    quantity: qty,
    unit: text(20).nullable().optional(),
    unit_price: price.nullable().optional(),
    currency_code: text(8).nullable().optional(),
    period_start: isoDate,
    period_end: isoDate.nullable().optional(),
    channel,
    confirmation: text(400).nullable().optional(),
    status,
    notes: text(2000).nullable().optional(),
  }),
  market_signals: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid.nullable().optional(),
    supplier_id: uuid.nullable().optional(),
    kind: text(60).min(1),
    title: text(200).min(1),
    detail: text(2000).nullable().optional(),
    impact: z.enum(["risk", "opportunity", "informational"]),
    observed_on: isoDate,
  }),
  demand_signals: z.object({
    customer_id: uuid.nullable().optional(),
    product_id: uuid,
    quantity: qty,
    unit: text(20).nullable().optional(),
    expected_period: isoDate,
    channel,
    source: z.enum([
      "history",
      "requirement",
      "opportunity",
      "quotation",
      "lpo",
      "order",
      "market",
      "planner",
    ]),
    certainty: z.enum([
      "speculative",
      "expected",
      "active",
      "high_confidence",
      "committed",
      "confirmed",
      "actual",
    ]),
    probability: z.number().min(0).max(1).nullable().optional(),
    status,
    unit_price: price.nullable().optional(),
    currency_code: text(8).nullable().optional(),
    notes: text(2000).nullable().optional(),
    source_record_type: text(40).nullable().optional(),
    source_record_id: uuid.nullable().optional(),
    supersedes_id: uuid.nullable().optional(),
  }),
} as const;

const saveInput = z.discriminatedUnion("table", [
  z.object({ table: z.literal("contacts"), id: uuid.nullable(), values: recordSchemas.contacts }),
  z.object({ table: z.literal("requirements"), id: uuid.nullable(), values: recordSchemas.requirements }),
  z.object({ table: z.literal("opportunities"), id: uuid.nullable(), values: recordSchemas.opportunities }),
  z.object({ table: z.literal("quotations"), id: uuid.nullable(), values: recordSchemas.quotations }),
  z.object({ table: z.literal("customer_orders"), id: uuid.nullable(), values: recordSchemas.customer_orders }),
  z.object({ table: z.literal("market_signals"), id: uuid.nullable(), values: recordSchemas.market_signals }),
  z.object({ table: z.literal("demand_signals"), id: uuid.nullable(), values: recordSchemas.demand_signals }),
]);

/** Create or update one commercial record. Mass assignment is impossible: the
 * schema above is the entire writable surface, and org_id is server-derived. */
export const saveBusinessRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(saveInput.parse)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const id = await saveCommercialRecord(
      supabase,
      orgId,
      data.table as CommercialTable,
      data.id,
      data.values as Record<string, unknown>,
    );
    await audit(supabase, orgId, userId, data.id ? "commercial.update" : "commercial.create", {
      entity: data.table,
      recordId: id,
    });
    return { id };
  });

export const deleteBusinessRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      table: z.enum([
        "contacts",
        "requirements",
        "opportunities",
        "quotations",
        "customer_orders",
        "market_signals",
        "demand_signals",
      ]),
      id: uuid,
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    await deleteCommercialRecord(supabase, orgId, data.table as CommercialTable, data.id);
    await audit(supabase, orgId, userId, "commercial.delete", {
      entity: data.table,
      recordId: data.id,
    });
    return { ok: true };
  });

/**
 * Promote a commercial record into the Demand Book. This is the ONLY way a
 * commercial record becomes demand, so the resolver always knows which signal
 * came from which record and can supersede the weaker evidence.
 */
export const promoteToDemandBook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      recordType: z.enum(["requirement", "opportunity", "quotation", "customer_order"]),
      recordId: uuid,
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { orgId } = await resolveOrg(supabase, userId);
    const book = await loadBusinessBook(supabase, orgId);
    const existing = await listDemandSignals(supabase, orgId);

    type Draft = {
      customer_id: string | null;
      product_id: string | null;
      quantity: number;
      unit: string | null;
      expected_period: string;
      channel: string;
      source: string;
      certainty: string;
      probability: number | null;
      unit_price: number | null;
      currency_code: string | null;
      notes: string | null;
    };

    let draft: Draft | null = null;
    if (data.recordType === "requirement") {
      const r = book.requirements.find((x) => x.id === data.recordId);
      if (r)
        draft = {
          customer_id: r.customerId,
          product_id: r.productId,
          quantity: r.quantity,
          unit: r.unit,
          expected_period: r.periodStart,
          channel: r.channel,
          source: "requirement",
          certainty: "expected",
          probability: null,
          unit_price: null,
          currency_code: null,
          notes: r.notes,
        };
    } else if (data.recordType === "opportunity") {
      const o = book.opportunities.find((x) => x.id === data.recordId);
      if (o)
        draft = {
          customer_id: o.customerId,
          product_id: o.productId,
          quantity: o.quantity,
          unit: o.unit,
          expected_period: o.expectedPeriod,
          channel: o.channel,
          source: "opportunity",
          certainty: o.probability >= 0.7 ? "high_confidence" : "active",
          probability: o.probability,
          unit_price: o.expectedUnitPrice,
          currency_code: o.currencyCode,
          notes: o.notes,
        };
    } else if (data.recordType === "quotation") {
      const q = book.quotations.find((x) => x.id === data.recordId);
      if (q)
        draft = {
          customer_id: q.customerId,
          product_id: q.productId,
          quantity: q.quantity,
          unit: q.unit,
          expected_period: q.expectedPeriod,
          channel: q.channel,
          source: "quotation",
          certainty: "high_confidence",
          probability: null,
          unit_price: q.unitPrice,
          currency_code: q.currencyCode,
          notes: q.notes,
        };
    } else {
      const c = book.customerOrders.find((x) => x.id === data.recordId);
      if (c)
        draft = {
          customer_id: c.customerId,
          product_id: c.productId,
          quantity: c.quantity,
          unit: c.unit,
          expected_period: c.periodStart,
          channel: c.channel,
          source: c.confirmation ? "order" : "lpo",
          certainty: c.confirmation ? "confirmed" : "committed",
          probability: null,
          unit_price: c.unitPrice,
          currency_code: c.currencyCode,
          notes: c.notes,
        };
    }

    if (!draft || !draft.product_id) {
      throw new Error("This record needs a product before it can enter the Demand Book.");
    }

    // Link to the weaker evidence it replaces so the resolver never counts both.
    const supersedes =
      existing.find(
        (s) =>
          s.customerId === draft!.customer_id &&
          s.productId === draft!.product_id &&
          s.expectedPeriod === draft!.expected_period,
      )?.id ?? null;

    const already = existing.find(
      (s) => s.sourceRecordType === data.recordType && s.sourceRecordId === data.recordId,
    );

    const id = await saveCommercialRecord(supabase, orgId, "demand_signals", already?.id ?? null, {
      ...draft,
      status: "open",
      source_record_type: data.recordType,
      source_record_id: data.recordId,
      supersedes_id: supersedes === already?.id ? null : supersedes,
    });
    await audit(supabase, orgId, userId, "demand.signal.promoted", {
      recordType: data.recordType,
      recordId: data.recordId,
      signalId: id,
    });
    return { id };
  });
