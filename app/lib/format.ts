/** Display formatting shared by the positions and markets surfaces. */

export function money(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: value >= 1000 ? 0 : digits }).format(value);
}

export function compactMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function ethValue(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = value >= 100 ? 2 : value >= 1 ? 3 : value >= 0.01 ? 4 : 6;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value)} ETH`;
}

/** Prices span from $0.000000012 memes to $60,000,000 ratios. Keep four significant figures below 1. */
export function formatPrice(value: number | null | undefined, unit: "usd" | "eth"): string {
  if (value === null) return "∞";
  if (value === undefined || !Number.isFinite(value)) return "—";
  const prefix = unit === "usd" ? "$" : "";
  const suffix = unit === "eth" ? " ETH" : "";
  if (value === 0) return `${prefix}0${suffix}`;
  let body: string;
  if (value >= 1_000_000) body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  else if (value >= 1000) body = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  else if (value >= 1) body = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
  else body = trimZeros(value.toFixed(Math.min(18, Math.max(4, 3 - Math.floor(Math.log10(value))))));
  return `${prefix}${body}${suffix}`;
}

export function formatPercent(value?: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(value >= 100 ? 0 : digits)}%`;
}

/** Server rows already carry locale-formatted token amounts; shorten long meme balances for cards. */
export function compactTokenAmount(formatted: string): string {
  const numeric = Number(formatted.replaceAll(",", ""));
  if (!Number.isFinite(numeric)) return formatted;
  if (numeric >= 10_000) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(numeric);
  if (numeric >= 100) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(numeric);
  if (numeric >= 1) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(numeric);
  if (numeric === 0) return "0";
  return trimZeros(numeric.toFixed(Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(numeric))))));
}

export function compactRaw(rawUnits: string, decimals: number): string {
  const value = Number(rawUnits) / 10 ** decimals;
  if (!Number.isFinite(value)) return "0";
  return compactTokenAmount(String(value));
}

export function short(value: string): string {
  return value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

export function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
