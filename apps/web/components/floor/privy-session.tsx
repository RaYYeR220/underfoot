"use client";

import {
  PrivyProvider,
  toViemAccount,
  usePrivy,
  useSign7702Authorization,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { SIMPLE_7702_ACCOUNT, type Call } from "@underfoot/sdk";
import { useEffect, useMemo, useRef } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  hexToBigInt,
  http,
  type Hex,
  type PrivateKeyAccount,
  type SignedAuthorization,
} from "viem";
import { createBundlerClient, createPaymasterClient, toSimple7702SmartAccount } from "viem/account-abstraction";

import { CHAIN, PRIVY_APP_ID, PUBLIC_RPC } from "@/lib/config";

import type { EmailSession, EmailWallet } from "./email-session";

const client = createPublicClient({ chain: CHAIN, transport: http(PUBLIC_RPC) });
const DELEGATED = `0xef0100${SIMPLE_7702_ACCOUNT.slice(2).toLowerCase()}`;

type SignAuthorization = ReturnType<typeof useSign7702Authorization>["signAuthorization"];

/** Pimlico wants its own gas price; fall back to the chain's estimate when it isn't there. */
async function bundlerFees(bundler: { request: (a: { method: string }) => Promise<unknown> }) {
  try {
    const r = (await bundler.request({ method: "pimlico_getUserOperationGasPrice" })) as {
      fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
    };
    return { maxFeePerGas: hexToBigInt(r.fast.maxFeePerGas), maxPriorityFeePerGas: hexToBigInt(r.fast.maxPriorityFeePerGas) };
  } catch {
    return client.estimateFeesPerGas();
  }
}

function embeddedWallet(wallet: ConnectedWallet, signAuthorization: SignAuthorization): EmailWallet {
  const address = wallet.address as `0x${string}`;
  return {
    address,

    async sendSponsored(calls: Call[]) {
      // the embedded key signs; the 7702 account it delegates to executes the calls
      const owner = await toViemAccount({ wallet });
      const account = await toSimple7702SmartAccount({ client, owner: owner as unknown as PrivateKeyAccount });
      const origin = window.location.origin;
      const bundler = createBundlerClient({
        account,
        client,
        transport: http(`${origin}/api/bundler`),
        paymaster: createPaymasterClient({ transport: http(`${origin}/api/paymaster`) }),
        userOperation: { estimateFeesPerGas: ({ bundlerClient }) => bundlerFees(bundlerClient as never) },
      });

      const code = await client.getCode({ address });
      let authorization: SignedAuthorization | undefined;
      if (code?.toLowerCase() !== DELEGATED) {
        const nonce = await client.getTransactionCount({ address, blockTag: "pending" });
        const signed = await signAuthorization({ contractAddress: SIMPLE_7702_ACCOUNT, chainId: CHAIN.id, nonce });
        authorization = { ...signed, address: SIMPLE_7702_ACCOUNT } as SignedAuthorization;
      }

      const hash = await bundler.sendUserOperation({ calls, authorization });
      const { receipt, success } = await bundler.waitForUserOperationReceipt({ hash });
      if (!success) throw new Error("The operation reverted on-chain.");
      return receipt.transactionHash;
    },

    async sendTransactions(calls: Call[]) {
      await wallet.switchChain(CHAIN.id);
      const wc = createWalletClient({ account: address, chain: CHAIN, transport: custom(await wallet.getEthereumProvider()) });
      let last: Hex | undefined;
      for (const c of calls) {
        last = await wc.sendTransaction(c);
        const r = await client.waitForTransactionReceipt({ hash: last });
        if (r.status !== "success") throw new Error("The transaction reverted.");
      }
      return last!;
    },
  };
}

function Bridge({ onChange }: { onChange: (s: EmailSession) => void }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  // Privy hands out new wallet objects on re-render; key on the address and read the latest object
  const latest = useRef({ embedded, signAuthorization });
  useEffect(() => {
    latest.current = { embedded, signAuthorization };
  });
  const address = authenticated ? embedded?.address : undefined;

  const wallet = useMemo<EmailWallet | null>(() => {
    if (!address) return null;
    return {
      address: address as `0x${string}`,
      sendSponsored: (calls) => embeddedWallet(latest.current.embedded!, latest.current.signAuthorization).sendSponsored(calls),
      sendTransactions: (calls) =>
        embeddedWallet(latest.current.embedded!, latest.current.signAuthorization).sendTransactions(calls),
    };
  }, [address]);

  useEffect(() => {
    onChange({ ready, wallet, login: () => login(), logout });
  }, [ready, wallet, login, logout, onChange]);
  return null;
}

export default function PrivySession({ onChange }: { onChange: (s: EmailSession) => void }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email"],
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
        appearance: { theme: "#17120d", accentColor: "#efe6d6", landingHeader: "Sign in to Underfoot" },
      }}
    >
      <Bridge onChange={onChange} />
    </PrivyProvider>
  );
}
