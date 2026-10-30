import "server-only";

import { ballotAbi, hookAbi, intakeAbi, underfootAbi, DEAD, WIF, type Addresses } from "@underfoot/sdk";
import { getAbiItem, parseAbiItem, type Address, type Hex, type Log } from "viem";

import { WIF_GENESIS_BLOCK } from "./config";
import { serverClient } from "./server";

const POOL_MANAGER: Address = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ZERO: Address = "0x0000000000000000000000000000000000000000";
/** The public RPC allows 10M blocks per single-topic query. */
const WINDOW = 9_900_000n;

export type BurnSource = "vote" | "redeem" | "intake" | "pool" | "v4-hooks" | "contracts" | "holders";

export const SOURCE_LABEL: Record<BurnSource, string> = {
  vote: "Underfoot votes",
  redeem: "Underfoot redemptions",
  intake: "Sent to the Underfoot intake",
  pool: "WIF/SPY pool fees",
  "v4-hooks": "Other Uniswap v4 hooks (buybacks, games)",
  contracts: "Other contracts",
  holders: "Holders burning directly",
};

export interface Burn {
  tx: Hex;
  block: string;
  logIndex: number;
  amount: string;
  source: BurnSource;
  actor: Address;
}

export interface Ledger {
  toBlock: string;
  totalBurned: string;
  count: number;
  bySource: Record<BurnSource, { count: number; amount: string }>;
  recent: (Burn & { timestamp: number })[];
}

async function logsInWindows<T>(fetchWindow: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint) {
  const out: T[] = [];
  for (let s = from; s <= to; s += WINDOW) {
    const e = s + WINDOW - 1n < to ? s + WINDOW - 1n : to;
    out.push(...(await fetchWindow(s, e)));
  }
  return out;
}

async function ourBurnTxs(a: Addresses, toBlock: bigint): Promise<Map<Hex, BurnSource>> {
  const fromBlock = BigInt(process.env.UNDERFOOT_DEPLOY_BLOCK ?? WIF_GENESIS_BLOCK.toString());
  const sources = new Map<Hex, BurnSource>();
  const [votes, redeems, intake, pool] = await Promise.all([
    logsInWindows((f, t) => serverClient.getLogs({ address: a.ballot, event: getAbiItem({ abi: ballotAbi, name: "Voted" }), fromBlock: f, toBlock: t }), fromBlock, toBlock),
    logsInWindows((f, t) => serverClient.getLogs({ address: a.floor, event: getAbiItem({ abi: underfootAbi, name: "Redeemed" }), fromBlock: f, toBlock: t }), fromBlock, toBlock),
    logsInWindows((f, t) => serverClient.getLogs({ address: a.intake, event: getAbiItem({ abi: intakeAbi, name: "Burned" }), fromBlock: f, toBlock: t }), fromBlock, toBlock),
    logsInWindows((f, t) => serverClient.getLogs({ address: a.hook, event: getAbiItem({ abi: hookAbi, name: "FloorFee" }), fromBlock: f, toBlock: t }), fromBlock, toBlock),
  ]);
  const mark = (logs: Log[], s: BurnSource) => logs.forEach((l) => l.transactionHash && sources.set(l.transactionHash, s));
  mark(pool, "pool");
  mark(intake, "intake");
  mark(redeems, "redeem");
  mark(votes, "vote");
  return sources;
}

const codeCache = new Map<Address, boolean>();
async function isContract(a: Address): Promise<boolean> {
  const hit = codeCache.get(a);
  if (hit !== undefined) return hit;
  const code = await serverClient.getCode({ address: a });
  // an EIP-7702 delegated EOA carries a 23-byte designator; that's still a person
  const contract = !!code && code !== "0x" && !code.startsWith("0xef0100");
  codeCache.set(a, contract);
  return contract;
}

/** Every $WIF burned on Robinhood Chain since it was minted, attributed to where it came from. */
export async function buildLedger(a: Addresses | undefined): Promise<Ledger> {
  const toBlock = await serverClient.getBlockNumber();
  const [zero, dead] = await Promise.all(
    [ZERO, DEAD].map((to) =>
      logsInWindows(
        (f, t) => serverClient.getLogs({ address: WIF, event: TRANSFER, args: { to }, fromBlock: f, toBlock: t }),
        WIF_GENESIS_BLOCK,
        toBlock,
      ),
    ),
  );
  const ours = a ? await ourBurnTxs(a, toBlock) : new Map<Hex, BurnSource>();

  const burns: Burn[] = [];
  for (const l of [...zero!, ...dead!]) {
    // the mint is a transfer from zero, never to it; skip zero-value noise
    if (!l.args.from || !l.args.value || l.args.value === 0n) continue;
    const actor = l.args.from;
    let source = ours.get(l.transactionHash);
    if (!source) {
      if (actor.toLowerCase() === POOL_MANAGER.toLowerCase()) source = "v4-hooks";
      else source = (await isContract(actor)) ? "contracts" : "holders";
    }
    burns.push({
      tx: l.transactionHash,
      block: l.blockNumber.toString(),
      logIndex: l.logIndex,
      amount: l.args.value.toString(),
      source,
      actor,
    });
  }
  burns.sort((x, y) => (BigInt(y.block) === BigInt(x.block) ? y.logIndex - x.logIndex : BigInt(y.block) > BigInt(x.block) ? 1 : -1));

  const bySource = Object.fromEntries(
    (Object.keys(SOURCE_LABEL) as BurnSource[]).map((s) => [s, { count: 0, amount: "0" }]),
  ) as Ledger["bySource"];
  let total = 0n;
  for (const b of burns) {
    const s = bySource[b.source];
    s.count += 1;
    s.amount = (BigInt(s.amount) + BigInt(b.amount)).toString();
    total += BigInt(b.amount);
  }

  const recentBurns = burns.slice(0, 40);
  const blocks = await Promise.all(
    [...new Set(recentBurns.map((b) => b.block))].map((n) => serverClient.getBlock({ blockNumber: BigInt(n) })),
  );
  const ts = new Map(blocks.map((b) => [b.number.toString(), Number(b.timestamp)]));

  return {
    toBlock: toBlock.toString(),
    totalBurned: total.toString(),
    count: burns.length,
    bySource,
    recent: recentBurns.map((b) => ({ ...b, timestamp: ts.get(b.block) ?? 0 })),
  };
}
