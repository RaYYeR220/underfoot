import { cachedLedger } from "@/lib/data";
import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every $WIF burned on Robinhood Chain, by where it came from. */
export async function GET() {
  try {
    return jsonResponse(await cachedLedger(), { maxAge: 30 });
  } catch (e) {
    console.error("ledger", e);
    return jsonResponse({ error: "chain read failed" }, { status: 502 });
  }
}
