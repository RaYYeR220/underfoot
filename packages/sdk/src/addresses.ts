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
export const MAINNET: Addresses | undefined = {
  floor: "0x127946edE935cd492a35df92cB7e75668c42E326",
  ballot: "0x2fE9cf250d0a5b368f7BF6eeeA1E0923553BAEad",
  intake: "0x165EAC746bed0bB0CCFBAED05452E1a0274b4C5D",
  hook: "0x54Ead89e8aC38a818D9ffF9C6217D45A01f66044",
  paymaster: "0xDfF54b91ADF8f69D8CE13E1b2bCa8b31b36fFbc8",
  lens: "0x1032326f0A7397DBeC75A2e5Ad2B2AC1D68D0F87",
};

/** Chain block the deployment landed in; event scans start here. */
export const MAINNET_DEPLOY_BLOCK: bigint | undefined = 102641510n;
