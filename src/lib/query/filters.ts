/**
 * Shared planning filter specification.
 *
 * One validated shape used by every server function that lists planning data,
 * so future screens never invent their own query contract. Filters are applied
 * server-side; tenant scoping is NEVER part of this spec — org_id is always
 * derived from the authenticated membership.
 */
import { z } from "zod";
import type { TimeGrain } from "@/lib/domain/time-grain";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

const list = (max: number) => z.array(z.string().min(1).max(120)).max(max).optional();

export const planningFilterSchema = z.object({
  skus: list(500),
  categories: list(100),
  supplierCodes: list(200),
  locationCodes: list(200),
  regions: list(100),
  statesProvinces: list(100),
  countries: list(50),
  channelCodes: list(200),
  customerRefs: list(200),
  from: isoDate.optional(),
  to: isoDate.optional(),
  grain: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  compare: z.enum(["none", "prev", "yoy"]).optional(),
  search: z.string().max(120).optional(),
});

/** Dimensions the demand workspace can pivot by. */
export const DEMAND_DIMENSIONS = [
  "product",
  "category",
  "supplier",
  "channel",
  "customer",
  "location",
  "region",
  "state_province",
] as const;

export type DemandDimension = (typeof DEMAND_DIMENSIONS)[number];

/** Comparison window applied to the selected period. */
export const COMPARE_MODES = ["none", "prev", "yoy"] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export type PlanningFilter = z.infer<typeof planningFilterSchema>;

export const EMPTY_FILTER: PlanningFilter = {};

export const filterGrain = (filter: PlanningFilter): TimeGrain => filter.grain ?? "month";

/** Facts a row must expose to be filterable. Deliberately storage-agnostic. */
export interface FilterableRow {
  sku: string;
  name?: string;
  category?: string;
  supplierCode?: string;
  locationCodes?: string[];
  regions?: string[];
  statesProvinces?: string[];
  countries?: string[];
  channelCodes?: string[];
  customerRefs?: string[];
}

const matches = (values: string[] | undefined, allowed: string[] | undefined) => {
  if (!allowed || allowed.length === 0) return true;
  if (!values || values.length === 0) return false;
  return values.some((v) => allowed.includes(v));
};

/** In-memory application of the spec, for datasets already loaded server-side. */
export function applyPlanningFilter<T extends FilterableRow>(
  rows: T[],
  filter: PlanningFilter,
): T[] {
  const search = filter.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matches([row.sku], filter.skus)) return false;
    if (!matches(row.category ? [row.category] : [], filter.categories)) return false;
    if (!matches(row.supplierCode ? [row.supplierCode] : [], filter.supplierCodes)) return false;
    if (!matches(row.locationCodes, filter.locationCodes)) return false;
    if (!matches(row.regions, filter.regions)) return false;
    if (!matches(row.statesProvinces, filter.statesProvinces)) return false;
    if (!matches(row.countries, filter.countries)) return false;
    if (!matches(row.channelCodes, filter.channelCodes)) return false;
    if (!matches(row.customerRefs, filter.customerRefs)) return false;
    if (search) {
      const haystack = `${row.sku} ${row.name ?? ""} ${row.category ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/** Inclusive ISO date-range test, used for period-scoped facts. */
export function withinRange(date: string, filter: PlanningFilter): boolean {
  const day = date.slice(0, 10);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  return true;
}