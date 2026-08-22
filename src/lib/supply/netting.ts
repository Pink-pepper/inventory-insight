/**
 * Net requirement netting.
 *
 * The quantity question is deliberately the same one the recommendation
 * engine answers: how far the lowest projected position falls short of the
 * target stock the engine already computed. Supply Planning adds the two
 * things recommendations never had — when the need occurs, and therefore
 * when an order must be placed given the lead time.
 */
import { applyMoq } from "@/lib/engine/inventory-engine";

export interface NetRequirementResult {
  /** Units needed to bring the lowest projected position back to target stock. */
  netRequirement: number;
  /** Net requirement after the minimum order quantity and order multiple. */
  suggestedQty: number;
  /** True when the order constraints raised the quantity above the net need. */
  moqApplied: boolean;
  /** Period the unmet need first occurs (reorder-point crossing). */
  requiredByPeriod: string | null;
  /** requiredByPeriod minus the lead time; null when either side is unknown. */
  orderByDate: string | null;
}

export function computeNetRequirement(input: {
  targetStock: number;
  lowPoint: number;
  triggerPeriod: string | null;
  leadTimeDays: number | null;
  minOrderQty: number;
  orderMultiple: number;
}): NetRequirementResult {
  const netRequirement = Math.max(0, Math.ceil(input.targetStock - input.lowPoint));
  if (netRequirement <= 0) {
    return {
      netRequirement: 0,
      suggestedQty: 0,
      moqApplied: false,
      requiredByPeriod: null,
      orderByDate: null,
    };
  }
  const suggestedQty = applyMoq(netRequirement, input.minOrderQty, input.orderMultiple);
  const orderByDate =
    input.triggerPeriod != null && input.leadTimeDays != null
      ? new Date(
          new Date(`${input.triggerPeriod}T00:00:00Z`).getTime() - input.leadTimeDays * 86_400_000,
        )
          .toISOString()
          .slice(0, 10)
      : null;
  return {
    netRequirement,
    suggestedQty,
    moqApplied: suggestedQty > netRequirement,
    requiredByPeriod: input.triggerPeriod,
    orderByDate,
  };
}
