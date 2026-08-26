/**
 * Commercial projects.
 *
 * A project is real work being pursued with a customer: one customer can have
 * several, and one project can span several products. Requirements,
 * opportunities, quotations and orders are *linked* to a project — they are
 * never copied into it, so demand is never counted twice.
 */

export const PROJECT_STAGES = [
  "identified",
  "engaged",
  "requirement_confirmed",
  "rfq",
  "sampling",
  "negotiation",
  "customer_decision",
  "won",
  "fulfilment",
  "delivered",
  "lost",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const STAGE_LABEL: Record<ProjectStage, string> = {
  identified: "Identified",
  engaged: "Engaged",
  requirement_confirmed: "Requirement confirmed",
  rfq: "RFQ / proposal",
  sampling: "Sampling / trial",
  negotiation: "Negotiation",
  customer_decision: "Customer decision",
  won: "Won / order",
  fulfilment: "Fulfilment",
  delivered: "Delivered",
  lost: "Lost",
};

/** Stages that mean the project is no longer being actively pursued. */
export const CLOSED_STAGES: ProjectStage[] = ["delivered", "lost"];

export const isActiveStage = (s: ProjectStage) => !CLOSED_STAGES.includes(s);

export interface ProjectProductLine {
  id: string;
  projectId: string;
  productId: string | null;
  sku: string | null;
  productName: string | null;
  quantity: number | null;
  unit: string | null;
  expectedUnitPrice: number | null;
  currencyCode: string | null;
  notes: string | null;
}

export interface ProjectActivity {
  id: string;
  projectId: string;
  occurredOn: string;
  kind: string;
  summary: string;
  detail: string | null;
}

export interface ProjectRecord {
  id: string;
  customerId: string | null;
  customerName: string | null;
  name: string;
  stage: ProjectStage;
  status: string;
  expectedValue: number | null;
  currencyCode: string | null;
  expectedClose: string | null;
  owner: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  products: ProjectProductLine[];
  activities: ProjectActivity[];
}

/**
 * Potential value: what the operator has explicitly said the project is worth,
 * otherwise the sum of its product lines. Never a guess when neither exists.
 */
export function projectValue(p: ProjectRecord): number | null {
  if (p.expectedValue != null) return p.expectedValue;
  const lines = p.products.filter((l) => l.quantity != null && l.expectedUnitPrice != null);
  if (lines.length === 0) return null;
  return lines.reduce((sum, l) => sum + (l.quantity ?? 0) * (l.expectedUnitPrice ?? 0), 0);
}
