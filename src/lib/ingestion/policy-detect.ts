import { cell, type SheetTable } from "./sheet-table";
import { headerKey, type ColumnMapping } from "./mapping";
import { looksLikeRange, isQualitative } from "./profile";
import { safeText } from "./validate";

/**
 * Planning-policy detection: parameter/value sheets are mined for values that
 * belong to the workspace's existing Planning Policy. Nothing here writes
 * anything — output is a list of PROPOSALS the user explicitly accepts or
 * keeps. Ranges and qualitative values are never collapsed to scalars.
 */

export type PolicyProposalStatus = "ready" | "review";

export interface PolicyProposal {
  sheet: string;
  /** PlanningPolicy field this parameter maps to (camelCase key). */
  field: string;
  /** The workbook's own parameter label. */
  label: string;
  rawValue: string;
  /** Parsed value; null when the value cannot be represented faithfully. */
  proposed: number | boolean | null;
  unit: string | null;
  /** organisation-wide default, or tied to a specific SKU/supplier/location. */
  scope: "organisation" | "specific";
  scopeRef: string | null;
  status: PolicyProposalStatus;
  reason: string;
}

type ParameterKind = "days" | "months" | "percent" | "ratio" | "count" | "bool";

interface ParameterTarget {
  field: string;
  kind: ParameterKind;
  label: string;
}

/** Normalised parameter labels → planning policy fields. Structure-driven:
 *  the sheet must look like a parameter sheet before any of these fire. */
const PARAMETER_MAP: [RegExp, ParameterTarget][] = [
  [/^(cycle_)?service_level(_target|_pct|_percent)?$|^target_service_level$|^fill_rate_target$|^service_target$/, { field: "serviceLevel", kind: "ratio", label: "Service level" }],
  [/^(planning|forecast)_horizon$|^horizon$|^planning_horizon_(days|months)$|^forecast_horizon_(days|months)$/, { field: "planningHorizonDays", kind: "days", label: "Planning horizon" }],
  [/^(demand|history|averaging)_window$|^demand_window_months$|^history_months$|^demand_history(_months)?$/, { field: "demandWindowMonths", kind: "months", label: "Demand history window" }],
  [/^safety_stock(_days)?$|^buffer_days$|^safety_days$|^safety_stock_days$/, { field: "safetyStockDays", kind: "days", label: "Safety stock" }],
  [/^(default_)?lead_time(_days)?$|^supplier_lead_time$/, { field: "defaultLeadTimeDays", kind: "days", label: "Default lead time" }],
  [/^(default_)?moq$|^(default_)?min(imum)?_order_(qty|quantity)$/, { field: "defaultMinOrderQty", kind: "count", label: "Default minimum order quantity" }],
  [/^order_multiple$|^pack_size$|^order_rounding$|^rounding_multiple$/, { field: "orderMultiple", kind: "count", label: "Order multiple" }],
  [/^demand_growth(_pct|_percent|_rate)?$|^growth_rate$|^expected_growth$/, { field: "demandGrowthPct", kind: "percent", label: "Demand growth" }],
  [/^seasonality(_enabled)?$|^seasonal$/, { field: "seasonalityEnabled", kind: "bool", label: "Seasonality" }],
];

const BOOL_TRUE = new Set(["yes", "true", "enabled", "on", "y", "1"]);
const BOOL_FALSE = new Set(["no", "false", "disabled", "off", "n", "0"]);

interface ParsedValue {
  value: number | boolean | null;
  unit: string | null;
  reviewReason: string | null;
}

/** Parses one parameter value. Ranges, tolerances and qualitative words are
 *  recognised and refused — Ionic never picks a midpoint or a bound. */
function parseParameterValue(raw: string, kind: ParameterKind): ParsedValue {
  const v = raw.trim();
  if (v === "") return { value: null, unit: null, reviewReason: "The value is empty." };

  if (kind === "bool") {
    const key = v.toLowerCase();
    if (BOOL_TRUE.has(key)) return { value: true, unit: null, reviewReason: null };
    if (BOOL_FALSE.has(key)) return { value: false, unit: null, reviewReason: null };
    return { value: null, unit: null, reviewReason: `"${v}" is not a clear yes/no value.` };
  }

  if (looksLikeRange(v)) {
    return {
      value: null,
      unit: null,
      reviewReason: `The workbook specifies a range ("${v}") but the Ionic policy holds a single value — review instead of guessing.`,
    };
  }
  if (isQualitative(v)) {
    return {
      value: null,
      unit: null,
      reviewReason: `"${v}" is qualitative; the Ionic policy needs a number — review.`,
    };
  }

  const unitMatch = /^([+-]?\d+(?:\.\d+)?)\s*(%|percent|days?|weeks?|months?|x|units?)?$/i.exec(v);
  if (!unitMatch) {
    return { value: null, unit: null, reviewReason: `"${v}" is not a recognisable numeric value.` };
  }
  let n = Number(unitMatch[1]);
  const unit = (unitMatch[2] ?? "").toLowerCase();

  if (kind === "ratio") {
    if (unit === "%" || unit === "percent" || n > 1) n = n / 100;
    if (n < 0 || n > 1) return { value: null, unit: null, reviewReason: `Service level "${v}" is outside 0–100%.` };
    return { value: n, unit: unit || null, reviewReason: null };
  }
  if (kind === "percent") {
    if (unit === "x") return { value: null, unit, reviewReason: `"${v}" is a multiplier, not a growth percentage — review.` };
    return { value: n, unit: unit || "%", reviewReason: null };
  }
  if (kind === "days") {
    if (unit.startsWith("week")) n = n * 7;
    else if (unit.startsWith("month")) n = n * 30;
    return { value: Math.round(n), unit: unit || "days", reviewReason: null };
  }
  if (kind === "months") {
    if (unit.startsWith("day")) {
      return { value: null, unit, reviewReason: `"${v}" is in days but the policy expects months — review.` };
    }
    return { value: Math.round(n), unit: unit || "months", reviewReason: null };
  }
  // count
  if (unit && !unit.startsWith("unit")) {
    return { value: null, unit, reviewReason: `Unit "${unit}" is unusual for a quantity — review.` };
  }
  return { value: Math.round(n), unit: unit || null, reviewReason: null };
}

function targetFor(parameterText: string): ParameterTarget | null {
  const key = headerKey(parameterText);
  if (key === "") return null;
  for (const [pattern, target] of PARAMETER_MAP) {
    if (pattern.test(key)) return target;
  }
  return null;
}

/**
 * Extracts policy proposals from a sheet already classified as a parameter
 * sheet. Rows carrying a SKU/supplier/location are specific-scope and always
 * need review — they never overwrite organisation-level policy silently.
 */
export function extractPolicyProposals(sheet: SheetTable, mapping: ColumnMapping): PolicyProposal[] {
  const paramCol = mapping["parameter"];
  const valueCol = mapping["param_value"];
  if (paramCol == null || valueCol == null) return [];
  const unitCol = mapping["param_unit"];
  const scopeCols: { field: string; col: number | undefined; label: string }[] = [
    { field: "sku", col: mapping["sku"], label: "SKU" },
    { field: "supplier_code", col: mapping["supplier_code"], label: "supplier" },
    { field: "location", col: mapping["location"], label: "location" },
  ];

  const proposals: PolicyProposal[] = [];
  const seenFields = new Map<string, number>();

  for (const row of sheet.rows.slice(0, 500)) {
    const label = safeText(cell(row, paramCol));
    const rawValue = cell(row, valueCol).trim();
    if (label === "" && rawValue === "") continue;
    const target = targetFor(label);
    if (!target) continue; // unknown parameters are ignored, not guessed at

    const unitFromColumn = unitCol != null ? safeText(cell(row, unitCol)) : "";
    const scopeCol = scopeCols.find((s) => s.col != null && cell(row, s.col).trim() !== "");
    const scopeRef = scopeCol ? safeText(cell(row, scopeCol.col!)) : null;

    const parsed = parseParameterValue(
      unitFromColumn && rawValue !== "" && !/[a-z%]/i.test(rawValue) ? `${rawValue} ${unitFromColumn}` : rawValue,
      target.kind,
    );

    const ordinal = seenFields.get(target.field) ?? 0;
    seenFields.set(target.field, ordinal + 1);

    let status: PolicyProposalStatus = "ready";
    let reason = `${target.label}: "${label}" = ${rawValue}${unitFromColumn ? ` ${unitFromColumn}` : ""}.`;
    if (scopeCol) {
      status = "review";
      reason = `${target.label} is specified for ${scopeCol.label} ${scopeRef} — a specific value, not an organisation default. Review before changing anything.`;
    } else if (parsed.reviewReason) {
      status = "review";
      reason = `${target.label}: ${parsed.reviewReason}`;
    } else if (ordinal > 0) {
      status = "review";
      reason = `${target.label} appears more than once in this sheet — review which value is authoritative.`;
    }

    proposals.push({
      sheet: sheet.sheetName,
      field: target.field,
      label: target.label,
      rawValue,
      proposed: parsed.value,
      unit: parsed.unit ?? (unitFromColumn || null),
      scope: scopeCol ? "specific" : "organisation",
      scopeRef,
      status,
      reason,
    });
  }
  return proposals;
}
