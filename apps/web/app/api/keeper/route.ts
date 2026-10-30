import { revalidateTag } from "next/cache";

import { ADDRESSES } from "@/lib/config";
import { runKeeper } from "@/lib/keeper";
import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called by the cron. Anyone can do the same on-chain: `convert` and `sweep` are permissionless. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }
  if (!ADDRESSES) return jsonResponse({ error: "not deployed" }, { status: 503 });
  try {
    const actions = await runKeeper(ADDRESSES);
    if (actions.some((a) => a.status === "sent")) {
      revalidateTag("snapshot", { expire: 0 });
      revalidateTag("ledger", { expire: 0 });
    }
    return jsonResponse({ at: new Date().toISOString(), actions });
  } catch (e) {
    console.error("keeper", e);
    return jsonResponse({ error: String(e) }, { status: 500 });
  }
}
