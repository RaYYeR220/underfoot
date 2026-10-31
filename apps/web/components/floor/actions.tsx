"use client";

import type { FloorSnapshot } from "@underfoot/sdk";
import { useRef, useState, type KeyboardEvent } from "react";

import type { IntakeWire } from "@/lib/wire";

import { BuyPanel } from "./buy-panel";
import { FundPanel } from "./fund-panel";
import { RedeemPanel } from "./redeem-panel";
import { VotePanel } from "./vote-panel";

const TABS = [
  { id: "redeem", label: "Redeem" },
  { id: "vote", label: "Vote" },
  { id: "fund", label: "Fund" },
  { id: "buy", label: "Buy now" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Actions({ s, intake }: { s: FloorSnapshot; intake: IntakeWire | undefined }) {
  const [tab, setTab] = useState<TabId>("redeem");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // roving focus, as in the WAI-ARIA tabs pattern
  function onKey(e: KeyboardEvent, i: number) {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = (next + TABS.length) % TABS.length;
    setTab(TABS[j]!.id);
    refs.current[j]?.focus();
  }

  return (
    <section aria-labelledby="act" className="rounded-[28px] border border-rule-strong bg-umber-0/70 p-5 md:p-7">
      <h2 id="act" className="sr-only">
        Act on the floor
      </h2>
      <div role="tablist" aria-label="Floor actions" className="flex gap-1 overflow-x-auto border-b border-rule pb-4">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className="shrink-0 rounded-full px-4 py-2 text-[15px] text-bone-2 transition-colors hover:text-bone aria-selected:bg-bone aria-selected:text-umber-1"
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div
          key={t.id}
          id={`panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.id}`}
          hidden={tab !== t.id}
          tabIndex={0}
          className="pt-5 focus-visible:outline-none"
        >
          {tab === t.id &&
            (t.id === "redeem" ? (
              <RedeemPanel s={s} />
            ) : t.id === "vote" ? (
              <VotePanel s={s} />
            ) : t.id === "fund" ? (
              <FundPanel s={s} />
            ) : (
              <BuyPanel s={s} intake={intake} />
            ))}
        </div>
      ))}
    </section>
  );
}
