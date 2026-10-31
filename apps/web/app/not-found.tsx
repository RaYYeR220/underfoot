import Link from "next/link";

import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="relative z-[3] flex min-h-[70svh] flex-col items-center justify-center px-4 text-center">
        <p className="kicker">Core missing · no sample at this depth</p>
        <h1 className="display mt-5 text-[clamp(40px,5vw,72px)] leading-none">Nothing down here.</h1>
        <Link href="/" className="btn btn-solid mt-8">
          Back to the surface →
        </Link>
      </main>
    </>
  );
}
