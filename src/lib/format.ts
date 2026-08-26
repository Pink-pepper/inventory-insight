import {
  BASE_CURRENCY,
  formatCurrency,
  resolveDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/domain/currency";

/**
 * The single formatting layer.
 *
 * Every screen formats money through `money`/`compactMoney`. The workspace's
 * chosen display currency and manual rate are applied here and nowhere else,
 * so a stored amount is never rewritten — only presented differently.
 */
let display: DisplayCurrency = { code: BASE_CURRENCY, rate: 1, converted: false };

export function setDisplayCurrency(
  code: string | null | undefined,
  rates: Record<string, number> | null | undefined,
) {
  display = resolveDisplayCurrency(code, rates);
}

export function currentDisplayCurrency(): DisplayCurrency {
  return display;
}

export const money = (n: number, dp = 0) => formatCurrency(n, display, { dp });

export const compactMoney = (n: number) => formatCurrency(n, display, { compact: true });

export const num = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });

export const cover = (days: number) => (days >= 9999 ? "∞" : `${Math.round(days)} d`);
