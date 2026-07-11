import Link from 'next/link';

/**
 * A crawlable cluster of internal links to the main SEO landing pages and content hubs. It lives at
 * the foot of the homepage so every key page is one click — and one crawl hop — from the site root.
 * Plain English labels: the site defaults to English and these are mostly place/brand names.
 */
const LINKS: { label: string; href: string }[] = [
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

export function PopularSearches() {
  return (
    <section aria-labelledby="popular-heading" className="mx-auto mt-12 max-w-shell px-6">
      <div className="rounded-2xl border border-teal/20 bg-teal-tint/40 p-6 sm:p-8">
        <h2 id="popular-heading" className="text-[20px] font-extrabold tracking-tight text-ink">
          Popular on Belle Mare Tours
        </h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
          Jump straight to the experiences Mauritius is known for — all bookable direct with the
          operator, with door-to-door pickup and no reseller markup.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full border border-ink/15 bg-white px-4 py-2 text-[14px] font-semibold text-ink hover:border-teal hover:text-teal"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
