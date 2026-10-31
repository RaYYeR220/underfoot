"use client";

import type { FloorSnapshot } from "@underfoot/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { fromWireSnapshot, type IntakeWire, type LedgerWire, type Wire } from "@/lib/wire";

export const POLL_MS = 15_000;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const snapshotKey = ["snapshot"] as const;

/**
 * The floor, polled. A read we made straight from the chain after a transaction can be newer than
 * the server's cached copy, so an older poll never replaces it.
 */
export function useSnapshot(initial: Wire<FloorSnapshot> | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: snapshotKey,
    queryFn: async () => {
      const next = await getJson<Wire<FloorSnapshot>>("/api/snapshot");
      const prev = qc.getQueryData<Wire<FloorSnapshot>>(snapshotKey);
      return prev && prev.timestamp > next.timestamp ? prev : next;
    },
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    refetchInterval: POLL_MS,
  });
  const data = useMemo(() => (q.data ? fromWireSnapshot(q.data) : null), [q.data]);
  return { data, error: q.error, isLoading: q.isLoading };
}

export function useLedger(initial: LedgerWire | null) {
  return useQuery({
    queryKey: ["ledger"],
    queryFn: () => getJson<LedgerWire>("/api/ledger"),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    refetchInterval: POLL_MS,
  });
}

export function useIntake(initial: IntakeWire | null) {
  return useQuery({
    queryKey: ["intake"],
    queryFn: () => getJson<IntakeWire>("/api/intake"),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial ? Date.now() : undefined,
    refetchInterval: POLL_MS,
  });
}
