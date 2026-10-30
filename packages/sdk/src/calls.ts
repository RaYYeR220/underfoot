import { encodeFunctionData, erc20Abi, type Address, type Hex } from "viem";

import { ballotAbi, intakeAbi, underfootAbi } from "./abi/index.js";
import type { Addresses } from "./addresses.js";
import { BASKET, MIN_VOTE, WIF } from "./constants.js";

/** One call, ready for `wallet_sendCalls`, an `executeBatch`, or a plain transaction. */
export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
}

const approve = (spender: Address, amount: bigint): Call => ({
  to: WIF,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
  value: 0n,
});

/** Approve + burn `amount` WIF for a pro-rata slice of the basket. */
export function redeemCalls(a: Addresses, args: { amount: bigint; to: Address; skipMask?: bigint }): Call[] {
  if (args.amount <= 0n) throw new Error("amount must be positive");
  return [
    approve(a.floor, args.amount),
    {
      to: a.floor,
      data: encodeFunctionData({
        abi: underfootAbi,
        functionName: "redeem",
        args: [args.amount, args.to, args.skipMask ?? 0n],
      }),
      value: 0n,
    },
  ];
}

/** Approve + burn `amount` WIF as a vote for basket asset `option` (1..9). */
export function voteCalls(a: Addresses, args: { option: number; amount: bigint }): Call[] {
  const asset = BASKET[args.option];
  if (!asset || asset.cashLeg) throw new Error(`option ${args.option} is not votable`);
  if (args.amount < MIN_VOTE) throw new Error("a vote burns at least 1 WIF");
  return [
    approve(a.ballot, args.amount),
    {
      to: a.ballot,
      data: encodeFunctionData({ abi: ballotAbi, functionName: "vote", args: [BigInt(args.option), args.amount] }),
      value: 0n,
    },
  ];
}

/** Send ETH to the floor's intake. */
export function fundEthCall(a: Addresses, wei: bigint): Call {
  return { to: a.intake, data: encodeFunctionData({ abi: intakeAbi, functionName: "fund" }), value: wei };
}

/** Send an ERC-20 (WIF, USDG, WETH or a basket Stock Token) to the intake. */
export function fundTokenCalls(a: Addresses, token: Address, amount: bigint): Call[] {
  return [
    {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.intake, amount] }),
      value: 0n,
    },
    {
      to: a.intake,
      data: encodeFunctionData({ abi: intakeAbi, functionName: "fundToken", args: [token, amount] }),
      value: 0n,
    },
  ];
}

/** Anyone can trigger a buy. It refuses on stale feeds, paused tokens, or a price outside the band. */
export function convertCall(a: Addresses, args: { fromEth: boolean; amountIn: bigint }): Call {
  return {
    to: a.intake,
    data: encodeFunctionData({ abi: intakeAbi, functionName: "convert", args: [args.fromEth, args.amountIn] }),
    value: 0n,
  };
}

/** Settle tokens sent to the intake by plain transfer: burn WIF, forward Stock Tokens. */
export function sweepCall(a: Addresses): Call {
  return { to: a.intake, data: encodeFunctionData({ abi: intakeAbi, functionName: "sweep" }), value: 0n };
}
