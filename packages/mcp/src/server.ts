import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BASKET,
  EXPLORER,
  MAINNET,
  coverage,
  fundEthCall,
  fundTokenCalls,
  getSnapshot,
  quoteRedeem,
  redeemCalls,
  robinhood,
  voteCalls,
  type Addresses,
  type Call,
} from "@underfoot/sdk";
import { createPublicClient, formatEther, formatUnits, http, isAddress, parseEther, type PublicClient } from "viem";
import { z } from "zod";

export interface ServerOptions {
  rpcUrl?: string;
  addresses?: Addresses;
}

const usd = (v: bigint, decimals = 18) => Number(formatUnits(v, decimals));
const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) }],
});
const unsigned = (calls: Call[], note: string) =>
  json({
    chainId: robinhood.id,
    note,
    calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value.toString() })),
  });

const optionOf = (symbolOrIndex: string): number => {
  const byIndex = Number(symbolOrIndex);
  if (Number.isInteger(byIndex)) return byIndex;
  const a = BASKET.find((x) => x.symbol.toLowerCase() === symbolOrIndex.toLowerCase());
  if (!a) throw new Error(`unknown asset ${symbolOrIndex}; options: ${BASKET.filter((x) => !x.cashLeg).map((x) => x.symbol).join(", ")}`);
  return a.index;
};

/**
 * An MCP server that can read the floor and build calls, but never signs or sends anything:
 * every action tool returns unsigned calls for the user's own wallet to review and sign.
 */
export function createServer(opts: ServerOptions = {}): McpServer {
  const addresses = opts.addresses ?? MAINNET;
  const client = createPublicClient({ chain: robinhood, transport: http(opts.rpcUrl) }) as PublicClient;
  const need = (): Addresses => {
    if (!addresses) throw new Error("Underfoot addresses are not configured");
    return addresses;
  };

  const server = new McpServer({ name: "underfoot", version: "0.1.0" });

  server.registerTool(
    "floor_snapshot",
    {
      title: "Floor snapshot",
      description:
        "What is under $WIF right now: every Stock Token in the floor with balance, Chainlink price and USD value, total backing, backing per WIF, the WIF spot price, coverage, and today's vote.",
      inputSchema: {},
    },
    async () => {
      const s = await getSnapshot(client, need());
      return json({
        asOf: new Date(s.timestamp * 1000).toISOString(),
        circulatingWif: Number(formatEther(s.circulating)),
        floorUsd: usd(s.navUsd),
        backingPerWifUsd: usd(s.backingPerWifUsd),
        wifPriceUsd: usd(s.wifPriceUsd),
        coverage: coverage(s),
        buyingNow: BASKET[s.target]?.symbol,
        leadingTomorrow: BASKET[s.leader]?.symbol,
        epochEndsAt: new Date(s.epochEnd * 1000).toISOString(),
        wifBurnedThisEpoch: Number(formatEther(s.epochBurned)),
        pendingEth: Number(formatEther(s.pendingEth)),
        pendingUsdg: Number(formatUnits(s.pendingUsdg, 6)),
        assets: s.assets.map((a) => ({
          symbol: a.symbol,
          token: a.token,
          units: Number(formatEther(a.balance)),
          priceUsd: Number(formatUnits(a.price, 8)),
          valueUsd: usd(a.valueUsd),
          feedStale: a.stale,
          paused: a.paused,
          votesThisEpoch: Number(formatEther(a.tally)),
        })),
        explorer: `${EXPLORER}/address/${need().floor}`,
      });
    },
  );

  server.registerTool(
    "quote_redeem",
    {
      title: "Quote a redemption",
      description: "What burning a given amount of WIF would pay out of the floor right now, per Stock Token (1% exit fee already taken).",
      inputSchema: { wif: z.string().describe("WIF to burn, in whole tokens, e.g. \"250000\"") },
    },
    async ({ wif }) => {
      const out = await quoteRedeem(client, need(), parseEther(wif));
      return json(
        out.map((v, i) => ({ symbol: BASKET[i]?.symbol, units: Number(formatEther(v)) })).filter((x) => x.units > 0),
      );
    },
  );

  server.registerTool(
    "build_redeem",
    {
      title: "Build a redemption",
      description: "Unsigned calls that approve and burn WIF for its slice of the floor. Nothing is sent; the user signs in their own wallet.",
      inputSchema: {
        wif: z.string().describe("WIF to burn, in whole tokens"),
        to: z.string().describe("Address that receives the Stock Tokens"),
      },
    },
    async ({ wif, to }) => {
      if (!isAddress(to)) throw new Error("to must be an address");
      return unsigned(redeemCalls(need(), { amount: parseEther(wif), to }), "approve WIF, then redeem; run in order or batch");
    },
  );

  server.registerTool(
    "build_vote",
    {
      title: "Build a vote",
      description:
        "Unsigned calls that burn WIF as a vote for which Stock Token the floor buys tomorrow. The burn itself also raises every holder's backing.",
      inputSchema: {
        asset: z.string().describe("Symbol (SPY, QQQ, NVDA, TSLA, AAPL, MSFT, GOOGL, AMZN, META) or basket index 1-9"),
        wif: z.string().describe("WIF to burn, at least 1"),
      },
    },
    async ({ asset, wif }) => unsigned(voteCalls(need(), { option: optionOf(asset), amount: parseEther(wif) }), "approve WIF, then vote"),
  );

  server.registerTool(
    "build_fund",
    {
      title: "Build a contribution",
      description:
        "Unsigned call(s) that send ETH, or an ERC-20 (WIF, USDG, WETH, a basket Stock Token), to the floor's intake. WIF is burned on arrival; ETH/USDG buy Stock Tokens.",
      inputSchema: {
        eth: z.string().optional().describe("ETH to send, e.g. \"0.01\""),
        token: z.string().optional().describe("ERC-20 address instead of ETH"),
        amount: z.string().optional().describe("Raw token amount (smallest units) when token is set"),
      },
    },
    async ({ eth, token, amount }) => {
      if (token) {
        if (!isAddress(token) || !amount) throw new Error("token needs an address and a raw amount");
        return unsigned(fundTokenCalls(need(), token, BigInt(amount)), "approve, then fundToken");
      }
      if (!eth) throw new Error("set eth, or token + amount");
      return unsigned([fundEthCall(need(), parseEther(eth))], "send ETH to the intake");
    },
  );

  server.registerResource(
    "how-it-works",
    "underfoot://how-it-works",
    { title: "How the floor works", mimeType: "text/markdown" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: [
            "# Underfoot",
            "A contract with no owner holds a fixed basket of Stock Tokens on Robinhood Chain.",
            "- Burn WIF to take your pro-rata slice of every asset, in kind. 1% stays behind.",
            "- Backing per circulating WIF can only go up; any WIF burned anywhere raises it.",
            "- Inflows: anyone can send ETH/USDG/WIF/Stock Tokens to the intake; a WIF/SPY Uniswap v4 pool sends 0.5% of every swap.",
            "- Buys: 20% to SGOV (the cash leg), 80% to yesterday's vote winner, priced against Chainlink with a 2% band; refused when markets are closed.",
          ].join("\n"),
        },
      ],
    }),
  );

  return server;
}
