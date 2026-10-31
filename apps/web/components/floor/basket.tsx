import { BASKET, addressUrl, type FloorAsset, type FloorSnapshot } from "@underfoot/sdk";

import { lithology, nameOf } from "@/lib/basket";
import { amount, decimal, duration, percent, usd, usd8 } from "@/lib/format";

import { SectionTitle, Swatch } from "./ui";

/** Feeds heartbeat daily on trading days; the intake refuses anything older than 26h. */
const MAX_AGE = 26 * 3600;

function feedState(a: FloorAsset, now: number): { age: string; alert: string | null } {
  const age = duration(now - a.updatedAt);
  if (a.paused) return { age, alert: "token paused" };
  if (a.oraclePaused) return { age, alert: "price paused" };
  if (a.stale || now - a.updatedAt > MAX_AGE) return { age, alert: "stale · markets closed" };
  return { age, alert: null };
}

/** The basket as one drilled core: lithology changes along its length, in proportion to value. */
function Core({ s }: { s: FloorSnapshot }) {
  const total = s.navUsd;
  const min = 0.018;
  const raw = s.assets.map((a) => (total === 0n ? 1 / s.assets.length : Number((a.valueUsd * 10_000n) / total) / 10_000));
  const lifted = raw.map((r) => Math.max(r, min));
  const sum = lifted.reduce((a, b) => a + b, 0);
  const widths = lifted.map((w) => (w / sum) * 100);

  return (
    <figure className="mt-2">
      <div className="core flex h-14 overflow-hidden md:h-[72px]" style={{ ["--c" as string]: "transparent" }} aria-hidden>
        {s.assets.map((a, i) => (
          <div
            key={a.index}
            className={`${lithology(a.index)} relative h-full border-r border-umber-1/60 last:border-r-0`}
            style={{ width: `${widths[i]}%`, background: "var(--pat, none), var(--c)" }}
          >
            {widths[i]! >= 9 && (
              <b className="core-tag left-3" data-accent={a.index === 0 ? "" : undefined}>
                {BASKET[a.index]?.symbol}
              </b>
            )}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,.28)_0,rgba(255,255,255,.06)_22%,transparent_45%,rgba(0,0,0,.18)_70%,rgba(0,0,0,.5)_100%)]" />
      </div>
      <figcaption className="label mt-3 flex justify-between">
        <span>0.00 m</span>
        <span className="hidden sm:inline">core UF-01 · length ∝ USD value{total === 0n ? " · empty, shown equal" : ""}</span>
        <span>30.00 m</span>
      </figcaption>
    </figure>
  );
}

export function Basket({ s }: { s: FloorSnapshot }) {
  const now = s.timestamp;
  return (
    <section aria-labelledby="basket">
      <SectionTitle id="basket" kicker="The basket" title="Ten Stock Tokens, fixed at deploy">
        SGOV is the cash leg: T-bills, a fixed 20% of every buy. The other nine are what holders vote on. Prices are
        Chainlink&apos;s and already include each token&apos;s multiplier.
      </SectionTitle>
      <Core s={s} />

      <div className="mt-10 hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Basket holdings</caption>
          <thead>
            <tr className="label border-b border-rule">
              <th scope="col" className="py-3 font-normal">Asset</th>
              <th scope="col" className="py-3 pl-4 text-right font-normal">Held</th>
              <th scope="col" className="py-3 pl-4 text-right font-normal">Chainlink</th>
              <th scope="col" className="py-3 pl-4 text-right font-normal">Value</th>
              <th scope="col" className="py-3 pl-6 font-normal">Feed age</th>
            </tr>
          </thead>
          <tbody>
            {s.assets.map((a) => {
              const f = feedState(a, now);
              return (
                <tr key={a.index} className="border-b border-rule align-top">
                  <th scope="row" className="py-3 font-normal">
                    <a href={addressUrl(a.token)} target="_blank" rel="noreferrer" className="group flex items-start gap-3">
                      <Swatch index={a.index} className="mt-0.5 h-3.5 w-7 shrink-0" />
                      <span>
                        <span className="num block text-bone group-hover:underline">{a.symbol}</span>
                        <span className="mt-0.5 block text-xs text-bone-2">{nameOf(a.index)}</span>
                      </span>
                    </a>
                  </th>
                  <td className="num py-3 pl-4 text-right">
                    {amount(a.balance)}
                    <span className="mt-0.5 block text-xs text-bone-2" title="Multiplier">×{decimal(a.multiplier, 18, 4)}</span>
                  </td>
                  <td className="num py-3 pl-4 text-right text-bone-2">{a.price > 0n ? usd8(a.price) : "—"}</td>
                  <td className="num py-3 pl-4 text-right">
                    {usd(a.valueUsd)}
                    <span className="mt-0.5 block text-xs text-bone-2">{percent(a.valueUsd, s.navUsd)} of floor</span>
                  </td>
                  <td className="num whitespace-nowrap py-3 pl-6 text-xs">
                    <span className="text-bone-2">{f.age}</span>
                    {f.alert && <span className="mt-0.5 block text-tag">{f.alert}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="mt-8 md:hidden">
        {s.assets.map((a) => {
          const f = feedState(a, now);
          return (
            <li key={a.index} className="border-b border-rule py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <Swatch index={a.index} />
                  <span className="num">{a.symbol}</span>
                  <span className="num text-xs text-bone-2">{amount(a.balance)} held</span>
                </span>
                <span className="num">{usd(a.valueUsd)}</span>
              </div>
              <p className="num mt-1.5 pl-10 text-xs text-bone-2">
                {a.price > 0n ? usd8(a.price) : "—"} · ×{decimal(a.multiplier, 18, 4)} · feed {f.age}
                {f.alert && <span className="block text-tag">{f.alert}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
