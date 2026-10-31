import { ADDRESSES } from "@/lib/config";
import { cachedIntake } from "@/lib/data";
import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The intake's hourly window, whether each leg could buy right now, and its recent buys and refusals. */
export async function GET() {
  if (!ADDRESSES) return jsonResponse({ error: "not deployed" }, { status: 503 });
  try {
    return jsonResponse(await cachedIntake(), { maxAge: 10 });
  } catch (e) {
    console.error("intake", e);
    return jsonResponse({ error: "chain read failed" }, { status: 502 });
  }
}
