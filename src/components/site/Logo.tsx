import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** GetYourTours · Mauritius pin mark. A transparent PNG, so it sits cleanly on any
 *  background — no wordmark image (which carries a white box) and no tile behind it. */
export function Logo({ tone: _tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center no-underline"
      aria-label="GetYourTours Mauritius — home"
    >
      <img
        src="/logo-mark.png"
        alt="GetYourTours Mauritius"
        className="h-10 w-10 shrink-0 object-contain"
      />
    </Link>
  );
}
