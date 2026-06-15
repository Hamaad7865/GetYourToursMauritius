import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** GetYourTours · Mauritius brand lockup: the pin mark + the wordmark. `tone="dark"` (over a
 *  dark/photo background) flips the coloured wordmark to white so it stays legible. */
export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5 no-underline" aria-label="GetYourTours Mauritius — home">
      <img src="/logo-mark.png" alt="" className="h-9 w-9 shrink-0 object-contain" />
      <img
        src="/logo-wordmark.png"
        alt="GetYourTours Mauritius"
        className={`h-7 w-auto object-contain ${tone === 'dark' ? 'brightness-0 invert' : ''}`}
      />
    </Link>
  );
}
