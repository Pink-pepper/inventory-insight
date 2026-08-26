/**
 * Organisation planning policy.
 *
 * Every parameter is optional: "not configured" is a real state, never a
 * silently applied default. `resolveEngineConfig` merges only the fields an
 * organisation has actually set on top of the engine defaults, so a workspace
 * without a policy produces exactly the numbers it produced before policies
 * existed.
 */

export type ProductDisplay = "sku" | "name" | "sku_name";

export type DemandMethod = "trailing_average";

/** Parameters the decision engine reads today. */
export interface ConsumedPlanningParameters {
  /** Months of history used for the demand average. */
  demandWindowMonths: number | null;
  /** Forward demand a single order should cover, beyond the lead time. */
  planningHorizonDays: number | null;
  /** Safety buffer used when a product does not declare its own. */
  safetyStockDays: number | null;
  /** Lead time used when neither the product nor its supplier declares one. */
  defaultLeadTimeDays: number | null;
  /** MOQ used when neither the product nor its supplier declares one. */
  defaultMinOrderQty: number | null;
  /** Order quantities are rounded up to this multiple when set. */
  orderMultiple: number | null;
}

/**
 * Parameters stored for future planning packages. They are persisted and
 * validated but do NOT influence any calculation in the current engine.
 */
export interface StoredPlanningParameters {
  reorderPointOverride: number | null;
  minimumStockLevel: number | null;
  targetStockLevel: number | null;
  daysOfCoverTarget: number | null;
  serviceLevel: number | null;
  demandMethod: DemandMethod | null;
  demandGrowthPct: number | null;
  seasonalityEnabled: boolean | null;
  demandVariability: number | null;
  leadTimeVariabilityDays: number | null;
}

export interface PlanningPolicy extends ConsumedPlanningParameters, StoredPlanningParameters {
  productDisplay: ProductDisplay;
  /** Currency the workspace reads figures in. Stored amounts are never rewritten. */
  displayCurrency: string | null;
  /** Manual rates: units of the display currency per 1 unit of the base currency. */
  fxRates: Record<string, number>;
}

/** Field names that currently change recommendation output. */
export const CONSUMED_POLICY_FIELDS: (keyof ConsumedPlanningParameters)[] = [
  "demandWindowMonths",
  "planningHorizonDays",
  "safetyStockDays",
  "defaultLeadTimeDays",
  "defaultMinOrderQty",
  "orderMultiple",
];

/** An unconfigured policy: every parameter null, display preference at its default. */
export const EMPTY_PLANNING_POLICY: PlanningPolicy = {
  demandWindowMonths: null,
  planningHorizonDays: null,
  safetyStockDays: null,
  defaultLeadTimeDays: null,
  defaultMinOrderQty: null,
  orderMultiple: null,
  reorderPointOverride: null,
  minimumStockLevel: null,
  targetStockLevel: null,
  daysOfCoverTarget: null,
  serviceLevel: null,
  demandMethod: null,
  demandGrowthPct: null,
  seasonalityEnabled: null,
  demandVariability: null,
  leadTimeVariabilityDays: null,
  productDisplay: "sku_name",
  displayCurrency: null,
  fxRates: {},
};

/** How a product is labelled across the application. */
export function formatProductLabel(
  display: ProductDisplay,
  sku: string,
  name: string,
): string {
  if (display === "sku") return sku;
  if (display === "name") return name || sku;
  return name ? `${sku} · ${name}` : sku;
}