/**
 * Commercial domain — the B2B distributor's demand-side objects.
 *
 * These are the shapes the UI consumes. Storage rows are mapped into them at
 * the repository boundary; no component ever sees a raw database column.
 */

/** How a unit of business reaches the customer. Channel changes economics. */
export type ChannelKind = "direct_shipment" | "dropship" | "stock";

export const CHANNEL_KINDS: ChannelKind[] = ["direct_shipment", "dropship", "stock"];

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  direct_shipment: "Direct shipment",
  dropship: "Dropship",
  stock: "Stock",
};

/** Where a demand signal came from. */
export type DemandSignalSource =
  | "history"
  | "requirement"
  | "opportunity"
  | "quotation"
  | "lpo"
  | "order"
  | "market"
  | "planner";

export const DEMAND_SOURCES: DemandSignalSource[] = [
  "history",
  "requirement",
  "opportunity",
  "quotation",
  "lpo",
  "order",
  "market",
  "planner",
];

export const SOURCE_LABEL: Record<DemandSignalSource, string> = {
  history: "Historical sales",
  requirement: "Customer requirement",
  opportunity: "Opportunity",
  quotation: "Quotation",
  lpo: "LPO",
  order: "Customer order",
  market: "Market signal",
  planner: "Planner judgement",
};

/**
 * How sure the business is. This is a commercial judgement backed by
 * evidence, not a statistical output.
 */
export type DemandCertainty =
  | "speculative"
  | "expected"
  | "active"
  | "high_confidence"
  | "committed"
  | "confirmed"
  | "actual";

export const CERTAINTY_ORDER: DemandCertainty[] = [
  "speculative",
  "expected",
  "active",
  "high_confidence",
  "committed",
  "confirmed",
  "actual",
];

export const CERTAINTY_LABEL: Record<DemandCertainty, string> = {
  speculative: "Speculative",
  expected: "Expected",
  active: "Active / negotiating",
  high_confidence: "High confidence",
  committed: "Committed",
  confirmed: "Confirmed",
  actual: "Actual",
};

/** Rank used when one signal supersedes another. Higher wins. */
export const certaintyRank = (c: DemandCertainty) => CERTAINTY_ORDER.indexOf(c);

/** Committed and above is demand the business has to be able to serve. */
export const isCommitted = (c: DemandCertainty) => certaintyRank(c) >= certaintyRank("committed");

export type CommercialStatus =
  | "open"
  | "won"
  | "lost"
  | "cancelled"
  | "expired"
  | "superseded"
  | "fulfilled";

export const COMMERCIAL_STATUSES: CommercialStatus[] = [
  "open",
  "won",
  "lost",
  "cancelled",
  "expired",
  "superseded",
  "fulfilled",
];

/** Statuses that keep a record in the live demand picture. */
export const isLiveStatus = (s: CommercialStatus) => s === "open" || s === "won";

export interface CustomerRecord {
  id: string;
  externalRef: string;
  name: string;
  segment: string | null;
}

export interface ContactRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

export interface RequirementRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  quantity: number;
  unit: string | null;
  periodStart: string;
  periodEnd: string | null;
  channel: ChannelKind;
  status: CommercialStatus;
  notes: string | null;
}

export interface OpportunityRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  requirementId: string | null;
  title: string;
  quantity: number;
  unit: string | null;
  expectedPeriod: string;
  expectedUnitPrice: number | null;
  currencyCode: string | null;
  probability: number;
  channel: ChannelKind;
  status: CommercialStatus;
  notes: string | null;
}

export interface QuotationRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  opportunityId: string | null;
  reference: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  currencyCode: string | null;
  expectedPeriod: string;
  issuedOn: string | null;
  validUntil: string | null;
  channel: ChannelKind;
  status: CommercialStatus;
  notes: string | null;
}

export interface CustomerOrderRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  quotationId: string | null;
  reference: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  currencyCode: string | null;
  periodStart: string;
  periodEnd: string | null;
  channel: ChannelKind;
  confirmation: string | null;
  status: CommercialStatus;
  notes: string | null;
}

export type MarketSignalImpact = "risk" | "opportunity" | "informational";

export const MARKET_SIGNAL_KINDS = [
  "competitor_pricing",
  "competitor_availability",
  "supplier_change",
  "market_gap",
  "consumption_change",
  "new_product",
  "supply_disruption",
  "regulatory",
] as const;

export type MarketSignalKind = (typeof MARKET_SIGNAL_KINDS)[number];

export const MARKET_SIGNAL_LABEL: Record<MarketSignalKind, string> = {
  competitor_pricing: "Competitor pricing",
  competitor_availability: "Competitor availability",
  supplier_change: "Supplier change",
  market_gap: "Market gap",
  consumption_change: "Customer consumption change",
  new_product: "New product opportunity",
  supply_disruption: "Supply disruption",
  regulatory: "Regulatory / commercial condition",
};

export interface MarketSignalRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  sku: string | null;
  supplierId: string | null;
  supplierName: string | null;
  kind: string;
  title: string;
  detail: string | null;
  impact: MarketSignalImpact;
  observedOn: string;
}

/** One piece of demand evidence in the Demand Book. */
export interface DemandSignalRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unit: string | null;
  expectedPeriod: string;
  channel: ChannelKind;
  source: DemandSignalSource;
  certainty: DemandCertainty;
  probability: number | null;
  status: CommercialStatus;
  unitPrice: number | null;
  currencyCode: string | null;
  notes: string | null;
  /** The commercial record this signal was derived from, when there is one. */
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  supersedesId: string | null;
}

/** Everything the Business section renders. */
export interface BusinessBook {
  customers: CustomerRecord[];
  contacts: ContactRecord[];
  requirements: RequirementRecord[];
  opportunities: OpportunityRecord[];
  quotations: QuotationRecord[];
  customerOrders: CustomerOrderRecord[];
  marketSignals: MarketSignalRecord[];
  products: { id: string; sku: string; name: string }[];
  suppliers: { id: string; name: string }[];
}
