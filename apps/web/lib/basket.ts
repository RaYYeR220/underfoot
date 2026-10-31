import { BASKET } from "@underfoot/sdk";

/** One lithology per basket asset, in contract order. SGOV is the bedrock. */
const LITHOLOGY = ["gran", "sand", "shale", "iron", "mud", "lime", "glau", "silt", "chalk", "marl"] as const;

export const lithology = (index: number) => `lith-${LITHOLOGY[index % LITHOLOGY.length]}`;

export const symbolOf = (index: number) => BASKET[index]?.symbol ?? `#${index}`;
export const nameOf = (index: number) => BASKET[index]?.name ?? "";

export interface CoreSpec {
  index: number;
  symbol: string;
  /** Share of the floor's USD value, 0..1. */
  share: number;
  width: number;
}

/**
 * Core lengths for a tray: a floor of `minWidth` per asset so an empty one still shows, the rest
 * split by USD value. An empty floor gets equal cores.
 */
export function coreWidths(values: bigint[], total: number, minWidth: number): CoreSpec[] {
  const sum = values.reduce((a, b) => a + b, 0n);
  const spare = Math.max(0, total - minWidth * values.length);
  return values.map((v, index) => {
    // basis points keep the bigint division exact enough for layout
    const share = sum === 0n ? 1 / values.length : Number((v * 10_000n) / sum) / 10_000;
    return { index, symbol: symbolOf(index), share, width: Math.round(minWidth + spare * share) };
  });
}
