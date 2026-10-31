import { ENTRY_POINT_V08, SIMPLE_7702_ACCOUNT, USDG, WIF, type Addresses } from "@underfoot/sdk";
import type { Address, Hex } from "viem";

export interface ContractNote {
  key: keyof Addresses;
  name: string;
  enforces: string;
  control: string;
}

/** What each deployed contract guarantees, in one line each. */
export const CONTRACTS: ContractNote[] = [
  {
    key: "floor",
    name: "Underfoot",
    enforces: "Holds the basket. Burn WIF, receive your pro-rata slice of every asset in kind; 1% stays in, so backing per WIF never goes down.",
    control: "No owner, no admin, no upgrade path. The basket is fixed at deploy.",
  },
  {
    key: "ballot",
    name: "Ballot",
    enforces: "Burn at least 1 WIF to vote. The leader at 00:00 UTC is what the intake buys for the next 24 hours; the running buy can't be steered.",
    control: "No owner. Epochs, options and the SPY default are immutable.",
  },
  {
    key: "intake",
    name: "Intake",
    enforces: "Burns WIF on arrival, forwards Stock Tokens, buys 20% SGOV / 80% the vote winner with ETH or USDG — only when Chainlink is fresh, every pool is within 0.75% of it, and the fill is within 1.5%. $1,000 per hour at most.",
    control: "No owner. Routes, limits and feeds are fixed at deploy; anyone can trigger a buy.",
  },
  {
    key: "hook",
    name: "WIF/SPY pool hook",
    enforces: "Uniswap v4 pool at 0.3% LP fee; another 0.5% of every swap goes to the floor (SPY side) or is burned (WIF side).",
    control: "No owner. Pinned to exactly one pool key.",
  },
  {
    key: "paymaster",
    name: "Paymaster",
    enforces: "Pays gas only for Underfoot votes and redemptions that burn at least 100 WIF, sent from a 7702 account on the standard Simple7702Account, under a cost cap.",
    control: "No owner and no withdraw: its ETH can only ever pay for floor actions.",
  },
  {
    key: "lens",
    name: "Lens",
    enforces: "One read for the whole floor: balances, Chainlink prices and staleness, backing per WIF, today's tallies.",
    control: "Holds nothing and changes nothing.",
  },
];

export const EXTERNAL: { name: string; address: Address; note: string }[] = [
  { name: "$WIF (World is Flat)", address: WIF, note: "Burned by every floor action." },
  { name: "USDG", address: USDG, note: "Accepted by the intake alongside ETH." },
  { name: "EntryPoint v0.8", address: ENTRY_POINT_V08, note: "ERC-4337 entry point for gasless actions." },
  { name: "Simple7702Account", address: SIMPLE_7702_ACCOUNT, note: "The only delegation the paymaster accepts." },
];

export const TESTS = [
  { figure: "47", label: "local tests", note: "unit, fuzz and invariant" },
  { figure: "28", label: "mainnet-fork tests", note: "every route, refusals, redeem, pool hook, gasless ops" },
  { figure: "16,384", label: "invariant calls", note: "backing per WIF never decreases" },
];

export const LIMITS = [
  "The floor is small next to WIF's market cap at launch. Backing per WIF is a floor, not a peg; it grows with inflows and burns.",
  "Stock Token issuers can pause, blocklist or seize their tokens. A paused asset is skipped on redemption (its share stays in the floor) and on buys.",
  "Stock Tokens are not offered to US persons or in restricted countries.",
  "Chainlink stock feeds update on trading days. On weekends the feeds go stale and nothing is bought until they update.",
  "Gas sponsorship can be griefed by moving WIF out between signing and inclusion; the cost is capped at one operation's gas, plus per-account limits on the server.",
];

export interface ProofTx {
  label: string;
  /** Fill in once the transaction exists on mainnet. */
  hash: Hex | null;
  note?: string;
}

/** Real transactions on Robinhood Chain mainnet. */
export const MAINNET_TXS: ProofTx[] = [
  { label: "Deploy", hash: null },
  { label: "First buy: ETH → SGOV + SPY", hash: null },
  { label: "Weekend buy refused (markets closed)", hash: null, note: "NothingBuyable(FeedUnusable)" },
  { label: "Vote (burns WIF)", hash: null },
  { label: "Redemption in kind", hash: null },
  { label: "Gasless redemption via the paymaster", hash: null },
  { label: "Swap on the WIF/SPY pool", hash: null },
];
