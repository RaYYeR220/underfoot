"use client";

import { convertCall, intakeAbi, type FloorSnapshot } from "@underfoot/sdk";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { usePublicClient } from "wagmi";

import { ADDRESSES, CHAIN } from "@/lib/config";
import { SKIP_SHORT, explain } from "@/lib/explain";
import { amount, usd8 } from "@/lib/format";
import { Skip, type IntakeWire } from "@/lib/wire";

import { ConnectPrompt } from "./connect-prompt";
import { ProgressNote, Swatch } from "./ui";
import { useSend } from "./use-send";

/** Room for the price to move between this read and the block the buy lands in. */
const HEADROOM = 98n;

export function BuyPanel({ s, intake }: { s: FloorSnapshot; intake: IntakeWire | undefined }) {
  const { send, progress, reset, busy, actor } = useSend();
  const client = usePublicClient({ chainId: CHAIN.id });

  // the snapshot is re-read from the chain right after your own transaction, so it is the fresher source
  const pendingEth = s.pendingEth;
  const pendingUsdg = s.pendingUsdg;
  const ethUsd = intake ? BigInt(intake.ethUsd) : 0n;
  const remaining = intake ? BigInt(intake.windowRemaining) : 0n;
  const ethValue = (pendingEth * ethUsd) / 10n ** 18n;
  const usdgValue = pendingUsdg * 100n;

  const [pick, setPick] = useState<boolean | null>(null);
  const fromEth = pick ?? ethValue >= usdgValue;
  const pending = fromEth ? pendingEth : pendingUsdg;
  // what's waiting, capped by what's left of this hour's window
  const cap = fromEth
    ? ethUsd > 0n
      ? (remaining * HEADROOM * 10n ** 18n) / 100n / ethUsd
      : 0n
    : (remaining * HEADROOM) / 100n / 100n;
  const size = pending < cap ? pending : cap;
  const target = intake?.target ?? s.target;
  const legs = intake ? (fromEth ? intake.legs.eth : intake.legs.usdg) : null;

  const sim = useQuery({
    queryKey: ["convert-sim", fromEth, size.toString(), s.timestamp],
    queryFn: async () => {
      try {
        const { result } = await client!.simulateContract({
          address: ADDRESSES!.intake,
          abi: intakeAbi,
          functionName: "convert",
          args: [fromEth, size],
          account: actor?.address,
        });
        return { ok: true as const, cash: result[0], target: result[1] };
      } catch (e) {
        return { ok: false as const, reason: explain(e) };
      }
    },
    enabled: !!client && !!ADDRESSES && size > 0n,
  });

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-bone-2">
        Anyone can trigger the buy. It has no discretion: it either buys at Chainlink prices or refuses, and here you can
        see which before you send anything.
      </p>

      <div role="radiogroup" aria-label="Spend" className="flex gap-2">
        {[true, false].map((eth) => (
          <label
            key={String(eth)}
            className="num cursor-pointer rounded-full border border-rule px-4 py-2 text-sm transition-colors hover:border-rule-strong has-[:checked]:border-bone has-[:checked]:bg-bone has-[:checked]:text-umber-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bone"
          >
            <input type="radio" name="buy-source" className="sr-only" checked={fromEth === eth} onChange={() => setPick(eth)} />
            {eth ? `ETH · ${amount(pendingEth)}` : `USDG · ${amount(pendingUsdg, 6)}`}
          </label>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-3 border-y border-rule py-4 text-sm">
        <div>
          <dt className="label">Waiting at the intake</dt>
          <dd className="num mt-2">{usd8(fromEth ? ethValue : usdgValue)}</dd>
        </div>
        <div>
          <dt className="label">Left this hour</dt>
          <dd className="num mt-2">{intake ? `${usd8(remaining, 0)} of ${usd8(BigInt(intake.windowLimit), 0)}` : "—"}</dd>
        </div>
        {legs && (
          <>
            <div>
              <dt className="label">Cash leg · SGOV</dt>
              <dd className={`num mt-2 ${legs.cash === Skip.None ? "" : "text-tag"}`}>{SKIP_SHORT[legs.cash]}</dd>
            </div>
            <div>
              <dt className="label">Vote winner · {s.assets[target]?.symbol}</dt>
              <dd className={`num mt-2 ${legs.target === Skip.None ? "" : "text-tag"}`}>{SKIP_SHORT[legs.target]}</dd>
            </div>
          </>
        )}
      </dl>

      <div role="status" aria-live="polite" className="rounded-[20px] border border-rule p-4 text-sm leading-relaxed">
        {size === 0n ? (
          <p className="text-bone-2">
            {pending === 0n
              ? "Nothing is waiting at the intake. Send ETH or USDG from the Fund tab and it can be bought."
              : "This hour's buying cap is used up. It reopens within the hour."}
          </p>
        ) : sim.isLoading ? (
          <p className="text-bone-2">Simulating the buy…</p>
        ) : sim.data?.ok ? (
          <div>
            <p className="label">This buy would add</p>
            <ul className="num mt-3 space-y-2">
              {sim.data.cash > 0n && (
                <li className="flex items-center gap-2.5">
                  <Swatch index={0} className="h-3 w-6" /> {amount(sim.data.cash)} SGOV
                </li>
              )}
              {sim.data.target > 0n && (
                <li className="flex items-center gap-2.5">
                  <Swatch index={target} className="h-3 w-6" /> {amount(sim.data.target)} {s.assets[target]?.symbol}
                </li>
              )}
            </ul>
            <p className="mt-3 text-xs text-bone-2">
              Spending {fromEth ? `${amount(size)} ETH` : `${amount(size, 6)} USDG`}.
            </p>
          </div>
        ) : sim.data ? (
          <div className="border-l-2 border-tag pl-3">
            <p className="label text-tag">Refused</p>
            <p className="mt-2 text-bone">{sim.data.reason}</p>
          </div>
        ) : null}
      </div>

      {!actor ? (
        <ConnectPrompt verb="trigger the buy" />
      ) : (
        <button
          type="button"
          className="btn btn-solid"
          disabled={busy || !sim.data?.ok}
          onClick={() => ADDRESSES && send([convertCall(ADDRESSES, { fromEth, amountIn: size })])}
        >
          Buy now
        </button>
      )}
      <ProgressNote progress={progress} onReset={reset} />
    </div>
  );
}
