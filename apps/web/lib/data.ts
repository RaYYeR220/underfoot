import "server-only";

import { getSnapshot, type FloorSnapshot } from "@underfoot/sdk";
import { unstable_cache } from "next/cache";

import { ADDRESSES } from "./config";
import { readIntake } from "./intake";
import { SOURCE_LABEL, buildLedger } from "./ledger";
import { serverClient } from "./server";
import { toWire, type IntakeWire, type LedgerWire, type Wire } from "./wire";

/** Shared by the API routes and the pages' first paint, so both hit the same cache entry. */
export const cachedSnapshot = unstable_cache(
  async (): Promise<Wire<FloorSnapshot> | null> => {
    if (!ADDRESSES) return null;
    // bigints don't survive the data cache; store them as strings
    return toWire(await getSnapshot(serverClient, ADDRESSES));
  },
  ["snapshot"],
  { revalidate: 15, tags: ["snapshot"] },
);

export const cachedLedger = unstable_cache(
  async (): Promise<LedgerWire> => ({ ...(await buildLedger(ADDRESSES)), labels: SOURCE_LABEL }),
  ["ledger"],
  { revalidate: 120, tags: ["ledger"] },
);

export const cachedIntake = unstable_cache(
  async (): Promise<IntakeWire | null> => (ADDRESSES ? readIntake(ADDRESSES) : null),
  ["intake"],
  { revalidate: 15, tags: ["snapshot"] },
);

/** First paint never fails on a slow or flaky RPC: the client retries on its own. */
export async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error("first paint", e);
    return null;
  }
}
