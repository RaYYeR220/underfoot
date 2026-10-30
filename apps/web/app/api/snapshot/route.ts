import { getSnapshot } from "@underfoot/sdk";
import { unstable_cache } from "next/cache";

import { ADDRESSES } from "@/lib/config";
import { jsonResponse, serverClient } from "@/lib/server";

export const dynamic = "force-dynamic";

const cached = unstable_cache(
  async () => {
    if (!ADDRESSES) return null;
    const s = await getSnapshot(serverClient, ADDRESSES);
    // bigints don't survive the data cache; store them as strings
    return JSON.parse(JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  },
  ["snapshot"],
  { revalidate: 15, tags: ["snapshot"] },
);

export async function GET() {
  if (!ADDRESSES) return jsonResponse({ error: "not deployed" }, { status: 503 });
  try {
    return jsonResponse(await cached(), { maxAge: 10 });
  } catch (e) {
    console.error("snapshot", e);
    return jsonResponse({ error: "chain read failed" }, { status: 502 });
  }
}
