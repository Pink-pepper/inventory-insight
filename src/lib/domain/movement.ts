/**
 * Inventory movement semantics.
 *
 * Movements are a record-keeping domain: Ionic stores them with full
 * provenance, but no planning engine consumes them yet. The declarative
 * registry below is the single place where the business meaning of each
 * movement class lives — when a later package wires movements into demand or
 * inventory reconciliation, it reads these flags instead of hard-coding
 * per-class rules.
 *
 * Conservative defaults (Workstream 6.5b): only `sale` counts as demand,
 * revenue and COGS. Every class affects inventory in the direction of its
 * signed quantity. Changing a flag is a business-rule decision and belongs
 * to the planning-engine audit, not to ingestion.
 */
export type MovementClass =
  | "sale"
  | "consumption"
  | "sampling"
  | "promotional"
  | "service_use"
  | "damage"
  | "expiry"
  | "quality_loss"
  | "return"
  | "adjustment"
  | "transfer"
  | "assembly"
  | "other";

export interface MovementSemantics {
  affectsInventory: boolean;
  countsAsDemand: boolean;
  countsAsRevenue: boolean;
  countsAsCogs: boolean;
}

export const MOVEMENT_SEMANTICS: Record<MovementClass, MovementSemantics> = {
  sale: { affectsInventory: true, countsAsDemand: true, countsAsRevenue: true, countsAsCogs: true },
  consumption: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  sampling: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  promotional: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  service_use: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  damage: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  expiry: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  quality_loss: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  return: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  adjustment: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  transfer: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  assembly: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
  other: { affectsInventory: true, countsAsDemand: false, countsAsRevenue: false, countsAsCogs: false },
};

/**
 * Reason words → movement class. Deterministic vocabulary only — the first
 * matching pattern wins, so more specific classes are listed before general
 * ones ("sample" before "issue"). Unknown reasons map to "other"; the
 * verbatim reason is always kept alongside the class.
 */
const CLASS_PATTERNS: [MovementClass, RegExp][] = [
  ["sampling", /sampl/],
  ["promotional", /promo|marketing|gift|free\s?issue|giveaway/],
  ["service_use", /service|warranty|repair|loaner/],
  ["damage", /damag|broken|defect|destr/],
  ["expiry", /expir|out.?of.?date|obsolete|perish/],
  ["quality_loss", /quality|quarantine|\bqc\b|reject/],
  ["return", /return|\brma\b|credit\s?note|sent\s?back/],
  ["transfer", /transfer|relocat|inter.?site|\bmoved?\b/],
  ["assembly", /assembl|\bkit|\bbom\b|production|manufactur|build/],
  ["consumption", /consum|usage|\bused\b|issue[sd]?|internal|withdraw/],
  ["adjustment", /adjust|correct|recount|cycle\s?count|stock\s?count|write.?off|shrink/],
  ["sale", /\bsale[sd]?\b|\bsold\b|customer|invoice/],
];

/** Maps a verbatim source reason onto a movement class. */
export function movementClassFromReason(reason: string | null | undefined): MovementClass {
  const key = (reason ?? "").trim().toLowerCase();
  if (!key) return "other";
  for (const [cls, pattern] of CLASS_PATTERNS) {
    if (pattern.test(key)) return cls;
  }
  return "other";
}

/**
 * Value-scan evidence for the classifier: the share of sampled values in a
 * type/reason column that look like movement vocabulary. Used to promote a
 * sheet whose *headers* are generic (e.g. "Type") but whose *values* are
 * movement words.
 */
export function movementValueShare(samples: string[]): number {
  const nonEmpty = samples.map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  if (nonEmpty.length === 0) return 0;
  const hits = nonEmpty.filter((s) => CLASS_PATTERNS.some(([, p]) => p.test(s))).length;
  return hits / nonEmpty.length;
}
