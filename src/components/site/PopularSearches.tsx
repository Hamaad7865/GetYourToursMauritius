import Link from 'next/link';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';

/**
 * A crawlable cluster of internal links to the main SEO landing pages and content hubs. It lives at
 * the foot of the homepage so every key page is one click — and one crawl hop — from the site root.
 * Plain English labels: the site defaults to English and these are mostly place/brand names. Hrefs are
 * same-language, so the French homepage passes its weight to the French pages, not the English ones.
 */
const LINKS: { label: string; labelFr?: string; href: string }[] = [
  // SEASONAL until 2026-12-31 — December trip-planning demand peaks Oct–Nov ("ile maurice en
  // decembre" sat at #26 with rising impressions). Remove in January.
  {
    label: 'Mauritius in December',
    labelFr: 'L’île Maurice en décembre',
    href: '/blog/mauritius-in-december',
  },
  { label: 'Mauritius tours', href: '/mauritius-tours' },
  { label: 'Catamaran cruise', href: '/mauritius-catamaran-cruise' },
  { label: 'Île aux Cerfs tours', href: '/ile-aux-cerfs-tours' },
  { label: 'Swim with dolphins', href: '/dolphin-swim-mauritius' },
  { label: 'Airport transfers', href: '/airport-transfers' },
  { label: 'Things to do in Mauritius', href: '/attractions' },
  { label: 'Mauritius activities', href: '/activities' },
  { label: 'Belle Mare Tours', href: '/belle-mare-tours' },
  { label: 'Destinations', href: '/destinations' },
  { label: 'Travel guide', href: '/mauritius-travel-guide' },
  { label: 'Guest reviews', href: '/reviews' },
];

export async function PopularSearches() {
  const t = await getT();
  const locale = await getLocale();
  return (
    <section aria-labelledby="popular-heading" className="mx-auto mt-12 max-w-shell px-6">
      <div className="rounded-2xl border border-teal/20 bg-teal-tint/40 p-6 sm:p-8">
        <h2 id="popular-heading" className="text-[20px] font-extrabold tracking-tight text-ink">
          {t('Popular on Belle Mare Tours')}
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
          {t(
            'Jump straight to the experiences Mauritius is known for — all bookable direct with the operator, with door-to-door pickup and no reseller markup.',
          )}
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={localePath(locale, l.href)}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-[14px] font-semibold text-ink hover:border-teal hover:text-teal"
            >
              {locale === 'fr' && l.labelFr ? l.labelFr : l.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
