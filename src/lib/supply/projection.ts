/**
 * Time-phased stock projection.
 *
 * Pure arithmetic over the position a SKU starts from: each projected period
 * subtracts the planned demand and adds the receipts scheduled to land in it.
 * Nothing is optimised and nothing is hidden — the series the UI draws is
 * exactly this list of numbers.
 */

export interface ProjectionPoint {
  /** ISO date, first of the month. */
  periodStart: string;
  demand: number;
  receipts: number;
  projectedOnHand: number;
}

export interface ProjectionResult {
  points: ProjectionPoint[];
  /** Lowest projected position across the horizon, receipts included. */
  lowPoint: number;
  /** First period whose projected position goes negative. */
  firstStockout: string | null;
  /** First period whose projected position falls below safety stock. */
  firstBelowSafety: string | null;
  /** First period whose projected position falls below the reorder point. */
  firstBelowReorder: string | null;
  /** First projected period that receives scheduled inbound stock. */
  firstReceiptPeriod: string | null;
}

const monthOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `count` consecutive month starts, the first being the month of `startAfter`'s successor. */
export function futureMonthStarts(startPeriod: string, count: number): string[] {
  const starts: string[] = [];
  let cursor = monthOf(startPeriod);
  for (let i = 0; i < count; i++) {
    starts.push(cursor);
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    cursor = d.toISOString().slice(0, 10);
  }
  return starts;
}

/**
 * Projects the aggregate position across the given periods.
 *
 * Receipts dated before the first projected period are past due; they are
 * assumed to land in the first period rather than being dropped. The UI states
 * this assumption wherever the projection is shown.
 */
export function projectPosition(input: {
  onHand: number;
  plannedPerPeriod: number;
  periods: string[];
  receipts: { expectedAt: string; quantity: number }[];
  safetyStock: number;
  reorderPoint: number;
}): ProjectionResult {
  const first = input.periods[0];
  const receiptByPeriod = new Map<string, number>();
  if (first) {
    for (const r of input.receipts) {
      if (r.quantity <= 0) continue;
      const bucket = monthOf(r.expectedAt) < first ? first : monthOf(r.expectedAt);
      receiptByPeriod.set(bucket, (receiptByPeriod.get(bucket) ?? 0) + r.quantity);
    }
  }

  let prev = input.onHand;
  // The low point is the lowest PROJECTED position only. The starting on-hand
  // is deliberately excluded: a deficit today that scheduled receipts already
  // cover is not a reason to buy more.
  let lowPoint = Number.POSITIVE_INFINITY;
  let firstStockout: string | null = null;
  let firstBelowSafety: string | null = null;
  let firstBelowReorder: string | null = null;
  const points: ProjectionPoint[] = [];

  for (const periodStart of input.periods) {
    const receipts = receiptByPeriod.get(periodStart) ?? 0;
    const projected = prev - input.plannedPerPeriod + receipts;
    points.push({
      periodStart,
      demand: round2(input.plannedPerPeriod),
      receipts: round2(receipts),
      projectedOnHand: round2(projected),
    });
    if (projected < lowPoint) lowPoint = projected;
    if (firstStockout === null && projected < 0) firstStockout = periodStart;
    if (firstBelowSafety === null && projected < input.safetyStock) firstBelowSafety = periodStart;
    if (firstBelowReorder === null && projected < input.reorderPoint) firstBelowReorder = periodStart;
    prev = projected;
  }

  const firstReceiptPeriod = input.periods.find((p) => (receiptByPeriod.get(p) ?? 0) > 0) ?? null;
  return {
    points,
    lowPoint: round2(lowPoint),
    firstStockout,
    firstBelowSafety,
    firstBelowReorder,
    firstReceiptPeriod,
  };
}
