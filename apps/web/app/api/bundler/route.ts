import { rpcError } from "@/lib/server";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus",
]);

/** Forwards ERC-4337 bundler calls so the bundler key stays on the server. */
export async function POST(req: Request) {
  const url = process.env.BUNDLER_URL;
  if (!url) return rpcError(null, -32603, "bundler is not configured");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const calls = Array.isArray(body) ? body : [body];
  for (const c of calls as { id?: unknown; method?: string }[]) {
    if (!c?.method || !ALLOWED.has(c.method)) return rpcError(c?.id, -32601, `method ${c?.method} not allowed`);
  }

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
}
