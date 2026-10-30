import type { Address } from "viem";

export interface Addresses {
  floor: Address;
  ballot: Address;
  intake: Address;
  hook: Address;
  paymaster: Address;
  lens: Address;
}

/** Robinhood Chain mainnet deployment. Written by scripts/sync-deployment.mjs. */
export const MAINNET: Addresses | undefined = undefined;
