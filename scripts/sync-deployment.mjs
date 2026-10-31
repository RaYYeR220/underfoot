// Writes the mainnet deployment into the SDK and prints the web app's env line.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(root, "contracts/deployments/4663.json"), "utf8"));
const keys = ["floor", "ballot", "intake", "hook", "paymaster", "lens"];
const addresses = Object.fromEntries(keys.map((k) => [k, d[k]]));

writeFileSync(
  join(root, "packages/sdk/src/addresses.ts"),
  `import type { Address } from "viem";

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
${keys.map((k) => `  ${k}: "${d[k]}",`).join("\n")}
};

/** Chain block the deployment landed in; event scans start here. */
export const MAINNET_DEPLOY_BLOCK: bigint | undefined = ${d.block}n;
`,
);
console.log("packages/sdk/src/addresses.ts updated");
console.log(`NEXT_PUBLIC_UNDERFOOT_ADDRESSES=${JSON.stringify(addresses)}`);
console.log(`UNDERFOOT_DEPLOY_BLOCK=${d.block}`);
