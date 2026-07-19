import Link from 'next/link';
import { CountUp } from '@/components/site/CountUp';
import { RevealGroup } from '@/components/site/RevealGroup';
import { SITE } from '@/lib/seo/site';
import { reviewStats } from '@/lib/content/reviews';

/**
 * Above-the-fold trust signals: real rating, longevity, licensing, ethics and instant booking.
 *
 * Motion is layered so the three effects never fight over `transform`: the item fades up (group
 * reveal), the badge pops in and scales on hover, and the emoji inside carries its own idle loop.
 * `--trust-d` mirrors RevealGroup's 70ms stagger so each badge pops with its own row.
 */
const ITEMS: {
  key: string;
  emoji: string;
  idle: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  href?: string;
}[] = [
  {
    key: 'rating',
    emoji: '⭐',
    idle: 'gyt-trust-twinkle',
    title: (
      <>
        <CountUp value={reviewStats.average} decimals={1} duration={1000} delay={260} />
        /5 rating
      </>
    ),
    sub: (
      <>
        <CountUp value={reviewStats.total} duration={1100} delay={260} /> reviews
      </>
    ),
    href: '/reviews',
  },
  {
    key: 'since',
    emoji: '📅',
    idle: 'gyt-trust-tick',
    title: 'Since the early 2000s',
    sub: 'Local Mauritian operator',
  },
  {
    key: 'licensed',
    emoji: '🛡️',
    idle: 'gyt-trust-glint',
    title: 'Licensed & registered',
    sub: `BRN ${SITE.brn}`,
  },
  {
    key: 'commission',
    emoji: '🤝',
    idle: 'gyt-trust-nudge',
    title: 'No commission stops',
    sub: 'Transparent fixed pricing',
  },
  {
    key: 'online',
    emoji: '⚡',
    idle: 'gyt-trust-pulse',
    title: 'Book & pay online',
    sub: 'Instant confirmation',
  },
];

export function TrustStrip() {
  return (
    <section
      aria-label="Why book with Belle Mare Tours"
      className="border-b border-ink/8 bg-cream/70"
    >
      <RevealGroup className="mx-auto grid max-w-shell grid-cols-2 gap-x-6 gap-y-5 px-6 py-6 sm:grid-cols-3 lg:grid-cols-5">
        {ITEMS.map((it, i) => {
          const inner = (
            <>
              <span className="gyt-trust-badge grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal-tint text-[18px]">
                <span className={`gyt-trust-emoji ${it.idle}`}>{it.emoji}</span>
              </span>
              <span className="min-w-0">
                <span className="gyt-trust-title block text-[14px] font-extrabold leading-tight text-ink">
                  {it.title}
                </span>
                <span className="block text-[12.5px] leading-tight text-ink-muted">{it.sub}</span>
              </span>
            </>
          );
          const style = { '--trust-d': `${i * 70}ms` } as React.CSSProperties;
          return it.href ? (
            <Link
              key={it.key}
              href={it.href}
              style={style}
              className="gyt-trust-item flex items-center gap-3 transition hover:opacity-80"
            >
              {inner}
            </Link>
          ) : (
            <div key={it.key} style={style} className="gyt-trust-item flex items-center gap-3">
              {inner}
            </div>
          );
        })}
      </RevealGroup>
    </section>
  );
}
