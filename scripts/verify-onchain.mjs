// Checks a live Underfoot deployment against what the README claims, straight from the chain.
//   pnpm verify:onchain            (reads contracts/deployments/4663.json)
//   ROBINHOOD_RPC_URL=... DEPLOYMENT=path/to.json pnpm verify:onchain
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASKET,
  ENTRY_POINT_V08,
  SIMPLE_7702_ACCOUNT,
  WIF,
  ballotAbi,
  hookAbi,
  intakeAbi,
  lensAbi,
  paymasterAbi,
  robinhood,
  underfootAbi,
} from "@underfoot/sdk";
import { createPublicClient, erc20Abi, formatEther, formatUnits, getAbiItem, http, isAddressEqual } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(process.env.DEPLOYMENT ?? join(root, "contracts/deployments/4663.json"), "utf8"));
const client = createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_RPC_URL) });

let failed = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${detail ? `  (${detail})` : ""}`);
};
const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });
// a check whose read fails counts as failed instead of stopping the run
const check = async (label, fn, detail) => {
  try {
    ok(label, await fn(), detail ? await detail() : "");
  } catch (e) {
    ok(label, false, (e.shortMessage ?? String(e)).split(String.fromCharCode(10))[0]);
  }
};

// Selectors an admin-controlled contract would expose. None of ours may.
const ADMIN = {
  "owner()": "8da5cb5b",
  "transferOwnership(address)": "f2fde38b",
  "renounceOwnership()": "715018a6",
  "upgradeTo(address)": "3659cfe6",
  "upgradeToAndCall(address,bytes)": "4f1ef286",
  "pause()": "8456cb59",
  "unpause()": "3f4ba83a",
  "withdraw(uint256)": "2e1a7d4d",
  "withdrawTo(address,uint256)": "205c2878",
  "unlockStake()": "bb9fe6bf",
  "withdrawStake(address)": "c23a5cea",
};

console.log(`Underfoot on ${robinhood.name} (${robinhood.id}), block ${await client.getBlockNumber()}\n`);

console.log("Code and ownership");
for (const name of ["floor", "ballot", "intake", "hook", "paymaster", "lens"]) {
  const code = (await client.getCode({ address: d[name] })) ?? "0x";
  ok(`${name} ${d[name]} has code`, code.length > 2, `${(code.length - 2) / 2} bytes`);
  // a PUSH4 of the selector would appear in the dispatcher
  const found = Object.entries(ADMIN).filter(([, s]) => code.toLowerCase().includes(`63${s}`));
  ok(`${name} exposes no admin functions`, found.length === 0, found.map(([f]) => f).join(", "));
}

console.log("\nFloor");
const assets = await read(d.floor, underfootAbi, "assets");
ok("basket is the documented 10 Stock Tokens, cash leg first", assets.length === BASKET.length && assets.every((a, i) => isAddressEqual(a, BASKET[i].token)));
await check("exit fee is 1%", async () => (await read(d.floor, underfootAbi, "EXIT_FEE_BPS")) === 100n);
await check("burns $WIF", async () => isAddressEqual(await read(d.floor, underfootAbi, "WIF"), WIF));

console.log("\nBallot");
await check("wired to the floor", async () => isAddressEqual(await read(d.ballot, ballotAbi, "FLOOR"), d.floor));
await check("epochs start at 00:00 UTC", async () => (await read(d.ballot, ballotAbi, "GENESIS")) % 86400n === 0n);
await check("default buy is SPY", async () => (await read(d.ballot, ballotAbi, "DEFAULT_OPTION")) === 1n);

console.log("\nIntake");
await check("wired to floor and ballot", async () => isAddressEqual(await read(d.intake, intakeAbi, "FLOOR"), d.floor) && isAddressEqual(await read(d.intake, intakeAbi, "BALLOT"), d.ballot));
await check("20% cash leg", async () => (await read(d.intake, intakeAbi, "CASH_BPS")) === 2000n);
await check("pools must sit within 0.75% of Chainlink", async () => (await read(d.intake, intakeAbi, "SPOT_BPS")) === 75n);
await check("fills must land within 1.5% of Chainlink", async () => (await read(d.intake, intakeAbi, "BAND_BPS")) === 150n);
await check(
  "hourly conversion cap",
  async () => (await read(d.intake, intakeAbi, "MAX_USD_PER_WINDOW")) > 0n,
  async () => `$${formatUnits(await read(d.intake, intakeAbi, "MAX_USD_PER_WINDOW"), 8)} per hour`,
);

console.log("\nHook");
const flags = BigInt(d.hook) & 0x3fffn;
ok("address encodes beforeInitialize + afterSwap + afterSwapReturnDelta only", flags === 0x2044n, `0x${flags.toString(16)}`);
await check("sends fees to the floor", async () => isAddressEqual(await read(d.hook, hookAbi, "FLOOR"), d.floor));
await check("fee is 0.5% on top of a 0.3% LP fee", async () => (await read(d.hook, hookAbi, "HOOK_FEE_BPS")) === 50n && (await read(d.hook, hookAbi, "LP_FEE")) === 3000);

console.log("\nPaymaster");
await check("EntryPoint v0.8", async () => isAddressEqual(await read(d.paymaster, paymasterAbi, "ENTRY_POINT"), ENTRY_POINT_V08));
await check("only EIP-7702 accounts on the canonical Simple7702Account", async () => isAddressEqual(await read(d.paymaster, paymasterAbi, "ACCOUNT_IMPL"), SIMPLE_7702_ACCOUNT));
await check(
  "every sponsored action burns WIF",
  async () => (await read(d.paymaster, paymasterAbi, "MIN_BURN")) > 0n,
  async () => `${formatEther(await read(d.paymaster, paymasterAbi, "MIN_BURN"))} WIF minimum`,
);
await check("gas tank", async () => true, async () => `${formatEther(await read(d.paymaster, paymasterAbi, "balance"))} ETH deposited`);

console.log("\nLive state");
const s = await read(d.lens, lensAbi, "snapshot");
const floorWif = await read(WIF, erc20Abi, "balanceOf", [d.floor]);
ok("circulating = supply - dead - stuck in floor", s.circulating === s.totalSupply - s.dead - floorWif);
console.log(`    floor value         $${Number(formatEther(s.navUsd)).toFixed(2)}`);
console.log(`    backing per WIF     $${Number(formatEther(s.backingPerWifUsd)).toExponential(4)}`);
console.log(`    WIF price           $${Number(formatEther(s.wifPriceUsd)).toFixed(6)}`);
console.log(`    circulating WIF     ${Number(formatEther(s.circulating)).toLocaleString("en-US")}`);
for (const a of s.assets) {
  if (a.balance > 0n) console.log(`    ${a.symbol.padEnd(6)} ${Number(formatEther(a.balance)).toFixed(6)}  $${Number(formatEther(a.valueUsd)).toFixed(2)}${a.stale ? "  (feed stale)" : ""}`);
}

console.log("\nActivity since deploy");
const fromBlock = BigInt(d.block ?? 0);
const count = async (address, abi, name) =>
  (await client.getLogs({ address, event: getAbiItem({ abi, name }), fromBlock, toBlock: "latest" })).length;
for (const [label, address, abi, name] of [
  ["redemptions", d.floor, underfootAbi, "Redeemed"],
  ["votes", d.ballot, ballotAbi, "Voted"],
  ["buys", d.intake, intakeAbi, "Converted"],
  ["skipped legs", d.intake, intakeAbi, "LegSkipped"],
  ["pool fees", d.hook, hookAbi, "FloorFee"],
]) {
  console.log(`    ${label.padEnd(14)} ${await count(address, abi, name)}`);
}

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
