"use client";

import type { FloorSnapshot } from "@underfoot/sdk";
import Link from "next/link";

import { useLedger, useSnapshot } from "@/components/live-data";
import { amount, usd, usdPrecise } from "@/lib/format";
import type { LedgerWire, Wire } from "@/lib/wire";

export function LiveStrip({ snapshot, ledger }: { snapshot: Wire<FloorSnapshot> | null; ledger: LedgerWire | null }) {
  const s = useSnapshot(snapshot);
  const l = useLedger(ledger);
  const figures = [
    { label: "Floor value", value: s.data ? usd(s.data.navUsd) : "—" },
    { label: "Backing per WIF", value: s.data ? usdPrecise(s.data.backingPerWifUsd) : "—" },
    { label: "WIF burned, all time", value: l.data ? amount(BigInt(l.data.totalBurned)) : "—" },
  ];
  return (
    <div className="grid grid-cols-1 border-y border-rule sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
      {figures.map((f) => (
        <div key={f.label} className="border-b border-rule px-1 py-6 sm:px-6 lg:border-b-0 lg:border-r">
          <p className="label">{f.label}</p>
          <p className="num mt-3 text-2xl tracking-tight text-bone md:text-[28px]">{f.value}</p>
        </div>
      ))}
      <Link
        href="/proof"
        className="group flex flex-col justify-between px-1 py-6 transition-colors hover:bg-umber-2/60 sm:px-6"
      >
        <p className="label">Contract</p>
        <p className="mt-3 flex items-center justify-between text-lg text-bone">
          <span>No owner · verified</span>
          <span aria-hidden className="transition-transform duration-300 ease-core group-hover:translate-x-1">→</span>
        </p>
      </Link>
    </div>
  );
}
