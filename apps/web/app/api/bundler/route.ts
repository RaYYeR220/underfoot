import { ENTRY_POINT_V08 } from "@underfoot/sdk";
import { isAddress, isAddressEqual } from "viem";

import { ADDRESSES } from "@/lib/config";
import { allow, clientIp } from "@/lib/ratelimit";
import { rpcError } from "@/lib/server";

export const dynamic = "force-dynamic";

const READS = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus",
]);
/** Only operations that our paymaster sponsors may be estimated or sent through our key. */
const OPS = new Set(["eth_estimateUserOperationGas", "eth_sendUserOperation"]);
const MAX_BATCH = 4;

type RpcCall = { id?: unknown; method?: string; params?: unknown[] };

function sponsoredByUs(c: RpcCall): boolean {
  const [op, entryPoint] = (c.params ?? []) as [{ paymaster?: string } | undefined, string | undefined];
  if (!ADDRESSES || !op?.paymaster || !entryPoint || !isAddress(op.paymaster) || !isAddress(entryPoint)) return false;
  return isAddressEqual(op.paymaster, ADDRESSES.paymaster) && isAddressEqual(entryPoint, ENTRY_POINT_V08);
}

/** Forwards ERC-4337 bundler calls for floor actions so the bundler key stays on the server. */
export async function POST(req: Request) {
  const url = process.env.BUNDLER_URL;
  if (!url) return rpcError(null, -32603, "bundler is not configured");
  if (!allow(`bundler:${clientIp(req)}`, 60, 60_000)) return rpcError(null, -32005, "rate limited");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const calls = (Array.isArray(body) ? body : [body]) as RpcCall[];
  if (calls.length === 0 || calls.length > MAX_BATCH) return rpcError(null, -32600, "batch too large");
  for (const c of calls) {
    const m = c?.method ?? "";
    if (READS.has(m)) continue;
    if (OPS.has(m) && sponsoredByUs(c)) continue;
    return rpcError(c?.id, -32601, `method ${m} not allowed here`);
  }

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
}
