import { addressUrl, txUrl } from "@underfoot/sdk";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ADDRESSES } from "@/lib/config";
import { shortHex } from "@/lib/format";
import { CONTRACTS, EXTERNAL, LIMITS, MAINNET_TXS, TESTS } from "@/lib/proof";

export const metadata: Metadata = {
  title: "Proof",
  description: "Every Underfoot contract, what it enforces, who controls it (nobody), how it's tested, and its honest limits.",
};

function Address({ address }: { address: string }) {
  return (
    <a className="link num break-all text-sm" href={addressUrl(address)} target="_blank" rel="noreferrer">
      <span className="hidden sm:inline">{address}</span>
      <span className="sm:hidden">{shortHex(address, 10, 8)}</span>
    </a>
  );
}

export default function ProofPage() {
  return (
    <>
      <SiteHeader current="/proof" />
      <main className="relative z-[3] px-4 pb-24 md:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="pb-16 pt-6 md:pt-10">
            <p className="kicker reveal">Proof · for anyone checking</p>
            <h1 className="display reveal mt-4 max-w-[16ch] text-[clamp(40px,5.4vw,76px)] leading-[0.98]" style={{ ["--d" as string]: ".06s" }}>
              Nobody runs this. <span className="text-bone-2">Here&apos;s how to check.</span>
            </h1>
            <p className="reveal mt-6 max-w-2xl text-[15.5px] leading-relaxed text-bone-2 md:text-[17px]" style={{ ["--d" as string]: ".16s" }}>
              Six contracts on Robinhood Chain, none with an owner, an admin or an upgrade path. Each link opens the contract on Blockscout.
            </p>
          </div>

          <section aria-labelledby="contracts" className="mb-24">
            <h2 id="contracts" className="kicker mb-6">
              Contracts
            </h2>
            {!ADDRESSES && (
              <p className="mb-6 border-l-2 border-tag pl-3 text-sm">Not deployed in this environment yet; addresses appear here once they are.</p>
            )}
            <ol className="border-t border-rule">
              {CONTRACTS.map((c) => (
                <li key={c.key} className="grid gap-3 border-b border-rule py-7 md:grid-cols-12 md:gap-8">
                  <div className="md:col-span-4">
                    <h3 className="display text-[26px] leading-tight tracking-[-0.03em]">{c.name}</h3>
                    <div className="mt-2">{ADDRESSES ? <Address address={ADDRESSES[c.key]} /> : <span className="num text-sm text-bone-2">—</span>}</div>
                  </div>
                  <p className="text-[15px] leading-relaxed md:col-span-5">{c.enforces}</p>
                  <p className="text-sm leading-relaxed text-bone-2 md:col-span-3">
                    <span className="label mb-2 mr-2 inline-block rounded-full border border-rule-strong px-2.5 py-1 text-bone">
                      {c.key === "lens" ? "read-only" : "no owner"}
                    </span>
                    <br />
                    {c.control}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="tests" className="mb-24">
            <h2 id="tests" className="kicker mb-6">
              Tests
            </h2>
            <dl className="grid border-y border-rule sm:grid-cols-3">
              {TESTS.map((t) => (
                <div key={t.label} className="border-b border-rule py-7 sm:border-b-0 sm:border-r sm:px-6 sm:first:pl-0 sm:last:border-r-0">
                  <dt className="label">{t.label}</dt>
                  <dd className="display mt-3 text-[48px] leading-none tracking-[-0.03em]">{t.figure}</dd>
                  <dd className="mt-3 text-sm text-bone-2">{t.note}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-bone-2">
              The fork tests run against live Robinhood Chain state: real Stock Tokens, real Chainlink feeds, real Uniswap
              pools, the real EntryPoint. The invariant run throws random redemptions, votes, outside burns, inflows, transfers and time jumps at the floor, and after every call checks that the backing per WIF of every asset hasn&apos;t gone down.
            </p>
          </section>

          <section aria-labelledby="mainnet" className="mb-24">
            <h2 id="mainnet" className="kicker mb-6">
              On mainnet
            </h2>
            <ul className="border-t border-rule">
              {MAINNET_TXS.map((t) => (
                <li key={t.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule py-4">
                  <span className="text-[15px]">
                    {t.label}
                    {t.note && <span className="num ml-2 text-xs text-bone-2">{t.note}</span>}
                  </span>
                  {t.hash ? (
                    <a className="link num text-sm" href={txUrl(t.hash)} target="_blank" rel="noreferrer">
                      {shortHex(t.hash, 10, 8)} ↗
                    </a>
                  ) : (
                    <span className="num text-xs uppercase tracking-[0.08em] text-bone-2">pending</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="limits" className="mb-24 grid gap-8 md:grid-cols-12">
            <div className="md:col-span-4">
              <h2 id="limits" className="kicker">
                Honest limits
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-bone-2">What this doesn&apos;t protect against, said plainly.</p>
            </div>
            <ol className="border-t border-rule md:col-span-8">
              {LIMITS.map((l, i) => (
                <li key={i} className="grid grid-cols-[2.5rem_1fr] border-b border-rule py-5 text-[15px] leading-relaxed">
                  <span className="num text-xs leading-6 text-bone-2">0{i + 1}</span>
                  {l}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="built-on">
            <h2 id="built-on" className="kicker mb-6">
              Built on
            </h2>
            <ul className="border-t border-rule">
              {EXTERNAL.map((e) => (
                <li key={e.address} className="grid gap-2 border-b border-rule py-4 md:grid-cols-12 md:gap-8">
                  <span className="text-[15px] md:col-span-4">{e.name}</span>
                  <span className="md:col-span-5">
                    <Address address={e.address} />
                  </span>
                  <span className="text-sm text-bone-2 md:col-span-3">{e.note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-sm text-bone-2">
              Want to act on it? <Link className="link text-bone" href="/floor">See the floor →</Link>
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
