import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** GetYourTours · Mauritius horizontal logo (vector, teal-blue gradient). Shown in colour on
 *  light surfaces; over dark backgrounds (photo hero, footer) it's reversed to white so it
 *  always reads. */
export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center no-underline"
      aria-label="GetYourTours Mauritius — home"
    >
      <img
        src="/logo.svg"
        alt="GetYourTours Mauritius"
        className={`h-10 w-auto sm:h-12 ${tone === 'dark' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  );
}
