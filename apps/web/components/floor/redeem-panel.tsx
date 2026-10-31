"use client";

import { SPONSOR_MIN_BURN, quoteRedeem, redeemCalls, type FloorSnapshot } from "@underfoot/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";

import { ADDRESSES, CHAIN } from "@/lib/config";
import { amount, parseAmount, usd } from "@/lib/format";

import { ConnectPrompt } from "./connect-prompt";
import { useDebounced } from "./hooks";
import { AmountField, ProgressNote, Swatch } from "./ui";
import { useSend } from "./use-send";
import { useWifBalance } from "./wallet-button";

export function RedeemPanel({ s }: { s: FloorSnapshot }) {
  const { send, progress, reset, busy, actor } = useSend();
  const [input, setInput] = useState("");
  const value = parseAmount(input);
  const quoted = useDebounced(value);
  const balance = useWifBalance(actor?.address);
  const client = usePublicClient({ chainId: CHAIN.id });

  const quote = useQuery({
    queryKey: ["quote", quoted?.toString()],
    queryFn: () => quoteRedeem(client as never, ADDRESSES!, quoted!),
    enabled: quoted !== null && !!client && !!ADDRESSES,
  });

  // a paused Stock Token can't be transferred; skip it and its share stays in the floor
  const paused = s.assets.filter((a) => a.paused);
  const skipMask = paused.reduce((m, a) => m | (1n << BigInt(a.index)), 0n);
  const sponsored = actor?.kind === "email" && value !== null && value >= SPONSOR_MIN_BURN;
  const tooMuch = value !== null && balance.data !== undefined && value > balance.data;

  const rows =
    quote.data
      ?.map((units, i) => ({ i, units, value: (units * (s.assets[i]?.price ?? 0n)) / 10n ** 8n }))
      .filter((r) => r.units > 0n && !s.assets[r.i]?.paused) ?? [];
  const total = rows.reduce((a, r) => a + r.value, 0n);

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-bone-2">
        Burn WIF and the floor sends you that share of every Stock Token it holds, in kind. 1% stays behind and raises the
        floor for everyone left.
      </p>
      <AmountField
        label="WIF to burn"
        value={input}
        onChange={setInput}
        unit="WIF"
        hint={balance.data !== undefined ? `balance ${amount(balance.data)}` : undefined}
        onMax={balance.data ? () => setInput(formatUnits(balance.data, 18)) : undefined}
      />

      <div className="rounded-[20px] border border-rule p-4">
        <p className="label">You receive</p>
        {value === null ? (
          <p className="mt-3 text-sm text-bone-2">Enter an amount to see your slice.</p>
        ) : quote.isLoading || quoted !== value ? (
          <p className="mt-3 text-sm text-bone-2">Quoting…</p>
        ) : quote.error ? (
          <p className="mt-3 text-sm text-bone-2">Couldn&apos;t read a quote from the chain. Try again in a moment.</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-bone-2">The floor holds nothing yet, so there&apos;s nothing to take.</p>
        ) : (
          <>
            <ul className="mt-3 space-y-2">
              {rows.map((r) => (
                <li key={r.i} className="num flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2.5">
                    <Swatch index={r.i} className="h-3 w-6" />
                    {s.assets[r.i]?.symbol}
                  </span>
                  <span>
                    {amount(r.units)} <span className="text-bone-2">· {usd(r.value)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="num mt-4 flex justify-between border-t border-rule pt-3 text-sm">
              <span className="text-bone-2">Total at Chainlink prices</span>
              <span>{usd(total)}</span>
            </p>
          </>
        )}
        {paused.length > 0 && (
          <p className="mt-3 text-xs text-tag">
            {paused.map((a) => a.symbol).join(", ")} paused by the issuer — skipped; that share stays in the floor.
          </p>
        )}
      </div>

      {!actor ? (
        <ConnectPrompt verb="redeem" />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-solid"
            disabled={busy || value === null || tooMuch || rows.length === 0}
            onClick={() => value && send(redeemCalls(ADDRESSES!, { amount: value, to: actor.address, skipMask }), { sponsored })}
          >
            {tooMuch ? "Not enough WIF" : `Burn ${value ? amount(value) : ""} WIF for this slice`}
          </button>
          {sponsored && <span className="label rounded-full border border-rule-strong px-3 py-1.5">Gas paid by the floor</span>}
        </div>
      )}
      <ProgressNote progress={progress} onReset={reset} />
    </div>
  );
}

