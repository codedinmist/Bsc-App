import { formatUnits, parseUnits } from "viem";

/** Indian digit grouping: 12,34,567.50 */
export function groupIndian(intPart: string): string {
  const neg = intPart.startsWith("-");
  const s = neg ? intPart.slice(1) : intPart;
  if (s.length <= 3) return (neg ? "-" : "") + s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg ? "-" : "") + rest + "," + last3;
}

/** Format an 18-decimal amount. Shows up to `dp` decimals, trims trailing zeros. */
export function formatAmount(wei: bigint, dp = 2): string {
  const [i, f = ""] = formatUnits(wei, 18).split(".");
  const frac = f.slice(0, dp).replace(/0+$/, "");
  return groupIndian(i) + (frac ? "." + frac : "");
}

/** Parse user input like "1,000.5". Returns null if invalid or has more than 18 decimals. */
export function parseAmount(input: string): bigint | null {
  const t = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  try { return parseUnits(t, 18); } catch { return null; }
}

export const E = (n: number | string) => parseUnits(String(n), 18);
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function formatDate(sec: number | bigint): string {
  return new Date(Number(sec) * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function countdown(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
