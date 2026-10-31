import { coreWidths, lithology, type CoreSpec } from "@/lib/basket";

const TOTAL = 2000;
const MIN_WIDTH = 100;
/** Each row repeats its cores until one copy is wider than any likely screen. */
const MIN_ROW = 2200;
/** px per second, per row: the design's 48/56/64s drifts over a ~1,350px run. */
const SPEEDS = [28, 24, 21];

/** Every row carries the whole basket, each starting a third of the way further along, so no row is one asset. */
function rows(cores: CoreSpec[]): CoreSpec[][] {
  return [0, 1, 2].map((r) => {
    const start = Math.round((r * cores.length) / 3);
    return [...cores.slice(start), ...cores.slice(0, start)];
  });
}

export function CoreTray({ values }: { values: bigint[] }) {
  const cores = coreWidths(values, TOTAL, MIN_WIDTH);
  const empty = values.every((v) => v === 0n);
  return (
    <section className="tray reveal" style={{ ["--d" as string]: ".2s" }} aria-labelledby="tray-label">
      <p id="tray-label" className="label absolute -top-[22px] left-4 whitespace-nowrap text-[9px] md:left-10 md:text-[10.5px]">
        Tray UF-01 · <span className="hidden sm:inline">0.00–30.00 m · </span>cores are Stock Tokens
      </p>
      <ul className="sr-only">
        {cores.map((c) => (
          <li key={c.index}>
            {c.symbol}: {empty ? "nothing held yet" : `${(c.share * 100).toFixed(1)}% of the floor`}
          </li>
        ))}
      </ul>
      {rows(cores).map((row, i) => {
        const len = row.reduce((a, c) => a + c.width + 10, 0);
        const copies = Math.max(1, Math.ceil(MIN_ROW / len)) * 2;
        return (
          <div
            key={i}
            className="tray-row"
            data-reverse={i % 2 === 1 ? "" : undefined}
            style={{ ["--t" as string]: `${Math.round((len * copies) / 2 / SPEEDS[i]!)}s` }}
            aria-hidden
          >
            <div className="tray-track">
              {Array.from({ length: copies }, (_, k) =>
                row.map((c) => (
                  <div
                    key={`${k}-${c.index}`}
                    className={`core ${lithology(c.index)}`}
                    style={{ ["--w" as string]: c.width }}
                    title={empty ? c.symbol : `${c.symbol} · ${(c.share * 100).toFixed(1)}%`}
                  >
                    <b className="core-tag" data-accent={c.index === 0 ? "" : undefined}>
                      {c.symbol}
                    </b>
                  </div>
                )),
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
