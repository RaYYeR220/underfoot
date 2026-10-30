#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const server = createServer({ rpcUrl: process.env.ROBINHOOD_RPC_URL });
await server.connect(new StdioServerTransport());
