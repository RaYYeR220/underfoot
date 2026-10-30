import "server-only";

import { BASKET, WIF, intakeAbi, type Addresses } from "@underfoot/sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { CHAIN, PUBLIC_RPC } from "./config";
import { serverClient } from "./server";

const ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as const;
const FEED_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint80" },
      { type: "int256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint80" },
    ],
  },
] as const;

/** Stay under the contract's $500 per-call cap, with room for the price to move. */
const CHUNK_USD = 450;
/** Don't spend gas converting dust. */
const MIN_USD = 2;

export interface KeeperAction {
  action: "sweep" | "convert-eth" | "convert-usdg";
  status: "sent" | "refused" | "skipped";
  detail: string;
  tx?: Hex;
}

function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? revert.shortMessage;
    return e.shortMessage;
  }
  return String(e);
}

/**
 * One keeper pass: settle anything sent straight to the intake, then buy Stock Tokens with
 * whatever ETH and USDG are waiting. Every buy is simulated first; a refusal (markets closed,
 * a paused token, a price outside the band) is reported and nothing is sent.
 */
export async function runKeeper(a: Addresses): Promise<KeeperAction[]> {
  const pk = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("keeper is not configured");
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(process.env.RPC_URL || PUBLIC_RPC) });
  const out: KeeperAction[] = [];

  const send = async (action: KeeperAction["action"], functionName: "sweep" | "convert", args?: readonly [boolean, bigint]) => {
    try {
      const { request } = await serverClient.simulateContract({
        account,
        address: a.intake,
        abi: intakeAbi,
        functionName,
        ...(args ? { args } : {}),
      } as Parameters<typeof serverClient.simulateContract>[0]);
      const tx = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
      await serverClient.waitForTransactionReceipt({ hash: tx });
      out.push({ action, status: "sent", detail: args ? `amountIn ${args[1]}` : "settled", tx });
    } catch (e) {
      out.push({ action, status: "refused", detail: reason(e) });
    }
  };

  // 1. settle direct transfers
  const balances = await Promise.all(
    [WIF, ...BASKET.map((b) => b.token)].map((t) =>
      serverClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [a.intake] }),
    ),
  );
  if (balances.some((b) => b > 0n)) await send("sweep", "sweep");
  else out.push({ action: "sweep", status: "skipped", detail: "nothing to settle" });

  // 2. convert what's waiting
  const [[eth, usdg], round] = await Promise.all([
    serverClient.readContract({ address: a.intake, abi: intakeAbi, functionName: "pending" }),
    serverClient.readContract({ address: ETH_USD, abi: FEED_ABI, functionName: "latestRoundData" }),
  ]);
  const ethUsd = Number(round[1]) / 1e8;

  const ethValue = (Number(eth) / 1e18) * ethUsd;
  if (ethValue >= MIN_USD) {
    const cap = BigInt(Math.floor((CHUNK_USD / ethUsd) * 1e18));
    await send("convert-eth", "convert", [true, eth < cap ? eth : cap]);
  } else {
    out.push({ action: "convert-eth", status: "skipped", detail: `$${ethValue.toFixed(2)} waiting` });
  }

  const usdgValue = Number(usdg) / 1e6;
  if (usdgValue >= MIN_USD) {
    const cap = BigInt(CHUNK_USD * 1e6);
    await send("convert-usdg", "convert", [false, usdg < cap ? usdg : cap]);
  } else {
    out.push({ action: "convert-usdg", status: "skipped", detail: `$${usdgValue.toFixed(2)} waiting` });
  }
  return out;
}
