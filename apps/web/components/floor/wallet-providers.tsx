"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { PRIVY_APP_ID } from "@/lib/config";
import { wagmiConfig } from "@/lib/wagmi";

import { EmailSessionContext, type EmailSession } from "./email-session";

// Privy is only downloaded when email sign-in is configured
const PrivySession = PRIVY_APP_ID ? dynamic(() => import("./privy-session"), { ssr: false }) : null;

export function WalletProviders({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<EmailSession | null>(null);
  return (
    <WagmiProvider config={wagmiConfig}>
      <EmailSessionContext.Provider value={email}>{children}</EmailSessionContext.Provider>
      {PrivySession && <PrivySession onChange={setEmail} />}
    </WagmiProvider>
  );
}
