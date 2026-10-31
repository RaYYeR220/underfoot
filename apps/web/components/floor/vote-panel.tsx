"use client";

import { MIN_VOTE, SPONSOR_MIN_BURN, voteCalls, type FloorSnapshot } from "@underfoot/sdk";
import { useState } from "react";
import { formatUnits } from "viem";

import { nameOf } from "@/lib/basket";
import { ADDRESSES } from "@/lib/config";
import { amount, clock, parseAmount } from "@/lib/format";

import { ConnectPrompt } from "./connect-prompt";
import { AmountField, ProgressNote, Swatch, useNow } from "./ui";
import { useSend } from "./use-send";
import { useWifBalance } from "./wallet-button";

export function VotePanel({ s }: { s: FloorSnapshot }) {
  const { send, progress, reset, busy, actor } = useSend();
  const options = s.assets.filter((a) => a.index > 0);
  const [choice, setChoice] = useState(s.leader > 0 ? s.leader : 1);
  const [input, setInput] = useState("1");
  const value = parseAmount(input);
  const balance = useWifBalance(actor?.address);
  const now = useNow();

  const top = options.reduce((m, a) => (a.tally > m ? a.tally : m), 0n);
  const noVotes = s.epochBurned === 0n;
  const sponsored = actor?.kind === "email" && value !== null && value >= SPONSOR_MIN_BURN;
  const tooSmall = value !== null && value < MIN_VOTE;
  const tooMuch = value !== null && balance.data !== undefined && value > balance.data;
  const sym = s.assets[choice]?.symbol ?? "";

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-3 gap-3 border-y border-rule py-4">
        <div>
          <dt className="label">Buying now</dt>
          <dd className="num mt-2 flex items-center gap-2 text-sm">
            <Swatch index={s.target} className="h-3 w-6" />
            {s.assets[s.target]?.symbol}
          </dd>
        </div>
        <div>
          <dt className="label">Leading today</dt>
          <dd className="num mt-2 text-sm">{noVotes ? "no votes yet" : s.assets[s.leader]?.symbol}</dd>
        </div>
        <div>
          <dt className="label">Closes in</dt>
          <dd className="num mt-2 text-sm">{now ? clock(s.epochEnd - now) : "—"}</dd>
        </div>
      </dl>

      <fieldset>
        <legend className="label mb-3">Tomorrow&apos;s stock · today&apos;s tallies</legend>
        <div className="space-y-1.5">
          {options.map((a) => {
            const pct = top === 0n ? 0 : Number((a.tally * 1000n) / top) / 10;
            const lead = !noVotes && a.index === s.leader;
            return (
              <label
                key={a.index}
                className="relative flex cursor-pointer items-center gap-3 rounded-full border border-rule px-3 py-2 transition-colors hover:border-rule-strong has-[:checked]:border-bone has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bone"
              >
                <input
                  type="radio"
                  name="vote-option"
                  value={a.index}
                  checked={choice === a.index}
                  onChange={() => setChoice(a.index)}
                  className="sr-only"
                />
                <Swatch index={a.index} className="h-3.5 w-7 shrink-0" />
                <span className="num w-14 shrink-0 text-sm">{a.symbol}</span>
                <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-rule" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full bg-bone-2" style={{ width: `${pct}%` }} />
                </span>
                <span className="num w-24 shrink-0 text-right text-xs text-bone-2">
                  {amount(a.tally)}
                  {lead && <span className="ml-1.5 text-tag">lead</span>}
                </span>
                <span className="sr-only">{nameOf(a.index)}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-bone-2">
          Votes burn WIF. The leader at 00:00 UTC gets 80% of the next day&apos;s buys, and nobody can steer the buy
          that&apos;s already running. No votes means SPY.
        </p>
      </fieldset>

      <AmountField
        label={`WIF to burn for ${sym}`}
        value={input}
        onChange={setInput}
        unit="WIF"
        hint={balance.data !== undefined ? `balance ${amount(balance.data)}` : "minimum 1"}
        onMax={balance.data ? () => setInput(formatUnits(balance.data, 18)) : undefined}
      />

      {!actor ? (
        <ConnectPrompt verb="vote" />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-solid"
            disabled={busy || value === null || tooSmall || tooMuch}
            onClick={() => value && send(voteCalls(ADDRESSES!, { option: choice, amount: value }), { sponsored })}
          >
            {tooSmall
              ? "A vote burns at least 1 WIF"
              : tooMuch
                ? "Not enough WIF"
                : `Burn ${value ? amount(value) : ""} WIF for ${sym}`}
          </button>
          {sponsored && <span className="label rounded-full border border-rule-strong px-3 py-1.5">Gas paid by the floor</span>}
        </div>
      )}
      <ProgressNote progress={progress} onReset={reset} />
    </div>
  );
}
