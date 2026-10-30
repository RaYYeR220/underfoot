import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * QuickNode Streams destination. The stream filters $WIF transfers to the zero and dead addresses
 * plus Underfoot's own events; each delivery refreshes the burn ledger and the floor snapshot so
 * the app shows a burn seconds after it lands.
 *
 * Deliveries are authenticated with the stream's security token:
 *   x-qn-signature = hex(HMAC-SHA256(token, nonce + timestamp + body))
 */
export async function POST(req: Request) {
  const secret = process.env.STREAMS_SECRET;
  if (!secret) return jsonResponse({ error: "not configured" }, { status: 503 });

  const body = await req.text();
  const nonce = req.headers.get("x-qn-nonce") ?? "";
  const timestamp = req.headers.get("x-qn-timestamp") ?? "";
  const signature = req.headers.get("x-qn-signature") ?? "";

  const expected = createHmac("sha256", secret).update(nonce + timestamp + body).digest("hex");
  const ok =
    signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) return jsonResponse({ error: "bad signature" }, { status: 401 });

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 600) return jsonResponse({ error: "stale delivery" }, { status: 401 });

  revalidateTag("ledger", { expire: 0 });
  revalidateTag("snapshot", { expire: 0 });
  return jsonResponse({ ok: true });
}
