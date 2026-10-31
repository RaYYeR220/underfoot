"use client";

import { USDG } from "@underfoot/sdk";
import type { ReactNode } from "react";
import { isAddressEqual, zeroAddress } from "viem";

import { symbolOf } from "@/lib/basket";
import { SKIP_SHORT, SKIP_TEXT } from "@/lib/explain";
import { amount, duration, shortHex, usd8 } from "@/lib/format";
import { Skip, type IntakeWire } from "@/lib/wire";

import { Meter, SectionTitle, TxLink, useNow } from "./ui";

const WINDOW = 3600;

function tokenName(t: string) {
  if (isAddressEqual(t as `0x${string}`, zeroAddress)) return "ETH";
  if (isAddressEqual(t as `0x${string}`, USDG)) return "USDG";
  return "WIF";
}

function Event({ e, now }: { e: IntakeWire["events"][number]; now: number }) {
  const ago = now - e.timestamp;
  let what: ReactNode;
  if (e.kind === "converted") {
    const isEth = !isAddressEqual(e.tokenIn, USDG);
    what = (
      <>
        Bought <span className="text-bone">{amount(BigInt(e.amountOut))} {symbolOf(e.asset)}</span> with{" "}
        {isEth ? `${amount(BigInt(e.amountIn))} ETH` : `${amount(BigInt(e.amountIn), 6)} USDG`}
      </>
    );
  } else if (e.kind === "skipped") {
    what = (
      <>
        <span className="text-tag">Skipped {symbolOf(e.asset)}</span> — {SKIP_SHORT[e.reason]}; its share went to the
        other leg
      </>
    );
  } else {
    const t = tokenName(e.token);
    what =
      t === "WIF" ? (
        <>
          Burned {amount(BigInt(e.amount))} WIF sent in by {shortHex(e.from)}
        </>
      ) : (
        <>
          Received {amount(BigInt(e.amount), t === "USDG" ? 6 : 18)} {t} from {shortHex(e.from)}
        </>
      );
  }
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-3 border-b border-rule py-3 text-sm md:grid-cols-[5.5rem_1fr_auto]">
      <span className="num text-xs leading-5 text-bone-2">{ago > 0 ? `${duration(ago)} ago` : "now"}</span>
      <span className="text-bone-2">{what}</span>
      <span className="col-start-2 text-xs md:col-start-auto">
        <TxLink hash={e.tx} />
      </span>
    </li>
  );
}

export function Enforcement({ intake, error }: { intake: IntakeWire | undefined; error: boolean }) {
  const now = useNow(15_000) ?? intake?.timestamp ?? 0;

  return (
    <section aria-labelledby="enforcement">
      <SectionTitle id="enforcement" kicker="Refusals & enforcement" title="What the intake will and won't do">
        Every buy checks Chainlink first. A stale feed, a paused token or a pool pushed off-price skips that leg; if both
        legs are out, nothing moves. At most $1,000 converts per hour, however many calls are made.
      </SectionTitle>

      {!intake ? (
        <p className="border-y border-rule py-6 text-sm text-bone-2">
          {error ? "Couldn't read the intake right now. Retrying…" : "Reading the intake…"}
        </p>
      ) : (
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="space-y-8 lg:col-span-5">
            <div>
              <div className="flex items-baseline justify-between">
                <p className="label">Hourly window</p>
                <p className="num text-sm">
                  {usd8(BigInt(intake.windowRemaining), 0)} <span className="text-bone-2">of {usd8(BigInt(intake.windowLimit), 0)} left</span>
                </p>
              </div>
              <div className="mt-3">
                <Meter value={BigInt(intake.windowRemaining)} max={BigInt(intake.windowLimit)} label="Hourly buying window remaining" />
              </div>
              {BigInt(intake.windowRemaining) < BigInt(intake.windowLimit) && intake.windowStart + WINDOW > now && (
                <p className="mt-2 text-xs text-bone-2">Refills in {duration(intake.windowStart + WINDOW - now)}</p>
              )}
            </div>

            <table className="w-full text-left text-sm">
              <caption className="label mb-3 text-left">Could each leg buy right now?</caption>
              <thead>
                <tr className="label border-b border-rule">
                  <th scope="col" className="py-2 font-normal">Leg</th>
                  <th scope="col" className="py-2 font-normal">with ETH</th>
                  <th scope="col" className="py-2 font-normal">with USDG</th>
                </tr>
              </thead>
              <tbody className="num">
                {(["cash", "target"] as const).map((leg) => (
                  <tr key={leg} className="border-b border-rule">
                    <th scope="row" className="py-3 font-normal">
                      {leg === "cash" ? "SGOV · 20%" : `${symbolOf(intake.target)} · 80%`}
                    </th>
                    {(["eth", "usdg"] as const).map((src) => {
                      const r = intake.legs[src][leg];
                      return (
                        <td key={src} className={`py-3 text-xs ${r === Skip.None ? "text-bone" : "text-tag"}`} title={SKIP_TEXT[r]}>
                          {SKIP_SHORT[r]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {[intake.legs.eth, intake.legs.usdg].some((l) => l.cash === Skip.FeedUnusable && l.target === Skip.FeedUnusable) && (
              <p className="border-l-2 border-tag pl-3 text-sm leading-relaxed">{SKIP_TEXT[Skip.FeedUnusable]}.</p>
            )}

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="label">ETH waiting</dt>
                <dd className="num mt-2">{amount(BigInt(intake.pendingEth))}</dd>
              </div>
              <div>
                <dt className="label">USDG waiting</dt>
                <dd className="num mt-2">{amount(BigInt(intake.pendingUsdg), 6)}</dd>
              </div>
            </dl>
          </div>

          <div className="lg:col-span-7">
            <p className="label mb-1">Recent buys, refusals and inflows</p>
            {intake.events.length === 0 ? (
              <p className="border-y border-rule py-6 text-sm text-bone-2">
                Nothing yet. The first ETH or USDG sent to the intake, and the first buy or refusal, will show up here.
              </p>
            ) : (
              <ol className="border-t border-rule">
                {intake.events.map((e) => (
                  <Event key={`${e.tx}-${e.logIndex}`} e={e} now={now} />
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
