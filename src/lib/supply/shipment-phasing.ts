/**
 * Shipment phasing — a purchase order is a commitment, a shipment is the
 * arrival. One PO can arrive across several shipments, so the outstanding
 * quantity is split across the shipments allocated to it, each carrying its
 * own effective ETA.
 *
 * Invariants (covered by tests):
 *  - the split never creates or destroys quantity: the segments always sum to
 *    the PO line's outstanding quantity;
 *  - allocations beyond the outstanding quantity are clipped, never trusted;
 *  - whatever is not allocated to a shipment keeps the PO's own expected date,
 *    so a workspace with no shipment records behaves exactly as before.
 *
 * Pure functions only.
 */
import { effectiveEta, type ShipmentStatus } from "@/lib/domain/supply-chain";

export interface ShipmentAllocation {
  poId: string;
  shipmentId: string;
  shipmentReference: string;
  status: ShipmentStatus;
  quantity: number;
  eta: string | null;
  revisedEta: string | null;
  arrivedOn: string | null;
}

export interface PhasedSegment<T> {
  line: T;
  quantity: number;
  expectedAt: string | null;
  shipmentId: string | null;
  shipmentReference: string | null;
  shipmentStatus: ShipmentStatus | null;
}

/**
 * Splits one PO line's outstanding quantity across its shipment allocations,
 * earliest expected arrival first.
 */
export function phaseLineByShipments<T extends { poId: string; outstanding: number; expectedAt: string | null }>(
  line: T,
  allocations: ShipmentAllocation[],
): PhasedSegment<T>[] {
  const mine = allocations
    .filter((a) => a.poId === line.poId && a.status !== "cancelled" && a.quantity > 0)
    .map((a) => ({ ...a, effective: effectiveEta(a) }))
    .sort((a, b) => (a.effective ?? "9999-12-31").localeCompare(b.effective ?? "9999-12-31"));

  const segments: PhasedSegment<T>[] = [];
  let remaining = Math.max(0, line.outstanding);
  for (const a of mine) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, a.quantity);
    remaining -= quantity;
    segments.push({
      line,
      quantity,
      expectedAt: a.effective,
      shipmentId: a.shipmentId,
      shipmentReference: a.shipmentReference,
      shipmentStatus: a.status,
    });
  }
  if (remaining > 0 || segments.length === 0) {
    segments.push({
      line,
      quantity: remaining,
      expectedAt: line.expectedAt,
      shipmentId: null,
      shipmentReference: null,
      shipmentStatus: null,
    });
  }
  return segments.filter((s) => s.quantity > 0 || segments.length === 1);
}
