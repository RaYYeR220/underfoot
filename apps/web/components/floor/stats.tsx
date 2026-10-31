import type { FloorSnapshot } from "@underfoot/sdk";

import { amount, compact, significant, usd, usdPrecise } from "@/lib/format";
import type { LedgerWire } from "@/lib/wire";

/** Backing ÷ price as a percent, kept exact in bigint until the last step. */
function coveragePercent(s: FloorSnapshot): string | null {
  if (s.wifPriceUsd === 0n) return null;
  return `${significant((s.backingPerWifUsd * 10n ** 20n) / s.wifPriceUsd, 18, 3)}%`;
}

export function Stats({ s, ledger }: { s: FloorSnapshot; ledger: LedgerWire | undefined }) {
  const coverage = coveragePercent(s);
  const cells = [
    { label: "WIF spot price", value: s.wifPriceUsd > 0n ? usdPrecise(s.wifPriceUsd, 4) : "unavailable" },
    {
      label: "Coverage",
      value: coverage ?? "—",
      note: "of the price is backed by stocks",
    },
    { label: "Floor value", value: usd(s.navUsd) },
    { label: "Circulating WIF", value: compact(s.circulating), title: amount(s.circulating) },
    {
      label: "WIF burned, all time",
      value: ledger ? compact(BigInt(ledger.totalBurned)) : "—",
      title: ledger ? amount(BigInt(ledger.totalBurned)) : undefined,
      note: ledger ? `${ledger.count} burns` : undefined,
    },
    { label: "Buying now", value: s.assets[s.target]?.symbol ?? "—", note: "yesterday's vote · 80% of buys" },
  ];

  return (
    <section aria-labelledby="backing" className="border-y border-rule">
      <div className="grid lg:grid-cols-12">
        <div className="border-b border-rule py-8 lg:col-span-6 lg:border-b-0 lg:border-r lg:pr-8">
          <p id="backing" className="label">
            Backing per WIF
          </p>
          <p className="display mt-4 whitespace-nowrap text-[clamp(30px,4.4vw,58px)] leading-none tracking-[-0.03em]">
            {usdPrecise(s.backingPerWifUsd, 6)}
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-bone-2">
            Stocks behind each circulating WIF, at Chainlink prices. Redemptions leave 1% behind, so this only goes up.
          </p>
        </div>
        {/* each cell draws its top and left rule; the ones on the outer edge are clipped away */}
        <dl className="grid grid-cols-2 overflow-hidden lg:col-span-6 lg:grid-cols-3">
          {cells.map((c) => (
            <div key={c.label} className="-ml-px -mt-px border-l border-t border-rule px-4 py-6 lg:px-6">
              <dt className="label">{c.label}</dt>
              <dd className="num mt-3 text-xl tracking-tight md:text-2xl" title={c.title}>
                {c.value}
              </dd>
              {c.note && <dd className="mt-1 text-xs text-bone-2">{c.note}</dd>}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
