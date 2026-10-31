import "server-only";

import { createPublicClient, http, type PublicClient } from "viem";

import { CHAIN, PUBLIC_RPC } from "./config";

const main = http(process.env.RPC_URL || PUBLIC_RPC, { batch: true, retryCount: 6, retryDelay: 800 });
// the private endpoint's plan caps eth_getLogs ranges; long log scans go to an RPC without that cap
const logs = http(process.env.LOGS_RPC_URL || PUBLIC_RPC, { retryCount: 6, retryDelay: 800 });

/** Server-side reads go through the private RPC when one is configured. */
export const serverClient = createPublicClient({
  chain: CHAIN,
  transport: (opts) => {
    const m = main(opts);
    const l = logs(opts);
    return { ...m, request: ((args) => (args.method === "eth_getLogs" ? l.request(args) : m.request(args))) as typeof m.request };
  },
}) as PublicClient;

/** JSON with bigints as decimal strings. */
export function jsonResponse(body: unknown, init?: ResponseInit & { maxAge?: number }) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (init?.maxAge !== undefined) {
    headers.set("cache-control", `public, s-maxage=${init.maxAge}, stale-while-revalidate=${init.maxAge * 4}`);
  }
  return new Response(
    JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    { ...init, headers },
  );
}

export function rpcError(id: unknown, code: number, message: string) {
  return jsonResponse({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
