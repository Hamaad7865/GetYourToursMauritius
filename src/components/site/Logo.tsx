import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** GetYourTours · Mauritius horizontal logo. The source art is white (for the photo hero +
 *  dark footer); on light surfaces a `brightness-0` filter renders it dark. */
export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link
      href="/"
      className="flex shrink-0 items-center no-underline"
      aria-label="GetYourTours Mauritius — home"
    >
      <img
        src="/logo.png"
        alt="GetYourTours Mauritius"
        className={`h-9 w-auto object-contain sm:h-11 ${tone === 'light' ? 'brightness-0' : ''}`}
      />
    </Link>
  );
}
