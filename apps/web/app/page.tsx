import Link from "next/link";

import { CoreTray } from "@/components/core-tray";
import { LiveStrip } from "@/components/landing/live-strip";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cachedLedger, cachedSnapshot, settle } from "@/lib/data";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    verb: "Burn WIF",
    result: "take your slice",
    body: "Burn any amount and the floor pays you that share of every Stock Token it holds, in kind, straight to your wallet. 1% stays behind for everyone who's left.",
  },
  {
    verb: "Burn WIF",
    result: "pick tomorrow's stock",
    body: "Each day from 00:00 UTC, burn at least 1 WIF for one of nine stocks. Whatever leads at midnight gets 80% of the next day's buys; SGOV T-bills always get the other 20%.",
  },
  {
    verb: "Every burn on the chain",
    result: "raises the floor",
    body: "The basket is split across circulating WIF. Votes, redemptions, buybacks, games, anyone burning anywhere on Robinhood Chain: fewer WIF, same stocks, more backing per WIF.",
  },
];

export default async function Page() {
  const [snapshot, ledger] = await Promise.all([settle(cachedSnapshot()), settle(cachedLedger())]);
  const values = snapshot?.assets.map((a) => BigInt(a.valueUsd)) ?? Array<bigint>(10).fill(0n);

  return (
    <>
      <div className="relative flex min-h-[100svh] flex-col">
        <SiteHeader />
        <main className="relative z-[3] flex flex-1 flex-col items-center px-4 pb-16 pt-[5vh] text-center md:px-6">
          <p className="kicker reveal flex items-center gap-3 text-[10.5px] md:gap-[14px] md:text-[11.5px]">
            <i className="inline-block h-px w-4 bg-bone-2 md:w-7" />
            Borehole UF-01 · Robinhood Chain
            <i className="inline-block h-px w-4 bg-bone-2 md:w-7" />
          </p>
          <h1
            className="display reveal mt-7 max-w-[13ch] text-[clamp(44px,6.3vw,92px)] leading-[0.98]"
            style={{ ["--d" as string]: ".06s" }}
          >
            There&apos;s a floor under $WIF now. <span className="text-bone-2">It&apos;s made of stocks.</span>
          </h1>
          <p
            className="reveal mt-6 max-w-xl text-[15.5px] leading-[1.55] text-bone-2 md:text-[17px]"
            style={{ ["--d" as string]: ".16s" }}
          >
            Underfoot holds a basket of Stock Tokens and T-bills. Burn WIF to take your slice of every core, in kind.
            What you leave behind raises the floor for everyone else.
          </p>
          <Link href="/floor" className="btn btn-solid reveal mt-[30px] px-[26px] py-[15px]" style={{ ["--d" as string]: ".26s" }}>
            See the floor →
          </Link>
        </main>
        <CoreTray values={values} />
      </div>

      <section className="relative z-[3] px-4 py-24 md:px-10 md:py-32" aria-labelledby="how">
        <div className="mx-auto max-w-6xl">
          <p id="how" className="kicker">How it works</p>
          <ol className="mt-10 border-t border-rule">
            {STEPS.map((s, i) => (
              <li key={s.result} className="grid gap-4 border-b border-rule py-9 md:grid-cols-12 md:gap-8 md:py-12">
                <span className="num text-xs text-bone-2 md:col-span-1 md:pt-3">0{i + 1}</span>
                <h2 className="display text-[34px] leading-[1.02] md:col-span-6 md:text-[52px]">
                  {s.verb} <span aria-hidden className="text-bone-2">→</span>
                  <span className="sr-only"> then </span> <span className="text-bone-2">{s.result}</span>
                </h2>
                <p className="max-w-md text-[15.5px] leading-relaxed text-bone-2 md:col-span-5 md:pt-3">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 max-w-3xl text-[15.5px] leading-relaxed text-bone-2">
            Where the stocks come from: anyone can send ETH, USDG, WIF or Stock Tokens to the intake. WIF is burned on
            arrival; ETH and USDG are converted only when Chainlink is fresh and pools are on-price. And every swap on the
            WIF/SPY pool sends 0.5% to the floor.
          </p>
        </div>
      </section>

      <section className="relative z-[3] px-4 pb-24 md:px-10" aria-labelledby="live">
        <div className="mx-auto max-w-6xl">
          <p id="live" className="kicker mb-6">Live from Robinhood Chain</p>
          <LiveStrip snapshot={snapshot} ledger={ledger} />
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
