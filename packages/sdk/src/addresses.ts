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

/** Chain block the deployment landed in; event scans start here. */
export const MAINNET_DEPLOY_BLOCK: bigint | undefined = undefined;
