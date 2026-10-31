"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="relative z-[3] flex min-h-[70svh] flex-col items-center justify-center px-4 text-center">
      <p className="kicker">Read failed</p>
      <h1 className="display mt-5 text-[clamp(36px,4.6vw,64px)] leading-none">The drill hit something.</h1>
      <p className="mt-4 max-w-md text-bone-2">The page couldn&apos;t render. The contracts are fine; this is only the website.</p>
      <button type="button" onClick={reset} className="btn btn-solid mt-8">
        Try again
      </button>
    </main>
  );
}
