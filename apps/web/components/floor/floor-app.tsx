"use client";

import type { FloorSnapshot } from "@underfoot/sdk";

import { useIntake, useLedger, useSnapshot } from "@/components/live-data";
import type { IntakeWire, LedgerWire, Wire } from "@/lib/wire";

import { Actions } from "./actions";
import { Basket } from "./basket";
import { Enforcement } from "./enforcement";
import { Ledger } from "./ledger";
import { Stats } from "./stats";

export function FloorApp(props: {
  snapshot: Wire<FloorSnapshot> | null;
  ledger: LedgerWire | null;
  intake: IntakeWire | null;
}) {
  const snapshot = useSnapshot(props.snapshot);
  const ledger = useLedger(props.ledger);
  const intake = useIntake(props.intake);
  const s = snapshot.data;

  return (
    <main className="relative z-[3] px-4 pb-24 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="pb-10 pt-6 md:pt-10">
          <p className="kicker reveal">Floor UF-01 · Robinhood Chain · live</p>
          <h1 className="display reveal mt-4 text-[clamp(40px,5.4vw,76px)] leading-[0.98]" style={{ ["--d" as string]: ".06s" }}>
            The floor, <span className="text-bone-2">as it stands.</span>
          </h1>
        </div>

        {!s ? (
          <div className="border-y border-rule py-16 text-center" role="status">
            <p className="display text-3xl">{snapshot.error ? "Can't reach the floor right now." : "Reading the floor…"}</p>
            <p className="mt-3 text-sm text-bone-2">
              {snapshot.error ? "The chain read failed. This page keeps retrying every 15 seconds." : "One read from the lens contract."}
            </p>
          </div>
        ) : (
          <div className="space-y-20 md:space-y-28">
            <Stats s={s} ledger={ledger.data} />
            <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-7">
                <Basket s={s} />
              </div>
              <div className="lg:col-span-5">
                <div className="lg:sticky lg:top-6">
                  <Actions s={s} intake={intake.data} />
                </div>
              </div>
            </div>
            <Enforcement intake={intake.data} error={!!intake.error} />
            <Ledger ledger={ledger.data} error={!!ledger.error} />
          </div>
        )}
      </div>
    </main>
  );
}
