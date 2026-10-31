import { createConfig, http, injected } from "wagmi";

import { CHAIN, PUBLIC_RPC } from "./config";

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  // EIP-6963 discovery adds each installed wallet by name; `injected` covers the rest
  connectors: [injected()],
  transports: { [CHAIN.id]: http(PUBLIC_RPC, { batch: true }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
