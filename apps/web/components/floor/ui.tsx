"use client";

import { txUrl } from "@underfoot/sdk";
import { useEffect, useId, useState, type ReactNode } from "react";

import { lithology } from "@/lib/basket";
import { shortHex } from "@/lib/format";

import type { Progress } from "./use-send";

/** Seconds since epoch, ticking; null until mounted so server and client render the same. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Swatch({ index, className = "h-3.5 w-7" }: { index: number; className?: string }) {
  return <span aria-hidden className={`core inline-block align-middle ${lithology(index)} ${className}`} />;
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a className="link num" href={txUrl(hash)} target="_blank" rel="noreferrer">
      {children ?? shortHex(hash)}
    </a>
  );
}

export function SectionTitle({ id, kicker, title, children }: { id: string; kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 grid gap-3 md:grid-cols-12 md:items-end">
      <div className="md:col-span-7">
        <p className="kicker">{kicker}</p>
        <h2 id={id} className="display mt-3 text-[34px] leading-none md:text-[44px]">
          {title}
        </h2>
      </div>
      {children && <div className="text-[15px] leading-relaxed text-bone-2 md:col-span-5">{children}</div>}
    </div>
  );
}

export function AmountField({
  label,
  value,
  onChange,
  unit,
  hint,
  onMax,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  hint?: ReactNode;
  onMax?: () => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label">
          {label}
        </label>
        {hint && <span className="num text-xs text-bone-2">{hint}</span>}
      </div>
      <div className="relative mt-2">
        <input
          id={id}
          className="field pr-28"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-2">
          {onMax && (
            <button
              type="button"
              onClick={onMax}
              className="rounded-full border border-rule-strong px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-bone-2 hover:border-bone hover:text-bone"
            >
              Max
            </button>
          )}
          <span className="pr-2 font-mono text-xs text-bone-2">{unit}</span>
        </div>
      </div>
    </div>
  );
}

export function ProgressNote({ progress, onReset }: { progress: Progress; onReset: () => void }) {
  if (progress.phase === "idle") return null;
  return (
    <div role="status" aria-live="polite" className="mt-4 border-t border-rule pt-4 text-sm leading-relaxed">
      {progress.phase === "wallet" && (
        <p className="text-bone-2">
          Confirm in your wallet{progress.of > 1 ? ` (${progress.step} of ${progress.of})` : ""}…
        </p>
      )}
      {progress.phase === "mining" && (
        <p className="text-bone-2">
          Waiting for Robinhood Chain… {progress.hash && <TxLink hash={progress.hash} />}
        </p>
      )}
      {progress.phase === "done" && (
        <p className="text-bone">
          Done{progress.sponsored ? ", gas paid by the floor" : ""}. <TxLink hash={progress.hash}>View transaction ↗</TxLink>{" "}
          <button type="button" className="link text-bone-2" onClick={onReset}>
            Clear
          </button>
        </p>
      )}
      {progress.phase === "error" && (
        <p className="border-l-2 border-tag pl-3 text-bone">
          {progress.message}{" "}
          <button type="button" className="link text-bone-2" onClick={onReset}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

export function Meter({ value, max, label }: { value: bigint; max: bigint; label: string }) {
  const pct = max === 0n ? 0 : Number((value * 1000n) / max) / 10;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 overflow-hidden rounded-full border border-rule-strong"
    >
      <div className="h-full rounded-full bg-bone" style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}
