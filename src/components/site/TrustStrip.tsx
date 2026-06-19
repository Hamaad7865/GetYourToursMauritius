import Link from 'next/link';
import { SITE } from '@/lib/seo/site';
import { reviewStats } from '@/lib/content/reviews';

/** Above-the-fold trust signals: real rating, longevity, licensing, ethics and instant booking. */
const ITEMS: { emoji: string; title: string; sub: string; href?: string }[] = [
  { emoji: '⭐', title: `${reviewStats.average}/5 rating`, sub: `${reviewStats.total.toLocaleString()} reviews`, href: '/reviews' },
  { emoji: '📅', title: 'Since the early 2000s', sub: 'Local Mauritian operator' },
  { emoji: '🛡️', title: 'Licensed & registered', sub: `BRN ${SITE.brn}` },
  { emoji: '🤝', title: 'No commission stops', sub: 'Transparent fixed pricing' },
  { emoji: '⚡', title: 'Book & pay online', sub: 'Instant confirmation' },
];

export function TrustStrip() {
  return (
    <section aria-label="Why book with Belle Mare Tours" className="border-b border-ink/8 bg-cream/70">
      <div className="mx-auto grid max-w-shell grid-cols-2 gap-x-6 gap-y-5 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5">
        {ITEMS.map((it) => {
          const inner = (
            <>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-tint text-[18px]">
                {it.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-extrabold leading-tight text-ink">{it.title}</span>
                <span className="block text-[12.5px] leading-tight text-ink-muted">{it.sub}</span>
              </span>
            </>
          );
          return it.href ? (
            <Link key={it.title} href={it.href} className="flex items-center gap-3 transition hover:opacity-80">
              {inner}
            </Link>
          ) : (
            <div key={it.title} className="flex items-center gap-3">
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
