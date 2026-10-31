"use client";

import { getSnapshot, type Call } from "@underfoot/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { decodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { useConfig, useConnection, type Config } from "wagmi";
import {
  getCapabilities,
  getConnection,
  getPublicClient,
  readContract,
  sendCalls,
  sendTransaction,
  switchChain,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from "wagmi/actions";

import { snapshotKey } from "@/components/live-data";
import { ADDRESSES, CHAIN } from "@/lib/config";
import { explain } from "@/lib/explain";
import { toWire } from "@/lib/wire";

import { useEmailSession } from "./email-session";

export type Progress =
  | { phase: "idle" }
  | { phase: "wallet"; step: number; of: number }
  | { phase: "mining"; hash?: Hex }
  | { phase: "done"; hash: Hex; sponsored: boolean }
  | { phase: "error"; message: string };

export interface Actor {
  kind: "wallet" | "email";
  address: Address;
}

/** Who acts: a connected browser wallet first, else the email account. */
export function useActor(): Actor | null {
  const { address, status } = useConnection();
  const email = useEmailSession();
  if (status === "connected" && address) return { kind: "wallet", address };
  if (email?.wallet) return { kind: "email", address: email.wallet.address };
  return null;
}

/** One confirmation fewer when an earlier approval still covers the amount. */
async function withoutCoveredApprovals(config: Config, owner: Address, calls: Call[]): Promise<Call[]> {
  const out: Call[] = [];
  for (const c of calls) {
    try {
      const d = decodeFunctionData({ abi: erc20Abi, data: c.data });
      if (d.functionName === "approve") {
        const [spender, amount] = d.args;
        const allowance = await readContract(config, {
          address: c.to,
          abi: erc20Abi,
          functionName: "allowance",
          args: [owner, spender],
          chainId: CHAIN.id,
        });
        if (allowance >= amount) continue;
      }
    } catch {
      // not an ERC-20 approval, or the read failed: send the call as it is
    }
    out.push(c);
  }
  return out;
}

export function useWrongChain() {
  const { status, chainId } = useConnection();
  return status === "connected" && chainId !== CHAIN.id;
}

/**
 * Sends floor calls from whoever is acting.
 * - email account + sponsorable: one gasless user operation through our paymaster;
 * - a wallet that can batch atomically (EIP-5792): one confirmation;
 * - otherwise one transaction at a time, skipping an approval that's already in place.
 */
export function useSend() {
  const config = useConfig();
  const qc = useQueryClient();
  const actor = useActor();
  const email = useEmailSession();
  const [progress, setProgress] = useState<Progress>({ phase: "idle" });

  const refresh = useCallback(async () => {
    try {
      if (ADDRESSES) {
        const s = await getSnapshot(getPublicClient(config, { chainId: CHAIN.id }) as never, ADDRESSES);
        qc.setQueryData(snapshotKey, toWire(s));
      }
    } catch {}
    await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== snapshotKey[0] });
  }, [config, qc]);

  const withWallet = useCallback(
    async (account: Address, calls: Call[]): Promise<Hex> => {
      if (getConnection(config).chainId !== CHAIN.id) await switchChain(config, { chainId: CHAIN.id });

      let atomic = false;
      try {
        const caps = await getCapabilities(config, { account, chainId: CHAIN.id });
        atomic = caps.atomic?.status === "supported" || caps.atomic?.status === "ready";
      } catch {}

      if (atomic && calls.length > 1) {
        setProgress({ phase: "wallet", step: 1, of: 1 });
        const { id } = await sendCalls(config, { account, chainId: CHAIN.id, calls, forceAtomic: true });
        setProgress({ phase: "mining" });
        const res = await waitForCallsStatus(config, { id, throwOnFailure: true });
        const hash = res.receipts?.at(-1)?.transactionHash;
        if (res.status !== "success" || !hash) throw new Error("The batch didn't go through.");
        return hash;
      }

      const needed = await withoutCoveredApprovals(config, account, calls);
      let last: Hex | undefined;
      for (const [i, c] of needed.entries()) {
        setProgress({ phase: "wallet", step: i + 1, of: needed.length });
        last = await sendTransaction(config, { account, chainId: CHAIN.id, to: c.to, data: c.data, value: c.value });
        setProgress({ phase: "mining", hash: last });
        const r = await waitForTransactionReceipt(config, { hash: last, chainId: CHAIN.id });
        if (r.status !== "success") throw new Error("The transaction reverted.");
      }
      return last!;
    },
    [config],
  );

  const send = useCallback(
    async (calls: Call[], opts: { sponsored?: boolean } = {}) => {
      if (!actor) return;
      try {
        let hash: Hex;
        const sponsored = actor.kind === "email" && !!opts.sponsored;
        if (actor.kind === "email") {
          const w = email?.wallet;
          if (!w) throw new Error("Sign in again to continue.");
          setProgress({ phase: "wallet", step: 1, of: 1 });
          hash = sponsored ? await w.sendSponsored(calls) : await w.sendTransactions(calls);
        } else {
          hash = await withWallet(actor.address, calls);
        }
        setProgress({ phase: "done", hash, sponsored });
        await refresh();
      } catch (e) {
        console.warn(e);
        setProgress({ phase: "error", message: explain(e) });
      }
    },
    [actor, email, withWallet, refresh],
  );

  const reset = useCallback(() => setProgress({ phase: "idle" }), []);
  const busy = progress.phase === "wallet" || progress.phase === "mining";
  return { send, progress, reset, busy, actor };
}
