/**
 * Display currency.
 *
 * Ionic never rewrites a stored amount. Every monetary value in the canonical
 * model stays in the currency it arrived in (USD for the demo dataset and for
 * derived economics). A workspace can choose a *display* currency plus a
 * manual rate, and the presentation layer converts on the way to the screen.
 * Switching back to the base currency shows the original figure exactly.
 */

/** The currency every stored amount is denominated in today. */
export const BASE_CURRENCY = "USD";

export const CURRENCY_OPTIONS = [
  "USD",
  "NGN",
  "EUR",
  "GBP",
  "AED",
  "ZAR",
  "GHS",
  "KES",
  "INR",
  "CNY",
] as const;

export type CurrencyCode = (typeof CURRENCY_OPTIONS)[number] | (string & {});

/** Manual rates: units of the target currency per 1 unit of the base currency. */
export type FxRates = Record<string, number>;

export interface DisplayCurrency {
  /** Currency the user sees. */
  code: string;
  /** Multiplier applied to base-currency amounts. 1 when no conversion. */
  rate: number;
  /** True when values on screen are converted rather than as-stored. */
  converted: boolean;
}

export function resolveDisplayCurrency(
  code: string | null | undefined,
  rates: FxRates | null | undefined,
): DisplayCurrency {
  const target = (code || BASE_CURRENCY).toUpperCase();
  if (target === BASE_CURRENCY) return { code: BASE_CURRENCY, rate: 1, converted: false };
  const rate = Number(rates?.[target]);
  if (!Number.isFinite(rate) || rate <= 0) {
    // No usable rate: never invent one, fall back to the stored currency.
    return { code: BASE_CURRENCY, rate: 1, converted: false };
  }
  return { code: target, rate, converted: true };
}

/** Formats a base-currency amount in the workspace's display currency. */
export function formatCurrency(
  amount: number,
  display: DisplayCurrency,
  opts: { compact?: boolean; dp?: number } = {},
): string {
  const value = amount * display.rate;
  try {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: display.code,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : (opts.dp ?? 0),
    });
  } catch {
    return `${display.code} ${value.toLocaleString("en-US", { maximumFractionDigits: opts.dp ?? 0 })}`;
  }
}

/** Renders an amount in the currency it was recorded in, unconverted. */
export function formatSourceAmount(amount: number, currency: string | null): string {
  const code = (currency || BASE_CURRENCY).toUpperCase();
  try {
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${code} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}
