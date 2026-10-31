"use client";

import { useEffect } from "react";

/** Starts the one load entrance; `.reveal` falls back on its own if this never runs. */
export function Entrance() {
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => document.documentElement.classList.add("is-in"));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  return null;
}
