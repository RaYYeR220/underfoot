import type { Metadata } from "next";

import { FloorApp } from "@/components/floor/floor-app";
import { WalletButton } from "@/components/floor/wallet-button";
import { WalletProviders } from "@/components/floor/wallet-providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cachedIntake, cachedLedger, cachedSnapshot, settle } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The floor",
  description: "Backing per WIF, the Stock Token basket, today's vote, every buy and refusal, and every WIF burned.",
};

export default async function FloorPage() {
  const [snapshot, ledger, intake] = await Promise.all([
    settle(cachedSnapshot()),
    settle(cachedLedger()),
    settle(cachedIntake()),
  ]);
  return (
    <WalletProviders>
      <SiteHeader current="/floor">
        <WalletButton />
      </SiteHeader>
      <FloorApp snapshot={snapshot} ledger={ledger} intake={intake} />
      <SiteFooter />
    </WalletProviders>
  );
}
