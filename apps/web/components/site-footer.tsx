import Link from "next/link";

import { LINKS } from "@/lib/site";

export function SiteFooter() {
  const links = [
    { href: LINKS.repo, label: "Repository" },
    { href: LINKS.docs, label: "Docs" },
    { href: LINKS.x, label: "X" },
  ].filter((l) => l.href);
  return (
    <footer className="relative z-10 border-t border-rule px-4 py-10 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div className="max-w-sm">
          <p className="display text-[22px] tracking-[-0.03em]">Underfoot</p>
          <p className="mt-3 text-sm leading-relaxed text-bone-2">
            A floor of Stock Tokens under $WIF, on Robinhood Chain. No owner, no admin keys. Not investment advice.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-3 font-mono text-xs uppercase tracking-[0.06em] text-bone-2">
          <li>
            <Link className="hover:text-bone" href="/floor">Floor</Link>
          </li>
          <li>
            <Link className="hover:text-bone" href="/proof">Proof</Link>
          </li>
          {links.map((l) => (
            <li key={l.label}>
              <a className="hover:text-bone" href={l.href} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            </li>
          ))}
          <li className="normal-case tracking-normal">
            MCP <code className="text-bone">/api/mcp</code>
          </li>
        </ul>
      </div>
    </footer>
  );
}
