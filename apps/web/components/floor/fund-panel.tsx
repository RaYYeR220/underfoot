"use client";

import { USDG, WIF, fundEthCall, fundTokenCalls, type FloorSnapshot } from "@underfoot/sdk";
import { useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";

import { ADDRESSES, CHAIN } from "@/lib/config";
import { amount, parseAmount } from "@/lib/format";

import { ConnectPrompt } from "./connect-prompt";
import { AmountField, ProgressNote } from "./ui";
import { useSend } from "./use-send";

type Source = "ETH" | "USDG" | "WIF";
const DECIMALS: Record<Source, number> = { ETH: 18, USDG: 6, WIF: 18 };
/** Left in the wallet for gas when sending "max" ETH. */
const GAS_RESERVE = 5n * 10n ** 14n;

export function FundPanel({ s }: { s: FloorSnapshot }) {
  const { send, progress, reset, busy, actor } = useSend();
  const [source, setSource] = useState<Source>("ETH");
  const [input, setInput] = useState("");
  const value = parseAmount(input, DECIMALS[source]);
  const target = s.assets[s.target]?.symbol ?? "SPY";

  const eth = useBalance({ address: actor?.address, chainId: CHAIN.id, query: { enabled: !!actor } });
  const token = useReadContract({
    address: source === "USDG" ? USDG : WIF,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: actor ? [actor.address] : undefined,
    chainId: CHAIN.id,
    query: { enabled: !!actor && source !== "ETH" },
  });
  const balance = source === "ETH" ? eth.data?.value : token.data;
  const max = source === "ETH" && balance !== undefined ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance;
  const tooMuch = value !== null && balance !== undefined && value > balance;

  const buys = `Waits at the intake until someone triggers a buy: 20% SGOV, 80% ${target}, only near Chainlink prices.`;
  const what: Record<Source, string> = {
    ETH: buys,
    USDG: buys,
    WIF: "Burned the moment it arrives. Nothing is bought; there are simply fewer WIF sharing the same basket.",
  };

  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-bone-2">
        Anyone can feed the floor: creator fees, a slice of a game&apos;s pot, a donation. Nothing comes back to you;
        every WIF holder gets a little more behind each token.
      </p>
      <div role="radiogroup" aria-label="What to send" className="flex gap-2">
        {(Object.keys(DECIMALS) as Source[]).map((k) => (
          <label
            key={k}
            className="num cursor-pointer rounded-full border border-rule px-4 py-2 text-sm transition-colors hover:border-rule-strong has-[:checked]:border-bone has-[:checked]:bg-bone has-[:checked]:text-umber-1 has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-bone"
          >
            <input
              type="radio"
              name="fund-source"
              className="sr-only"
              checked={source === k}
              onChange={() => {
                setSource(k);
                setInput("");
              }}
            />
            {k}
          </label>
        ))}
      </div>
      <AmountField
        label={`${source} to send`}
        value={input}
        onChange={setInput}
        unit={source}
        hint={balance !== undefined ? `balance ${amount(balance, DECIMALS[source])}` : undefined}
        onMax={max ? () => setInput(formatUnits(max, DECIMALS[source])) : undefined}
      />
      <p className="text-sm leading-relaxed text-bone-2">{what[source]}</p>

      {!actor ? (
        <ConnectPrompt verb="fund the floor" />
      ) : (
        <button
          type="button"
          className="btn btn-solid"
          disabled={busy || value === null || tooMuch}
          onClick={() => {
            if (!value || !ADDRESSES) return;
            send(
              source === "ETH"
                ? [fundEthCall(ADDRESSES, value)]
                : fundTokenCalls(ADDRESSES, source === "USDG" ? USDG : WIF, value),
            );
          }}
        >
          {tooMuch ? `Not enough ${source}` : `Send ${value ? amount(value, DECIMALS[source]) : ""} ${source} to the floor`}
        </button>
      )}
      <ProgressNote progress={progress} onReset={reset} />
    </div>
  );
}
