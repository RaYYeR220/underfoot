import { formatUnits, parseUnits } from "viem";

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Fixed-point bigint to a grouped decimal string, rounded half-up to `frac` places. No floats. */
export function decimal(value: bigint, decimals: number, frac: number): string {
  const neg = value < 0n;
  let v = neg ? -value : value;
  if (frac < decimals) {
    const step = 10n ** BigInt(decimals - frac);
    v = ((v + step / 2n) / step) * step;
  }
  const [int, fr = ""] = formatUnits(v, decimals).split(".");
  const f = fr.slice(0, frac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${group(int!)}${f ? `.${f}` : ""}`;
}

/** Keep `sig` significant digits, for values like backing per WIF that sit around 1e-7. */
export function significant(value: bigint, decimals: number, sig: number): string {
  if (value === 0n) return "0";
  const digits = value.toString().length;
  const frac = Math.max(0, Math.min(decimals, decimals - digits + sig));
  return decimal(value, decimals, frac);
}

/** Dollars keep their cents: 157.5 reads as $157.50. */
function cents(s: string, frac: number): string {
  if (frac === 0) return `$${s}`;
  const [int, f = ""] = s.split(".");
  return `$${int}.${f.padEnd(frac, "0")}`;
}

/** USD with 18 decimals. */
export function usd(value: bigint, frac = 2): string {
  if (value > 0n && value < 10n ** 16n) return `$${significant(value, 18, 3)}`;
  return cents(decimal(value, 18, frac), frac);
}

export function usdPrecise(value: bigint, sig = 6): string {
  return `$${significant(value, 18, sig)}`;
}

/** USD with 8 decimals (Chainlink answers, intake limits). */
export function usd8(value: bigint, frac = 2): string {
  return cents(decimal(value, 8, frac), frac);
}

/** An 18-decimal token amount, with fewer places as it grows. */
export function amount(value: bigint, decimals = 18): string {
  const whole = value / 10n ** BigInt(decimals);
  if (whole >= 100_000n) return decimal(value, decimals, 0);
  if (whole >= 100n) return decimal(value, decimals, 2);
  if (value === 0n) return "0";
  return significant(value, decimals, 5);
}

const COMPACT: [bigint, string][] = [
  [1_000_000_000n, "B"],
  [1_000_000n, "M"],
  [1_000n, "K"],
];

/** Compact form for very large WIF figures in tight spots, e.g. 998.4M. */
export function compact(value: bigint, decimals = 18): string {
  const whole = value / 10n ** BigInt(decimals);
  for (const [n, s] of COMPACT) if (whole >= n) return `${decimal(value / n, decimals, 1)}${s}`;
  return amount(value, decimals);
}

/** `part` as a percent of `whole`. */
export function percent(part: bigint, whole: bigint, frac = 1): string {
  if (whole === 0n) return "0%";
  return `${decimal((part * 10n ** 20n) / whole, 18, frac)}%`;
}

/** "3h 12m", "2d 4h", "45s" */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const shortHex = (h: string, head = 6, tail = 4) => `${h.slice(0, head)}…${h.slice(-tail)}`;

/** A user-typed amount to base units; null while the input isn't a valid positive number. */
export function parseAmount(input: string, decimals = 18): bigint | null {
  const t = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  try {
    const v = parseUnits(t, decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}
