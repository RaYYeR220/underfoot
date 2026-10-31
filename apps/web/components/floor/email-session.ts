"use client";

import type { Call } from "@underfoot/sdk";
import { createContext, useContext } from "react";
import type { Address, Hex } from "viem";

export interface EmailWallet {
  address: Address;
  /** Gas paid by the floor's paymaster. Only votes and redemptions that burn at least 100 WIF qualify. */
  sendSponsored(calls: Call[]): Promise<Hex>;
  /** Ordinary transactions from the embedded wallet, which then needs its own ETH for gas. */
  sendTransactions(calls: Call[]): Promise<Hex>;
}

export interface EmailSession {
  ready: boolean;
  wallet: EmailWallet | null;
  login(): void;
  logout(): Promise<void>;
}

/** Null when email sign-in isn't configured for this deployment. */
export const EmailSessionContext = createContext<EmailSession | null>(null);

export const useEmailSession = () => useContext(EmailSessionContext);
