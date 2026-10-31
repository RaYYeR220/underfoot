import "server-only";

import { BASKET, MAINNET_DEPLOY_BLOCK, ballotAbi, intakeAbi, type Addresses } from "@underfoot/sdk";
import { getAbiItem, type Log } from "viem";

import { serverClient } from "./server";
import type { IntakeEvent, IntakeWire, Skip } from "./wire";

const ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as const;
const WINDOW = 9_900_000n;
const RECENT = 24;

const EVENTS = {
  converted: getAbiItem({ abi: intakeAbi, name: "Converted" }),
  skipped: getAbiItem({ abi: intakeAbi, name: "LegSkipped" }),
  funded: getAbiItem({ abi: intakeAbi, name: "Funded" }),
};

function deployBlock(latest: bigint): bigint {
  const env = process.env.UNDERFOOT_DEPLOY_BLOCK;
  if (env) return BigInt(env);
  if (MAINNET_DEPLOY_BLOCK !== undefined) return MAINNET_DEPLOY_BLOCK;
  return latest > WINDOW ? latest - WINDOW + 1n : 0n;
}

async function scan<E extends (typeof EVENTS)[keyof typeof EVENTS]>(address: Addresses["intake"], event: E, from: bigint, to: bigint) {
  const out: Log[] = [];
  for (let s = from; s <= to; s += WINDOW) {
    const e = s + WINDOW - 1n < to ? s + WINDOW - 1n : to;
    out.push(...((await serverClient.getLogs({ address, event, fromBlock: s, toBlock: e })) as Log[]));
  }
  return out as unknown as (Log & { args: Record<string, unknown> })[];
}

async function legs(a: Addresses, target: number) {
  const read = (i: number, fromEth: boolean) =>
    serverClient
      .readContract({ address: a.intake, abi: intakeAbi, functionName: "check", args: [BigInt(i), fromEth] })
      .catch(() => 3) as Promise<Skip>;
  const [ec, et, uc, ut] = await Promise.all([read(0, true), read(target, true), read(0, false), read(target, false)]);
  return { eth: { cash: ec, target: et }, usdg: { cash: uc, target: ut } };
}

/** The intake's live limits, whether each leg could buy right now, and what it did lately. */
export async function readIntake(a: Addresses): Promise<IntakeWire> {
  const block = await serverClient.getBlock();
  const intake = { address: a.intake, abi: intakeAbi, blockNumber: block.number } as const;

  const [remaining, limit, start, pending, ethUsd, target] = await Promise.all([
    serverClient.readContract({ ...intake, functionName: "windowRemaining" }),
    serverClient.readContract({ ...intake, functionName: "MAX_USD_PER_WINDOW" }),
    serverClient.readContract({ ...intake, functionName: "windowStart" }),
    serverClient.readContract({ ...intake, functionName: "pending" }),
    // a stale ETH feed only means we can't size a buy for the user; the page still renders
    serverClient.readContract({ ...intake, functionName: "readFeed", args: [ETH_USD] }).catch(() => 0n),
    serverClient
      .readContract({ address: a.ballot, abi: ballotAbi, functionName: "currentTarget", blockNumber: block.number })
      .then(Number),
  ]);

  const from = deployBlock(block.number);
  const [converted, skipped, funded, legState] = await Promise.all([
    scan(a.intake, EVENTS.converted, from, block.number),
    scan(a.intake, EVENTS.skipped, from, block.number),
    scan(a.intake, EVENTS.funded, from, block.number),
    legs(a, target),
  ]);

  const tagged: { log: Log & { args: Record<string, unknown> }; event: IntakeEvent }[] = [
    ...converted.map((log) => ({
      log,
      event: {
        kind: "converted" as const,
        asset: Number(log.args.assetIndex),
        tokenIn: log.args.tokenIn as `0x${string}`,
        amountIn: String(log.args.amountIn),
        amountOut: String(log.args.amountOut),
        stockPrice: String(log.args.stockPrice),
      },
    })),
    ...skipped.map((log) => ({
      log,
      event: { kind: "skipped" as const, asset: Number(log.args.assetIndex), reason: Number(log.args.reason) as Skip },
    })),
    ...funded.map((log) => ({
      log,
      event: {
        kind: "funded" as const,
        from: log.args.from as `0x${string}`,
        token: log.args.token as `0x${string}`,
        amount: String(log.args.amount),
      },
    })),
  ];
  tagged.sort((x, y) =>
    x.log.blockNumber === y.log.blockNumber
      ? (y.log.logIndex ?? 0) - (x.log.logIndex ?? 0)
      : (y.log.blockNumber ?? 0n) > (x.log.blockNumber ?? 0n)
        ? 1
        : -1,
  );
  const recent = tagged.slice(0, RECENT);
  const blocks = await Promise.all(
    [...new Set(recent.map((t) => t.log.blockNumber!))].map((n) => serverClient.getBlock({ blockNumber: n })),
  );
  const ts = new Map(blocks.map((b) => [b.number, Number(b.timestamp)]));

  return {
    block: block.number.toString(),
    timestamp: Number(block.timestamp),
    windowRemaining: remaining.toString(),
    windowLimit: limit.toString(),
    windowStart: Number(start),
    ethUsd: ethUsd.toString(),
    pendingEth: pending[0].toString(),
    pendingUsdg: pending[1].toString(),
    target: target < BASKET.length ? target : 1,
    legs: legState,
    events: recent.map(({ log, event }) => ({
      ...event,
      tx: log.transactionHash!,
      block: log.blockNumber!.toString(),
      logIndex: log.logIndex ?? 0,
      timestamp: ts.get(log.blockNumber!) ?? 0,
    })),
  };
}
