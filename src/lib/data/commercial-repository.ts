/**
 * Commercial data access — customers, contacts, requirements, opportunities,
 * quotations, customer orders, market signals and the Demand Book.
 *
 * Same contract as the main repository: storage rows in, domain records out.
 * Tenant scoping is always applied here with an org id the caller derived
 * server-side from membership; it is never accepted from a client.
 */
import type { Db } from "./repository";
import type {
  BusinessBook,
  ChannelKind,
  CommercialStatus,
  ContactRecord,
  CustomerOrderRecord,
  CustomerRecord,
  DemandCertainty,
  DemandSignalRecord,
  DemandSignalSource,
  MarketSignalImpact,
  MarketSignalRecord,
  OpportunityRecord,
  QuotationRecord,
  RequirementRecord,
} from "@/lib/domain/commercial";

type Named = { id: string; name: string } | null;
type Prod = { id: string; sku: string; name: string } | null;

const nm = (v: unknown) => (v as Named)?.name ?? null;
const sku = (v: unknown) => (v as Prod)?.sku ?? null;
const pname = (v: unknown) => (v as Prod)?.name ?? null;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listCustomers(supabase: Db, orgId: string): Promise<CustomerRecord[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, external_ref, name, segment")
    .eq("org_id", orgId)
    .order("name");
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    externalRef: r.external_ref,
    name: r.name,
    segment: r.segment,
  }));
}

export async function listContacts(supabase: Db, orgId: string): Promise<ContactRecord[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, customer_id, name, role, email, phone, notes, customers(id, name)")
    .eq("org_id", orgId)
    .order("name");
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    name: r.name,
    role: r.role,
    email: r.email,
    phone: r.phone,
    notes: r.notes,
  }));
}

export async function listRequirements(supabase: Db, orgId: string): Promise<RequirementRecord[]> {
  const { data, error } = await supabase
    .from("requirements")
    .select(
      "id, customer_id, product_id, quantity, unit, period_start, period_end, channel, status, notes, customers(id, name), products(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("period_start", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    channel: r.channel as ChannelKind,
    status: r.status as CommercialStatus,
    notes: r.notes,
  }));
}

export async function listOpportunities(supabase: Db, orgId: string): Promise<OpportunityRecord[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select(
      "id, customer_id, product_id, requirement_id, title, quantity, unit, expected_period, expected_unit_price, currency_code, probability, channel, status, notes, customers(id, name), products(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("expected_period", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    requirementId: r.requirement_id,
    title: r.title,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    expectedPeriod: r.expected_period,
    expectedUnitPrice: r.expected_unit_price == null ? null : Number(r.expected_unit_price),
    currencyCode: r.currency_code,
    probability: Number(r.probability ?? 0),
    channel: r.channel as ChannelKind,
    status: r.status as CommercialStatus,
    notes: r.notes,
  }));
}

export async function listQuotations(supabase: Db, orgId: string): Promise<QuotationRecord[]> {
  const { data, error } = await supabase
    .from("quotations")
    .select(
      "id, customer_id, product_id, opportunity_id, reference, quantity, unit, unit_price, currency_code, expected_period, issued_on, valid_until, channel, status, notes, customers(id, name), products(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("expected_period", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    opportunityId: r.opportunity_id,
    reference: r.reference,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    unitPrice: r.unit_price == null ? null : Number(r.unit_price),
    currencyCode: r.currency_code,
    expectedPeriod: r.expected_period,
    issuedOn: r.issued_on,
    validUntil: r.valid_until,
    channel: r.channel as ChannelKind,
    status: r.status as CommercialStatus,
    notes: r.notes,
  }));
}

export async function listCustomerOrders(
  supabase: Db,
  orgId: string,
): Promise<CustomerOrderRecord[]> {
  const { data, error } = await supabase
    .from("customer_orders")
    .select(
      "id, customer_id, product_id, quotation_id, reference, quantity, unit, unit_price, currency_code, period_start, period_end, channel, confirmation, status, notes, customers(id, name), products(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("period_start", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products),
    productName: pname(r.products),
    quotationId: r.quotation_id,
    reference: r.reference,
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    unitPrice: r.unit_price == null ? null : Number(r.unit_price),
    currencyCode: r.currency_code,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    channel: r.channel as ChannelKind,
    confirmation: r.confirmation,
    status: r.status as CommercialStatus,
    notes: r.notes,
  }));
}

export async function listMarketSignals(supabase: Db, orgId: string): Promise<MarketSignalRecord[]> {
  const { data, error } = await supabase
    .from("market_signals")
    .select(
      "id, customer_id, product_id, supplier_id, kind, title, detail, impact, observed_on, customers(id, name), products(id, sku, name), suppliers(id, name)",
    )
    .eq("org_id", orgId)
    .order("observed_on", { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products),
    supplierId: r.supplier_id,
    supplierName: nm(r.suppliers),
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    impact: r.impact as MarketSignalImpact,
    observedOn: r.observed_on,
  }));
}

export async function listDemandSignals(
  supabase: Db,
  orgId: string,
): Promise<DemandSignalRecord[]> {
  const { data, error } = await supabase
    .from("demand_signals")
    .select(
      "id, customer_id, product_id, quantity, unit, expected_period, channel, source, certainty, probability, status, unit_price, currency_code, notes, source_record_type, source_record_id, supersedes_id, customers(id, name), products(id, sku, name)",
    )
    .eq("org_id", orgId)
    .order("expected_period");
  fail(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: nm(r.customers),
    productId: r.product_id,
    sku: sku(r.products) ?? "",
    productName: pname(r.products) ?? "",
    quantity: Number(r.quantity ?? 0),
    unit: r.unit,
    expectedPeriod: r.expected_period,
    channel: r.channel as ChannelKind,
    source: r.source as DemandSignalSource,
    certainty: r.certainty as DemandCertainty,
    probability: r.probability == null ? null : Number(r.probability),
    status: r.status as CommercialStatus,
    unitPrice: r.unit_price == null ? null : Number(r.unit_price),
    currencyCode: r.currency_code,
    notes: r.notes,
    sourceRecordType: r.source_record_type,
    sourceRecordId: r.source_record_id,
    supersedesId: r.supersedes_id,
  }));
}

/** Minimal product and supplier pickers for the Business screens. */
export async function listPickerProducts(supabase: Db, orgId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name")
    .eq("org_id", orgId)
    .order("sku");
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id, sku: r.sku, name: r.name }));
}

export async function listPickerSuppliers(supabase: Db, orgId: string) {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export async function loadBusinessBook(supabase: Db, orgId: string): Promise<BusinessBook> {
  const [
    customers,
    contacts,
    requirements,
    opportunities,
    quotations,
    customerOrders,
    marketSignals,
    products,
    suppliers,
  ] =
    await Promise.all([
      listCustomers(supabase, orgId),
      listContacts(supabase, orgId),
      listRequirements(supabase, orgId),
      listOpportunities(supabase, orgId),
      listQuotations(supabase, orgId),
      listCustomerOrders(supabase, orgId),
      listMarketSignals(supabase, orgId),
      listPickerProducts(supabase, orgId),
      listPickerSuppliers(supabase, orgId),
    ]);
  return {
    customers,
    contacts,
    requirements,
    opportunities,
    quotations,
    customerOrders,
    marketSignals,
    products,
    suppliers,
  };
}

/** Tables the generic commercial writer is allowed to touch. */
export const COMMERCIAL_TABLES = [
  "contacts",
  "requirements",
  "opportunities",
  "quotations",
  "customer_orders",
  "market_signals",
  "demand_signals",
] as const;

export type CommercialTable = (typeof COMMERCIAL_TABLES)[number];

/**
 * Insert or update one commercial record. `org_id` is forced from the
 * server-derived tenant, so a client cannot write into another workspace even
 * if it supplies one.
 */
export async function saveCommercialRecord(
  supabase: Db,
  orgId: string,
  table: CommercialTable,
  id: string | null,
  values: Record<string, unknown>,
) {
  // The writable surface is validated by the caller's zod schema; the storage
  // row type is a union across seven tables, so one cast at this boundary
  // keeps the rest of the layer typed.
  const payload = { ...values, org_id: orgId } as never;
  if (id) {
    const { error } = await supabase.from(table).update(payload).eq("id", id).eq("org_id", orgId);
    fail(error);
    return id;
  }
  const { data, error } = await supabase.from(table).insert(payload).select("id").single();
  fail(error);
  return (data as { id: string }).id;
}

export async function deleteCommercialRecord(
  supabase: Db,
  orgId: string,
  table: CommercialTable,
  id: string,
) {
  const { error } = await supabase.from(table).delete().eq("id", id).eq("org_id", orgId);
  fail(error);
}

/**
 * Historical run rate projected forward.
 *
 * Reads observed monthly sales, averages the trailing window per product and
 * carries that average across the forward horizon. This is the SAME idea the
 * planning baseline uses — an average of observed history, nothing inferred —
 * expressed at the product/period grain the Demand Book resolves on.
 */
export async function loadHistoryBaseline(
  supabase: Db,
  orgId: string,
  opts: { windowMonths?: number; horizonMonths?: number } = {},
) {
  const windowMonths = opts.windowMonths ?? 12;
  const horizonMonths = opts.horizonMonths ?? 6;
  const [{ data: products, error: pErr }, { data: sales, error: sErr }] = await Promise.all([
    supabase.from("products").select("id, sku, name").eq("org_id", orgId),
    supabase.from("sales").select("product_id, period_month, quantity").eq("org_id", orgId),
  ]);
  fail(pErr);
  fail(sErr);

  const now = new Date();
  const monthStart = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
  const windowFrom = monthStart(-windowMonths);
  const today = monthStart(0);

  const totals = new Map<string, { qty: number; months: Set<string> }>();
  for (const row of sales ?? []) {
    const period = String(row.period_month);
    if (period < windowFrom || period >= today) continue;
    const entry = totals.get(row.product_id) ?? { qty: 0, months: new Set<string>() };
    entry.qty += Number(row.quantity ?? 0);
    entry.months.add(period);
    totals.set(row.product_id, entry);
  }

  const periods = Array.from({ length: horizonMonths }, (_, i) => monthStart(i));
  const points = [] as {
    productId: string;
    sku: string;
    productName: string;
    period: string;
    quantity: number;
  }[];
  for (const product of products ?? []) {
    const entry = totals.get(product.id);
    if (!entry || entry.months.size === 0) continue;
    const perMonth = entry.qty / entry.months.size;
    if (perMonth <= 0) continue;
    for (const period of periods) {
      points.push({
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        period,
        quantity: perMonth,
      });
    }
  }
  return { points, periods, productNames: new Map((products ?? []).map((p) => [p.id, p.name])) };
}
