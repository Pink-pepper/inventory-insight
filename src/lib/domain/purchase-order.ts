/**
 * Purchase order fulfilment status — a DERIVED view, never a stored enum.
 *
 * The stored lifecycle (`po_status`) records what the source system said;
 * fulfilment is computed from it plus the received quantity, so the two can
 * never drift out of sync. Approval state lives in its own column and is
 * deliberately untouched here.
 */
import type { PurchaseOrderApprovalStatus, PurchaseOrderStatus } from "./model";

export type FulfilmentStatus =
  | "open"
  | "partially_received"
  | "delivered"
  | "closed"
  | "cancelled";

export const FULFILMENT_STATUSES: FulfilmentStatus[] = [
  "open",
  "partially_received",
  "delivered",
  "closed",
  "cancelled",
];

export interface FulfilmentInput {
  status: PurchaseOrderStatus;
  quantity: number;
  receivedQuantity: number;
}

export function fulfilmentStatus(po: FulfilmentInput): FulfilmentStatus {
  if (po.status === "cancelled") return "cancelled";
  if (po.status === "closed") return "closed";
  if (po.status === "received") return "delivered";
  // A draft PO is not yet supply; from the planner's fulfilment view it is open.
  const received = Math.min(Math.max(0, po.receivedQuantity), po.quantity);
  if (po.quantity > 0 && received >= po.quantity) return "delivered";
  if (received > 0) return "partially_received";
  return "open";
}

export const FULFILMENT_LABELS: Record<FulfilmentStatus, string> = {
  open: "Open",
  partially_received: "Partially received",
  delivered: "Delivered",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const APPROVAL_LABELS: Record<PurchaseOrderApprovalStatus, string> = {
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};
