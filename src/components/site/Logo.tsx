import Link from 'next/link';

/** GetYourTours · MAURITIUS wordmark. `tone` controls colours on light/dark backgrounds. */
export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const get = tone === 'dark' ? 'text-cream' : 'text-ink';
  const tours = tone === 'dark' ? 'text-teal-bright' : 'text-teal';
  const sub = tone === 'dark' ? 'text-gold-light' : 'text-gold';
  return (
    <Link href="/" className="flex shrink-0 items-center gap-3 no-underline">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-bright to-teal-dark text-cream">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 14c3 0 3-2 6-2s3 2 6 2 3-2 6-2M4 18c2.5 0 2.5-1.5 5-1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M12 3v6m0 0 3-2m-3 2L9 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-xl font-bold tracking-tight">
          <span className={get}>GetYour</span>
          <span className={tours}>Tours</span>
        </span>
        <span className={`mt-1 text-[9.5px] font-bold tracking-[0.44em] ${sub}`}>MAURITIUS</span>
      </span>
    </Link>
  );
}
