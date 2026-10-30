import "server-only";

/**
 * Fixed-window counters held in the function instance's memory. They reset on a cold start, so
 * they are a speed bump, not a guarantee; the hard limits live on-chain (what can be sponsored,
 * the per-operation cost cap, and a deposit that only ever pays for floor actions).
 */
const buckets = new Map<string, { start: number; count: number }>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 50_000) buckets.clear();
    return true;
  }
  if (b.count >= limit) return false;
  b.count += 1;
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
