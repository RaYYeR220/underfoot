import { ADDRESSES } from "@/lib/config";
import { cachedSnapshot } from "@/lib/data";
import { jsonResponse } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!ADDRESSES) return jsonResponse({ error: "not deployed" }, { status: 503 });
  try {
    return jsonResponse(await cachedSnapshot(), { maxAge: 10 });
  } catch (e) {
    console.error("snapshot", e);
    return jsonResponse({ error: "chain read failed" }, { status: 502 });
  }
}
