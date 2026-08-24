/**
 * Landed cost — one service, one chain, no hidden arithmetic.
 *
 *   supplier price → FX → freight → duty → clearance → other → landed cost
 *   landed cost → selling price → gross profit → margin
 *
 * Every step keeps its own contribution so the UI can show the build-up and
 * the operator can see exactly which number moved. Nothing is invented: when
 * no supplier price and no components exist the recorded `unit_cost` is used
 * as the fallback and the result says so, so every existing reader of
 * `unit_cost` keeps working unchanged.
 *
 * Pure functions only — no Supabase, no React.
 */
import type { CostBasis, CostComponentKind } from "@/lib/domain/supply-chain";

export interface LandedCostComponentInput {
  kind: CostComponentKind;
  label?: string | null;
  amount: number;
  basis: CostBasis;
}

export interface LandedCostInput {
  /** Units the cost is spread across. Per-shipment costs need this. */
  quantity: number;
  /** Supplier price per unit, in the supplier's currency. */
  supplierPrice?: number | null;
  /** Multiplier from the supplier currency into the reporting currency. */
  fxRate?: number | null;
  components?: LandedCostComponentInput[];
  /** Recorded product cost, used when no supplier price exists. */
  fallbackUnitCost?: number | null;
  /** Selling price per unit, when one is recorded. Never invented. */
  sellingPrice?: number | null;
}

export interface LandedCostStep {
  key: CostComponentKind | "goods" | "fx";
  label: string;
  /** Contribution of this step to the landed unit cost. */
  perUnit: number;
  /** Landed unit cost after this step. */
  runningTotal: number;
}

export interface LandedCostResult {
  quantity: number;
  /** Goods value per unit in the reporting currency (supplier price × FX). */
  goodsPerUnit: number;
  fxPerUnit: number;
  freightPerUnit: number;
  dutyPerUnit: number;
  clearancePerUnit: number;
  otherPerUnit: number;
  /** Everything that is not the goods value itself. */
  overheadPerUnit: number;
  landedUnitCost: number;
  landedTotal: number;
  sellingPrice: number | null;
  grossProfitPerUnit: number | null;
  grossProfitTotal: number | null;
  /** Gross profit ÷ selling price, as a fraction. Null without a price. */
  marginPct: number | null;
  steps: LandedCostStep[];
  /** True when the goods value came from `products.unit_cost`, not a supplier price. */
  usedFallbackCost: boolean;
  /** True when at least one cost component was applied. */
  hasComponents: boolean;
}

const KIND_LABEL: Record<CostComponentKind, string> = {
  freight: "Freight",
  duty: "Duty",
  clearance: "Clearance",
  other: "Other",
  fx: "FX",
};

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

/** Turns one component into a per-unit number against a goods value. */
export function componentPerUnit(
  component: LandedCostComponentInput,
  opts: { quantity: number; goodsPerUnit: number },
): number {
  const amount = finite(Number(component.amount));
  if (component.basis === "per_unit") return amount;
  if (component.basis === "percent_of_value") return (opts.goodsPerUnit * amount) / 100;
  // per_shipment: spread across the units it covers. With no quantity there is
  // nothing to spread it over, so it contributes nothing rather than infinity.
  return opts.quantity > 0 ? amount / opts.quantity : 0;
}

export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const quantity = Math.max(0, finite(Number(input.quantity)));
  const components = input.components ?? [];
  const hasSupplierPrice = input.supplierPrice != null && Number.isFinite(input.supplierPrice);
  const basePrice = hasSupplierPrice
    ? finite(Number(input.supplierPrice))
    : finite(Number(input.fallbackUnitCost ?? 0));
  const fxRate = input.fxRate != null && Number(input.fxRate) > 0 ? Number(input.fxRate) : 1;

  const goodsPerUnit = basePrice * fxRate;
  const fxAdjustment = goodsPerUnit - basePrice;

  const bucket: Record<CostComponentKind, number> = {
    freight: 0,
    duty: 0,
    clearance: 0,
    other: 0,
    fx: 0,
  };
  for (const c of components) {
    bucket[c.kind] += componentPerUnit(c, { quantity, goodsPerUnit });
  }

  const steps: LandedCostStep[] = [];
  let running = basePrice;
  steps.push({
    key: "goods",
    label: hasSupplierPrice ? "Supplier price" : "Recorded unit cost",
    perUnit: basePrice,
    runningTotal: running,
  });
  if (fxAdjustment !== 0 || fxRate !== 1) {
    running += fxAdjustment;
    steps.push({
      key: "fx",
      label: `FX × ${fxRate}`,
      perUnit: fxAdjustment,
      runningTotal: running,
    });
  }
  const order: CostComponentKind[] = ["freight", "duty", "clearance", "other", "fx"];
  for (const kind of order) {
    const perUnit = bucket[kind];
    if (perUnit === 0) continue;
    running += perUnit;
    steps.push({ key: kind, label: KIND_LABEL[kind], perUnit, runningTotal: running });
  }

  const landedUnitCost = running;
  const sellingPrice =
    input.sellingPrice != null && Number.isFinite(input.sellingPrice)
      ? Number(input.sellingPrice)
      : null;
  const grossProfitPerUnit = sellingPrice == null ? null : sellingPrice - landedUnitCost;

  return {
    quantity,
    goodsPerUnit,
    fxPerUnit: fxAdjustment + bucket.fx,
    freightPerUnit: bucket.freight,
    dutyPerUnit: bucket.duty,
    clearancePerUnit: bucket.clearance,
    otherPerUnit: bucket.other,
    overheadPerUnit: landedUnitCost - basePrice,
    landedUnitCost,
    landedTotal: landedUnitCost * quantity,
    sellingPrice,
    grossProfitPerUnit,
    grossProfitTotal: grossProfitPerUnit == null ? null : grossProfitPerUnit * quantity,
    marginPct:
      grossProfitPerUnit == null || sellingPrice == null || sellingPrice === 0
        ? null
        : grossProfitPerUnit / sellingPrice,
    steps,
    usedFallbackCost: !hasSupplierPrice,
    hasComponents: components.length > 0,
  };
}

/**
 * Selects the cost components that apply to one buying decision. Shipment
 * components are the most specific, then product, then supplier defaults;
 * a component with no scope is a workspace-wide default.
 */
export function selectComponents<
  T extends { productId: string | null; supplierId: string | null; shipmentId: string | null },
>(all: T[], scope: { productId?: string | null; supplierId?: string | null; shipmentId?: string | null }): T[] {
  return all.filter((c) => {
    if (c.shipmentId) return scope.shipmentId != null && c.shipmentId === scope.shipmentId;
    if (c.productId) return scope.productId != null && c.productId === scope.productId;
    if (c.supplierId) return scope.supplierId != null && c.supplierId === scope.supplierId;
    return true;
  });
}
