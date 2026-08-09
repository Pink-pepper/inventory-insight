export const money = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dp });

export const compactMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });

export const num = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: dp });

export const cover = (days: number) => (days >= 9999 ? "∞" : `${Math.round(days)} d`);