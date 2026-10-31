import type { FloorAsset, FloorSnapshot } from "@underfoot/sdk";
import type { Address, Hex } from "viem";

/** What crosses the network: every bigint becomes a decimal string. */
export type Wire<T> = T extends bigint
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export function toWire<T>(value: T): Wire<T> {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

const ASSET_BIGINTS = ["balance", "multiplier", "price", "valueUsd", "backingPerWif", "tally"] as const;
const SNAPSHOT_BIGINTS = [
  "totalSupply",
  "dead",
  "circulating",
  "navUsd",
  "backingPerWifUsd",
  "wifPriceUsd",
  "epochBurned",
  "pendingEth",
  "pendingUsdg",
] as const;

export function fromWireSnapshot(w: Wire<FloorSnapshot>): FloorSnapshot {
  const s = { ...w } as unknown as FloorSnapshot;
  for (const k of SNAPSHOT_BIGINTS) (s as unknown as Record<string, bigint>)[k] = BigInt(w[k]);
  s.assets = w.assets.map((a) => {
    const out = { ...a } as unknown as FloorAsset;
    for (const k of ASSET_BIGINTS) (out as unknown as Record<string, bigint>)[k] = BigInt(a[k]);
    return out;
  });
  return s;
}

export type BurnSource = "vote" | "redeem" | "intake" | "pool" | "v4-hooks" | "contracts" | "holders";

/** GET /api/ledger */
export interface LedgerWire {
  toBlock: string;
  totalBurned: string;
  count: number;
  bySource: Record<BurnSource, { count: number; amount: string }>;
  recent: { tx: Hex; block: string; logIndex: number; amount: string; source: BurnSource; actor: Address; timestamp: number }[];
  labels: Record<BurnSource, string>;
}

/** Why the intake would skip a leg; mirrors `Intake.Skip`. */
export enum Skip {
  None,
  Paused,
  OraclePaused,
  FeedUnusable,
  PoolOffPrice,
}

export type IntakeEvent =
  | { kind: "converted"; asset: number; tokenIn: Address; amountIn: string; amountOut: string; stockPrice: string }
  | { kind: "skipped"; asset: number; reason: Skip }
  | { kind: "funded"; from: Address; token: Address; amount: string };

/** GET /api/intake */
export interface IntakeWire {
  block: string;
  timestamp: number;
  /** USD with 8 decimals. */
  windowRemaining: string;
  windowLimit: string;
  windowStart: number;
  /** Chainlink ETH/USD, 8 decimals; "0" when the feed can't be read. */
  ethUsd: string;
  pendingEth: string;
  pendingUsdg: string;
  target: number;
  /** Whether each leg could trade right now, per input. */
  legs: { eth: { cash: Skip; target: Skip }; usdg: { cash: Skip; target: Skip } };
  events: (IntakeEvent & { tx: Hex; block: string; logIndex: number; timestamp: number })[];
}
