import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** GetYourTours · Mauritius logo lockup (transparent PNG). Sized by height with auto width so
 *  the full lockup is legible. Over dark backgrounds (photo hero, footer) it's shown as a clean
 *  white reverse via a filter so it stays visible. */
export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center no-underline"
      aria-label="GetYourTours Mauritius — home"
    >
      <img
        src="/logo-mark.png"
        alt="GetYourTours Mauritius"
        className={`h-16 w-auto object-contain sm:h-[68px] ${tone === 'dark' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  );
}
