"use client";

import { WIF } from "@underfoot/sdk";
import { useEffect, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useConnect, useConnection, useConnectors, useDisconnect, useReadContract, useSwitchChain } from "wagmi";

import { CHAIN } from "@/lib/config";
import { amount, shortHex } from "@/lib/format";

import { useEmailSession } from "./email-session";
import { useActor, useWrongChain } from "./use-send";

export function useWifBalance(address: `0x${string}` | undefined) {
  return useReadContract({
    address: WIF,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN.id,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function WalletButton() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const actor = useActor();
  const email = useEmailSession();
  const wrongChain = useWrongChain();
  const { connector } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const balance = useWifBalance(actor?.address);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // close once someone connects, not on every render while connected
  const connected = actor?.address;
  useEffect(() => {
    if (connected) setOpen(false);
  }, [connected]);

  // named wallets found through EIP-6963 make the generic injected entry redundant
  const named = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const list = named.length > 0 ? named : connectors.filter((c) => c.id === "injected");

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-line whitespace-nowrap px-3.5 py-2.5 font-mono text-xs tracking-[0.04em] md:px-4"
      >
        {actor ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${wrongChain ? "bg-tag" : "bg-[#67806a]"}`} aria-hidden />
            {shortHex(actor.address)}
          </>
        ) : (
          "Connect"
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={actor ? "Account" : "Connect"}
          className="absolute right-0 top-full z-50 mt-2 w-[min(320px,calc(100vw-32px))] rounded-[20px] border border-rule-strong bg-umber-0 p-4 text-left"
        >
          {actor ? (
            <div className="space-y-4">
              <div>
                <p className="label">{actor.kind === "email" ? "Email account" : (connector?.name ?? "Wallet")}</p>
                <p className="num mt-2 break-all text-sm">{actor.address}</p>
              </div>
              <div>
                <p className="label">WIF balance</p>
                <p className="num mt-2 text-sm">{balance.data !== undefined ? `${amount(balance.data)} WIF` : "…"}</p>
              </div>
              {wrongChain && (
                <button type="button" className="btn btn-solid w-full" onClick={() => switchChain.mutate({ chainId: CHAIN.id })}>
                  Switch to Robinhood Chain
                </button>
              )}
              <button
                type="button"
                className="btn btn-line w-full"
                onClick={() => (actor.kind === "email" ? email?.logout() : disconnect.mutate())}
              >
                {actor.kind === "email" ? "Sign out" : "Disconnect"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  disabled={connect.isPending}
                  onClick={() => connect.mutate({ connector: c, chainId: CHAIN.id })}
                  className="btn btn-line w-full justify-between"
                >
                  {c.id === "injected" ? "Browser wallet" : c.name}
                  <span aria-hidden>→</span>
                </button>
              ))}
              {email && (
                <button
                  type="button"
                  disabled={!email.ready}
                  onClick={() => email.login()}
                  className="btn btn-solid w-full justify-between"
                >
                  Sign in with email
                  <span aria-hidden>→</span>
                </button>
              )}
              {connect.error && (
                <p className="pt-2 text-sm text-bone-2">
                  {/no provider|not found/i.test(connect.error.message)
                    ? "No browser wallet found on this device."
                    : connect.error.message.split("\n")[0]}
                </p>
              )}
              {email && (
                <p className="pt-2 text-xs leading-relaxed text-bone-2">
                  Email accounts get gas paid by the floor for votes and redemptions of 100 WIF or more.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
