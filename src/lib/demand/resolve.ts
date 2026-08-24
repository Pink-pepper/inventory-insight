/**
 * Demand Book resolution.
 *
 * The Demand Book is an EVIDENCE layer, not an additive list. The same
 * commercial event usually appears several times — as a requirement, then an
 * opportunity, then a quotation, then an LPO, and finally as an actual sale.
 * Summing those sources would multiply one piece of business by four. This
 * module turns overlapping evidence into ONE resolved demand picture, and
 * records exactly why each number is what it is.
 *
 * Resolution rules (all of them are tested in resolve.test.ts):
 *
 *  1. GROUPING. Signals are grouped by the commercial event they describe:
 *     customer + product + expected period. A signal that explicitly points
 *     at another (supersedesId) always joins that signal's group, even when
 *     the period drifted.
 *
 *  2. SUPERSEDING. Inside a group only the highest-certainty signal counts.
 *     actual > confirmed > committed > high_confidence > active > expected >
 *     speculative. So an LPO supersedes its quotation, a quotation supersedes
 *     its opportunity, and a realised sale supersedes everything. Ties are
 *     broken by the later expected period, then the larger quantity, so the
 *     result is deterministic. Every loser is reported with the id and reason.
 *
 *  3. HISTORY IS A BASELINE, NOT AN ADDITION. Historical sales describe what
 *     a product normally does. Named commercial demand for the same product
 *     and period is assumed to be part of that normal run rate, so it CONSUMES
 *     the baseline rather than stacking on top of it: only the part of the
 *     baseline that named commitments do not already claim is carried.
 *
 *  4. UNCERTAIN DEMAND IS INCREMENTAL AND PROBABILITY-ADJUSTED. Opportunities,
 *     requirements and planner adjustments below "committed" are potential
 *     business above the run rate, counted at their stated probability. The
 *     probability is the planner's own commercial judgement — it is displayed,
 *     never invented, and never hidden inside a black-box forecast.
 *
 *  5. NOTHING ELSE IS INFERRED. Market signals and lost/cancelled/expired
 *     records never contribute a quantity; they only appear as evidence.
 */
import type {
  DemandCertainty,
  DemandSignalRecord,
} from "@/lib/domain/commercial";
import { certaintyRank, isCommitted, isLiveStatus } from "@/lib/domain/commercial";

/** A history observation, already aggregated to the resolution period. */
export interface HistoryBaselinePoint {
  productId: string;
  sku: string;
  productName?: string;
  period: string;
  quantity: number;
}

export type ContributionKind = "committed" | "baseline" | "potential";

/** One line of the "why" behind a resolved number. */
export interface DemandContribution {
  kind: ContributionKind;
  label: string;
  quantity: number;
  signalId: string | null;
  customerName: string | null;
  source: string;
  certainty: DemandCertainty | null;
  probability: number | null;
  notes: string | null;
}

/** A signal that lost to a stronger one, kept so the trail stays visible. */
export interface SupersededSignal {
  signalId: string;
  supersededById: string;
  reason: string;
  quantity: number;
  customerName: string | null;
  source: string;
  certainty: DemandCertainty;
}

export interface ResolvedDemandRow {
  productId: string;
  sku: string;
  productName: string;
  period: string;
  /** Demand the business has committed to serve. */
  committedQty: number;
  /** Historical run rate not already claimed by a commitment. */
  baselineQty: number;
  /** Probability-adjusted upside from uncertain commercial evidence. */
  potentialQty: number;
  /** committed + baseline + potential. The single number planning consumes. */
  resolvedQty: number;
  /** Highest certainty present in the winning evidence. */
  certainty: DemandCertainty | null;
  contributions: DemandContribution[];
  superseded: SupersededSignal[];
}

export interface ResolveInput {
  signals: DemandSignalRecord[];
  history: HistoryBaselinePoint[];
}

const groupKey = (customerId: string | null, productId: string, period: string) =>
  `${customerId ?? "unattributed"}|${productId}|${period}`;

/** Deterministic winner: certainty, then later period, then larger quantity, then id. */
function beats(a: DemandSignalRecord, b: DemandSignalRecord) {
  const ra = certaintyRank(a.certainty);
  const rb = certaintyRank(b.certainty);
  if (ra !== rb) return ra > rb;
  if (a.expectedPeriod !== b.expectedPeriod) return a.expectedPeriod > b.expectedPeriod;
  if (a.quantity !== b.quantity) return a.quantity > b.quantity;
  return a.id > b.id;
}

/**
 * Groups overlapping evidence and picks one winner per commercial event.
 * Exported so the UI can show the same trail the calculation used.
 */
export function resolveGroups(signals: DemandSignalRecord[]) {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const keyOf = new Map<string, string>();

  // Explicit supersede links pull a signal into the group of what it replaces.
  const resolveKey = (s: DemandSignalRecord, seen = new Set<string>()): string => {
    const cached = keyOf.get(s.id);
    if (cached) return cached;
    if (s.supersedesId && byId.has(s.supersedesId) && !seen.has(s.id)) {
      seen.add(s.id);
      const key = resolveKey(byId.get(s.supersedesId)!, seen);
      keyOf.set(s.id, key);
      return key;
    }
    const key = groupKey(s.customerId, s.productId, s.expectedPeriod);
    keyOf.set(s.id, key);
    return key;
  };

  const groups = new Map<string, DemandSignalRecord[]>();
  for (const s of signals) {
    const key = resolveKey(s);
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const winners: DemandSignalRecord[] = [];
  const superseded: SupersededSignal[] = [];
  for (const members of groups.values()) {
    let winner = members[0]!;
    for (const s of members.slice(1)) if (beats(s, winner)) winner = s;
    winners.push(winner);
    for (const s of members) {
      if (s.id === winner.id) continue;
      superseded.push({
        signalId: s.id,
        supersededById: winner.id,
        reason:
          certaintyRank(s.certainty) === certaintyRank(winner.certainty)
            ? "Duplicate evidence for the same commercial event"
            : `Superseded by stronger evidence (${winner.source})`,
        quantity: s.quantity,
        customerName: s.customerName,
        source: s.source,
        certainty: s.certainty,
      });
    }
  }
  return { winners, superseded };
}

/** Signals that can carry a quantity at all. */
const carriesQuantity = (s: DemandSignalRecord) =>
  isLiveStatus(s.status) && s.source !== "market" && s.source !== "history" && s.quantity > 0;

export function resolveDemandBook({ signals, history }: ResolveInput): ResolvedDemandRow[] {
  const { winners, superseded } = resolveGroups(signals);
  const supersededByWinner = new Map<string, SupersededSignal[]>();
  for (const s of superseded) {
    const list = supersededByWinner.get(s.supersededById) ?? [];
    list.push(s);
    supersededByWinner.set(s.supersededById, list);
  }

  interface Cell {
    productId: string;
    sku: string;
    productName: string;
    period: string;
    committed: DemandSignalRecord[];
    potential: DemandSignalRecord[];
    baseline: number;
    superseded: SupersededSignal[];
  }
  const cells = new Map<string, Cell>();
  const cellOf = (productId: string, sku: string, name: string, period: string) => {
    const key = `${productId}|${period}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        productId,
        sku,
        productName: name,
        period,
        committed: [],
        potential: [],
        baseline: 0,
        superseded: [],
      };
      cells.set(key, cell);
    }
    return cell;
  };

  for (const point of history) {
    const cell = cellOf(point.productId, point.sku, point.productName ?? point.sku, point.period);
    cell.baseline += point.quantity;
  }

  for (const s of winners) {
    const cell = cellOf(s.productId, s.sku, s.productName, s.expectedPeriod);
    if (cell.productName === cell.sku && s.productName) cell.productName = s.productName;
    cell.superseded.push(...(supersededByWinner.get(s.id) ?? []));
    if (!carriesQuantity(s)) continue;
    if (isCommitted(s.certainty)) cell.committed.push(s);
    else cell.potential.push(s);
  }

  const rows: ResolvedDemandRow[] = [];
  for (const cell of cells.values()) {
    const contributions: DemandContribution[] = [];
    let committedQty = 0;
    let strongest: DemandCertainty | null = null;

    for (const s of cell.committed) {
      committedQty += s.quantity;
      if (!strongest || certaintyRank(s.certainty) > certaintyRank(strongest)) strongest = s.certainty;
      contributions.push({
        kind: "committed",
        label: `${s.customerName ?? "Unattributed"} — ${s.source}`,
        quantity: s.quantity,
        signalId: s.id,
        customerName: s.customerName,
        source: s.source,
        certainty: s.certainty,
        probability: s.probability,
        notes: s.notes,
      });
    }

    // Rule 3: commitments consume the historical run rate, they do not stack.
    const baselineQty = Math.max(0, cell.baseline - committedQty);
    if (cell.baseline > 0) {
      contributions.push({
        kind: "baseline",
        label:
          committedQty > 0
            ? `Historical run rate not already covered by commitments (${Math.round(cell.baseline)} historical − ${Math.round(committedQty)} committed)`
            : "Historical run rate",
        quantity: baselineQty,
        signalId: null,
        customerName: null,
        source: "history",
        certainty: null,
        probability: null,
        notes: null,
      });
    }

    let potentialQty = 0;
    for (const s of cell.potential) {
      const p = s.probability == null ? 1 : Math.min(1, Math.max(0, s.probability));
      const qty = s.quantity * p;
      potentialQty += qty;
      if (!strongest || certaintyRank(s.certainty) > certaintyRank(strongest)) strongest = s.certainty;
      contributions.push({
        kind: "potential",
        label: `${s.customerName ?? "Unattributed"} — ${s.source}${
          s.probability == null ? "" : ` at ${Math.round(p * 100)}% confidence`
        }`,
        quantity: qty,
        signalId: s.id,
        customerName: s.customerName,
        source: s.source,
        certainty: s.certainty,
        probability: s.probability,
        notes: s.notes,
      });
    }

    const resolvedQty = committedQty + baselineQty + potentialQty;
    if (resolvedQty === 0 && contributions.length === 0 && cell.superseded.length === 0) continue;

    rows.push({
      productId: cell.productId,
      sku: cell.sku,
      productName: cell.productName,
      period: cell.period,
      committedQty,
      baselineQty,
      potentialQty,
      resolvedQty,
      certainty: strongest,
      contributions,
      superseded: cell.superseded,
    });
  }

  rows.sort((a, b) => a.sku.localeCompare(b.sku) || a.period.localeCompare(b.period));
  return rows;
}

/** Plain-language explanation of one resolved row, for progressive disclosure. */
export function explainResolvedRow(row: ResolvedDemandRow): string[] {
  const lines: string[] = [];
  if (row.committedQty > 0)
    lines.push(`${Math.round(row.committedQty)} units are committed by customers.`);
  if (row.baselineQty > 0)
    lines.push(
      `${Math.round(row.baselineQty)} units come from the historical run rate that commitments do not already cover.`,
    );
  if (row.potentialQty > 0)
    lines.push(
      `${Math.round(row.potentialQty)} units are potential business, counted at the confidence recorded against each opportunity.`,
    );
  if (row.superseded.length > 0)
    lines.push(
      `${row.superseded.length} earlier ${row.superseded.length === 1 ? "signal was" : "signals were"} superseded and deliberately not counted again.`,
    );
  if (lines.length === 0) lines.push("No demand evidence for this product and period.");
  return lines;
}
