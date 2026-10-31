import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/floor", label: "Floor" },
  { href: "/proof", label: "Proof" },
];

export function SiteHeader({ current, children }: { current?: "/floor" | "/proof"; children?: ReactNode }) {
  return (
    <header className="relative z-10 flex items-center justify-between gap-4 px-4 py-5 md:px-10 md:py-7">
      <Link href="/" className="display reveal text-[22px] tracking-[-0.03em]">
        Underfoot
      </Link>
      <nav className="reveal flex items-center gap-4 md:gap-7" aria-label="Main">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={current === n.href ? "page" : undefined}
            className="font-mono text-xs uppercase tracking-[0.06em] text-bone-2 transition-colors hover:text-bone aria-[current=page]:text-bone"
          >
            {n.label}
          </Link>
        ))}
        {children}
      </nav>
    </header>
  );
}
