import { MAINNET, robinhood, type Addresses } from "@underfoot/sdk";

function parseAddresses(): Addresses | undefined {
  const raw = process.env.NEXT_PUBLIC_UNDERFOOT_ADDRESSES;
  if (raw) {
    try {
      return JSON.parse(raw) as Addresses;
    } catch {
      throw new Error("NEXT_PUBLIC_UNDERFOOT_ADDRESSES is not valid JSON");
    }
  }
  return MAINNET;
}

export const ADDRESSES = parseAddresses();
export const CHAIN = robinhood;
export const PUBLIC_RPC = process.env.NEXT_PUBLIC_RPC_URL || robinhood.rpcUrls.default.http[0];
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** The block $WIF was minted in; the burn ledger starts here. */
export const WIF_GENESIS_BLOCK = 29_235_958n;

export function requireAddresses(): Addresses {
  if (!ADDRESSES) throw new Error("Underfoot is not deployed in this environment");
  return ADDRESSES;
}
