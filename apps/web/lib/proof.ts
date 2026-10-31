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
  { figure: "29", label: "mainnet-fork tests", note: "every route, refusals, redeem, pool hook, gasless ops" },
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
  { label: "Deploy the floor (no owner)", hash: "0x54f6cdb7ba42e5f414d92ec93cbbd05ecc038fc99da97b69a395d10956f08971" },
  { label: "Deploy the intake", hash: "0x4c051ea75e14a309088a8dfe202c337d6b13afcbfb5bbf36971a5d76e080c182" },
  { label: "Open the WIF/SPY pool behind the hook", hash: "0xf5f3697aeaf893aa7eb0fce25758a78515e88511a8d848a7f941640a7fe33da4" },
  {
    label: "First buy: SGOV leg skipped (feed stale), all into SPY",
    hash: "0xc7c4e2e7f327bb23be8308a43c1ec7c385c59854f903e7e7c44755cc7bb34a1e",
    note: "LegSkipped(0, FeedUnusable) + Converted",
  },
  { label: "Vote for NVDA (5 WIF burned)", hash: "0x4ecffbe543368dd1fd226b2e4e4982ae1aa1379a8fd923ea8fddf51467bb59d5" },
  {
    label: "Gasless vote from an account with 0 ETH (100 WIF burned)",
    hash: "0x9aaba2e91e357f2b29e6042c7c1e73e91fb8d484ef4f229e219279c26c6b2cfd",
    note: "EIP-7702 + ERC-4337 v0.8, gas paid by the paymaster",
  },
  { label: "Sell WIF in the hook pool: 0.5% in SPY lands in the floor", hash: "0xd168979e4622db8f6499d2557d81f08767a2f37980108ae9797c6e76fe4fb444" },
  { label: "Buy WIF in the hook pool: 0.5% in WIF is burned", hash: "0x9010b64bca96f1df573c4ae1a758280fba5490a46b3a3ec05bd2f1503e3713be" },
  { label: "WIF sent to the intake, burned on arrival", hash: "0xfa74371e97a4530b3f42342e145a148394a6861007b1b7eb7e06bf260cebd286" },
  { label: "Redemption in kind (10 WIF burned, SPY out)", hash: "0x2406285862347a30cdccde1c0aa1f5d0f0500550d3750f1c6513cca8dccd594b" },
  { label: "Weekend buy refused (markets closed)", hash: null, note: "NothingBuyable(FeedUnusable)" },
];
