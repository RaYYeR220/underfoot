"use client";

import { addressUrl } from "@underfoot/sdk";
import { useState } from "react";

import { amount, duration, percent, shortHex } from "@/lib/format";
import type { BurnSource, LedgerWire } from "@/lib/wire";

import { SectionTitle, TxLink, useNow } from "./ui";

const ORDER: BurnSource[] = ["vote", "redeem", "intake", "pool", "v4-hooks", "contracts", "holders"];
const OURS = new Set<BurnSource>(["vote", "redeem", "intake", "pool"]);

export function Ledger({ ledger, error }: { ledger: LedgerWire | undefined; error: boolean }) {
  const [all, setAll] = useState(false);
  const now = useNow(15_000);

  return (
    <section aria-labelledby="ledger">
      <SectionTitle id="ledger" kicker="Burn ledger" title="Every WIF burned on Robinhood Chain">
        Any burn anywhere raises backing per WIF, not just ours. This counts every transfer to the zero or dead address
        since WIF was minted, and says where it came from.
      </SectionTitle>

      {!ledger ? (
        <p className="border-y border-rule py-6 text-sm text-bone-2">
          {error ? "Couldn't read the ledger right now. Retrying…" : "Reading the ledger…"}
        </p>
      ) : (
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="label">Burned, all time</p>
            <p className="display mt-3 text-[40px] leading-none tracking-[-0.03em]">
              {amount(BigInt(ledger.totalBurned))} <span className="text-bone-2">WIF</span>
            </p>
            <p className="num mt-2 text-xs text-bone-2">
              {ledger.count} burns · to block {ledger.toBlock}
            </p>
            <ul className="mt-8 border-t border-rule">
              {ORDER.map((k) => {
                const v = ledger.bySource[k];
                const share = BigInt(ledger.totalBurned) === 0n ? 0 : Number((BigInt(v.amount) * 1000n) / BigInt(ledger.totalBurned)) / 10;
                return (
                  <li key={k} className="border-b border-rule py-3">
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className={OURS.has(k) ? "text-bone" : "text-bone-2"}>{ledger.labels[k]}</span>
                      <span className="num shrink-0">
                        {amount(BigInt(v.amount))} <span className="text-bone-2">· {v.count}</span>
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule" aria-hidden>
                      <div
                        className={`h-full rounded-full ${OURS.has(k) ? "bg-bone" : "bg-bone-2/70"}`}
                        style={{ width: `${Math.max(share, v.count > 0 ? 0.6 : 0)}%` }}
                      />
                    </div>
                    <span className="sr-only">{percent(BigInt(v.amount), BigInt(ledger.totalBurned))} of all burns</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="lg:col-span-7">
            <p className="label mb-1">Recent burns</p>
            {ledger.recent.length === 0 ? (
              <p className="border-y border-rule py-6 text-sm text-bone-2">No burns yet.</p>
            ) : (
              <>
                <ol className="border-t border-rule">
                  {ledger.recent.slice(0, all ? undefined : 12).map((b) => (
                    <li
                      key={`${b.tx}-${b.logIndex}`}
                      className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-rule py-3 text-sm md:grid-cols-[5.5rem_7.5rem_1fr_auto]"
                    >
                      <span className="num order-3 text-xs text-bone-2 md:order-none md:leading-5">
                        {now && b.timestamp ? `${duration(now - b.timestamp)} ago` : `block ${b.block}`}
                      </span>
                      <span className="num whitespace-nowrap">{amount(BigInt(b.amount))} WIF</span>
                      <span className="order-4 min-w-0 truncate text-xs text-bone-2 md:order-none md:text-sm">
                        {ledger.labels[b.source]} ·{" "}
                        <a className="link num" href={addressUrl(b.actor)} target="_blank" rel="noreferrer">
                          {shortHex(b.actor)}
                        </a>
                      </span>
                      <span className="order-2 text-right text-xs md:order-none md:leading-5">
                        <TxLink hash={b.tx} />
                      </span>
                    </li>
                  ))}
                </ol>
                {ledger.recent.length > 12 && (
                  <button type="button" className="link mt-4 text-sm text-bone-2" onClick={() => setAll((a) => !a)}>
                    {all ? "Show fewer" : `Show all ${ledger.recent.length} recent burns`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
