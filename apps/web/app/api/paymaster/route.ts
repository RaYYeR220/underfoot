import type { Address, Hex } from "viem";
import type { RpcUserOperation } from "viem/account-abstraction";

import { allow, clientIp } from "@/lib/ratelimit";
import { jsonResponse, rpcError } from "@/lib/server";
import { SponsorRefusal, finalData, stubData } from "@/lib/sponsor";

export const dynamic = "force-dynamic";

/**
 * ERC-7677 paymaster web service. Wallets that support EIP-5792 `paymasterService`, and our own
 * 7702 flow, call this to get gas sponsored for floor actions. It signs only what the on-chain
 * paymaster would accept anyway; the contract re-checks everything.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!allow(`paymaster:${ip}`, 30, 60_000)) return rpcError(null, -32005, "rate limited");
  let body: { id?: unknown; method?: string; params?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const { id, method, params } = body;
  if (!Array.isArray(params) || params.length < 3) return rpcError(id, -32602, "expected [userOp, entryPoint, chainId, context]");
  const [op, entryPoint, chainId] = params as [RpcUserOperation<"0.8">, Address, Hex];

  try {
    if (method === "pm_getPaymasterStubData") {
      return jsonResponse({ jsonrpc: "2.0", id, result: await stubData(op, entryPoint, chainId) });
    }
    if (method === "pm_getPaymasterData") {
      return jsonResponse({ jsonrpc: "2.0", id, result: await finalData(op, entryPoint, chainId, ip) });
    }
    return rpcError(id, -32601, `method ${method} not supported`);
  } catch (e) {
    if (e instanceof SponsorRefusal) return rpcError(id, -32001, e.message);
    console.error("paymaster", e);
    return rpcError(id, -32603, "sponsorship failed");
  }
}
