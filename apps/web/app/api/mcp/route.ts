import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "@underfoot/mcp";

import { ADDRESSES } from "@/lib/config";

export const dynamic = "force-dynamic";

/** The Underfoot MCP server over streamable HTTP, stateless: one server per request. */
async function handle(req: Request) {
  const server = createServer({ rpcUrl: process.env.RPC_URL || undefined, addresses: ADDRESSES });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
