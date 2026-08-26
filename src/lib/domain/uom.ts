/**
 * Quantity model.
 *
 * A stock or demand line is counted in *packages* (sellable units). The
 * physical quantity is packages × pack size, expressed in the product's own
 * pack unit of measure. Ionic converts between mass units and between volume
 * units, but never between mass and volume: 1 L is not 1 kg, and inventing a
 * density would silently corrupt a plan.
 */

export const MASS_UNITS = ["g", "kg", "MT"] as const;
export const VOLUME_UNITS = ["ml", "L"] as const;

export type QuantityUnit = (typeof MASS_UNITS)[number] | (typeof VOLUME_UNITS)[number];

export const DISPLAY_UNITS: QuantityUnit[] = ["g", "kg", "MT", "ml", "L"];

/** Everything is normalised to the base of its own family: grams / millilitres. */
const TO_BASE: Record<string, { family: "mass" | "volume"; factor: number }> = {
  g: { family: "mass", factor: 1 },
  kg: { family: "mass", factor: 1_000 },
  mt: { family: "mass", factor: 1_000_000 },
  t: { family: "mass", factor: 1_000_000 },
  ml: { family: "volume", factor: 1 },
  l: { family: "volume", factor: 1_000 },
};

export function unitFamily(unit: string | null | undefined): "mass" | "volume" | null {
  if (!unit) return null;
  return TO_BASE[unit.trim().toLowerCase()]?.family ?? null;
}

/**
 * Converts a physical quantity between units. Returns null when no valid
 * conversion exists (unknown unit, or crossing mass/volume).
 */
export function convertQuantity(
  value: number,
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) return null;
  const a = TO_BASE[from.trim().toLowerCase()];
  const b = TO_BASE[to.trim().toLowerCase()];
  if (!a || !b || a.family !== b.family) return null;
  return (value * a.factor) / b.factor;
}

/** Total physical quantity for a package count. Null when pack size is unknown. */
export function physicalQuantity(
  packages: number,
  packSize: number | null | undefined,
): number | null {
  if (packSize == null || !Number.isFinite(packSize) || packSize <= 0) return null;
  return packages * packSize;
}

/**
 * Physical quantity expressed in the requested display unit, or null when the
 * product's pack unit cannot legitimately be converted to it.
 */
export function displayQuantity(
  packages: number,
  packSize: number | null | undefined,
  packUom: string | null | undefined,
  displayUnit: string | null | undefined,
): { value: number; unit: string } | null {
  const physical = physicalQuantity(packages, packSize);
  if (physical == null || !packUom) return null;
  if (!displayUnit || displayUnit === packUom) return { value: physical, unit: packUom };
  const converted = convertQuantity(physical, packUom, displayUnit);
  if (converted == null) return { value: physical, unit: packUom };
  return { value: converted, unit: displayUnit };
}

export function formatQuantity(value: number, unit: string): string {
  const dp = value >= 100 ? 0 : value >= 1 ? 2 : 3;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: dp })} ${unit}`;
}
