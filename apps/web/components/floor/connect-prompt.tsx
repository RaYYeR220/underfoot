"use client";

import { WalletButton } from "./wallet-button";

export function ConnectPrompt({ verb }: { verb: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
      <p className="text-sm text-bone-2">Connect a wallet to {verb}.</p>
      <WalletButton />
    </div>
  );
}
