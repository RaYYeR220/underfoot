import { unstable_cache } from "next/cache";

import { ADDRESSES } from "@/lib/config";
import { SOURCE_LABEL, buildLedger } from "@/lib/ledger";
import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cached = unstable_cache(() => buildLedger(ADDRESSES), ["ledger"], { revalidate: 120, tags: ["ledger"] });

/** Every $WIF burned on Robinhood Chain, by where it came from. */
export async function GET() {
  try {
    const ledger = await cached();
    return jsonResponse({ ...ledger, labels: SOURCE_LABEL }, { maxAge: 30 });
  } catch (e) {
    console.error("ledger", e);
    return jsonResponse({ error: "chain read failed" }, { status: 502 });
  }
}
