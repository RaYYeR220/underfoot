import type { Address, PublicClient } from "viem";

import { ballotAbi, lensAbi, underfootAbi } from "./abi/index.js";
import type { Addresses } from "./addresses.js";
import { BASKET } from "./constants.js";

export interface FloorAsset {
  index: number;
  symbol: string;
  token: Address;
  balance: bigint;
  multiplier: bigint;
  /** Chainlink answer, 8 decimals. */
  price: bigint;
  updatedAt: number;
  stale: boolean;
  paused: boolean;
  oraclePaused: boolean;
  /** USD, 18 decimals. */
  valueUsd: bigint;
  /** Raw units of this asset behind one WIF, 18 decimals. */
  backingPerWif: bigint;
  /** WIF burned for this option in the current epoch. */
  tally: bigint;
}

export interface FloorSnapshot {
  timestamp: number;
  totalSupply: bigint;
  dead: bigint;
  circulating: bigint;
  /** USD, 18 decimals. */
  navUsd: bigint;
  /** USD behind one WIF, 18 decimals. */
  backingPerWifUsd: bigint;
  /** Spot WIF price in USD, 18 decimals (display only; 0 if unavailable). */
  wifPriceUsd: bigint;
  epoch: number;
  epochEnd: number;
  target: number;
  leader: number;
  epochBurned: bigint;
  pendingEth: bigint;
  pendingUsdg: bigint;
  assets: FloorAsset[];
}

export async function getSnapshot(client: PublicClient, a: Addresses): Promise<FloorSnapshot> {
  const s = await client.readContract({ address: a.lens, abi: lensAbi, functionName: "snapshot" });
  return {
    timestamp: Number(s.timestamp),
    totalSupply: s.totalSupply,
    dead: s.dead,
    circulating: s.circulating,
    navUsd: s.navUsd,
    backingPerWifUsd: s.backingPerWifUsd,
    wifPriceUsd: s.wifPriceUsd,
    epoch: Number(s.epoch),
    epochEnd: Number(s.epochEnd),
    target: Number(s.target),
    leader: Number(s.leader),
    epochBurned: s.epochBurned,
    pendingEth: s.pendingEth,
    pendingUsdg: s.pendingUsdg,
    assets: s.assets.map((x, i) => ({
      index: i,
      symbol: BASKET[i]?.symbol ?? x.symbol,
      token: x.token,
      balance: x.balance,
      multiplier: x.multiplier,
      price: x.price,
      updatedAt: Number(x.updatedAt),
      stale: x.stale,
      paused: x.paused,
      oraclePaused: x.oraclePaused,
      valueUsd: x.valueUsd,
      backingPerWif: x.backingPerWif,
      tally: x.tally,
    })),
  };
}

export async function quoteRedeem(client: PublicClient, a: Addresses, amount: bigint): Promise<bigint[]> {
  const out = await client.readContract({ address: a.floor, abi: underfootAbi, functionName: "quoteRedeem", args: [amount] });
  return [...out];
}

export async function getTallies(client: PublicClient, a: Addresses, epoch: number): Promise<bigint[]> {
  const out = await client.readContract({ address: a.ballot, abi: ballotAbi, functionName: "tallies", args: [BigInt(epoch)] });
  return [...out];
}

/** Floor coverage: backing per WIF as a share of the WIF price (1 = the floor is at the price). */
export function coverage(s: Pick<FloorSnapshot, "backingPerWifUsd" | "wifPriceUsd">): number {
  if (s.wifPriceUsd === 0n) return 0;
  return Number((s.backingPerWifUsd * 1_000_000_000n) / s.wifPriceUsd) / 1e9;
}
