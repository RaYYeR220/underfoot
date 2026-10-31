import { ballotAbi, intakeAbi, underfootAbi } from "@underfoot/sdk";
import { BaseError, ContractFunctionRevertedError, decodeErrorResult, parseAbi, type Hex } from "viem";

import { decimal } from "./format";
import { symbolOf } from "./basket";
import { Skip } from "./wire";

export const SKIP_TEXT: Record<Skip, string> = {
  [Skip.None]: "Ready to buy",
  [Skip.Paused]: "Paused by its issuer",
  [Skip.OraclePaused]: "Price paused by its issuer",
  [Skip.FeedUnusable]: "Markets are closed — Stock Token feeds are stale; nothing will be bought until they update",
  [Skip.PoolOffPrice]: "Pool is more than 0.75% off Chainlink",
};

/** Short form for tight spots (event log, leg status). */
export const SKIP_SHORT: Record<Skip, string> = {
  [Skip.None]: "ready",
  [Skip.Paused]: "token paused",
  [Skip.OraclePaused]: "price paused",
  [Skip.FeedUnusable]: "markets closed",
  [Skip.PoolOffPrice]: "pool off-price",
};

const OTHER_ERRORS = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error Error(string)",
]);
const ABI = [...underfootAbi, ...ballotAbi, ...intakeAbi, ...OTHER_ERRORS];

function sentence(name: string, args: readonly unknown[] | undefined): string {
  const a = (args ?? []) as readonly bigint[];
  switch (name) {
    case "NothingBuyable": {
      const [target, targetReason, cashReason] = [Number(a[0]), Number(a[1]) as Skip, Number(a[2]) as Skip];
      if (targetReason === Skip.FeedUnusable && cashReason === Skip.FeedUnusable) return SKIP_TEXT[Skip.FeedUnusable];
      return `Nothing is buyable right now. ${symbolOf(target)}: ${SKIP_SHORT[targetReason]}; SGOV: ${SKIP_SHORT[cashReason]}.`;
    }
    case "WindowFull":
      return `This hour's buying cap is used up ($${decimal(a[1] ?? 0n, 8, 0)} per hour). It reopens within the hour.`;
    case "OutsideLimits":
      return "That's below the $1 minimum for a buy.";
    case "InsufficientBalance":
      return "The intake doesn't hold that much yet.";
    case "BandBreached":
      return "The trade would have come back more than 1.5% under Chainlink, so it was refused.";
    case "StaleFeed":
      return "The ETH or USDG price feed is stale, so nothing can be priced.";
    case "ZeroAmount":
      return "Enter an amount above zero.";
    case "ExceedsCirculating":
      return "That's more WIF than is in circulation.";
    case "BelowMinimum":
      return "A vote burns at least 1 WIF.";
    case "BadOption":
      return "That isn't one of the nine options.";
    case "UnsupportedToken":
      return "The intake doesn't accept that token.";
    case "ERC20InsufficientBalance":
      return "Not enough WIF in this wallet.";
    case "ERC20InsufficientAllowance":
      return "The approval didn't go through first. Try again.";
    case "Error":
      return String(args?.[0] ?? "Reverted");
    default:
      return `Refused by the contract (${name}).`;
  }
}

function revertData(e: BaseError): Hex | undefined {
  let data: Hex | undefined;
  e.walk((x) => {
    const d = (x as { data?: unknown }).data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) data = d as Hex;
    else if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string") data = (d as { data: Hex }).data;
    return false;
  });
  return data;
}

/** A failed call or transaction in plain words. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return sentence(revert.data.errorName, revert.data.args);
    }
    const data = revertData(e);
    if (data) {
      try {
        const d = decodeErrorResult({ abi: ABI, data });
        return sentence(d.errorName, d.args as readonly unknown[]);
      } catch {}
    }
    if (/user (rejected|denied)|rejected the request/i.test(e.message)) return "You cancelled it in your wallet.";
    return e.shortMessage;
  }
  if (e instanceof Error) {
    if (/user (rejected|denied)|rejected the request/i.test(e.message)) return "You cancelled it in your wallet.";
    return e.message;
  }
  return String(e);
}
