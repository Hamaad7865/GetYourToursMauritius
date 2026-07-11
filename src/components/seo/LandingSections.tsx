import type { ReactNode } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { ActivityGrid } from '@/components/catalogue/ActivityGrid';

/* Shared building blocks for the SEO landing pages (/mauritius-tours, /belle-mare-tours, …). Server
   components, raw English copy (no t() — these pages are content, not the translated booking flow), so
   the visible text matches the FAQPage / ItemList JSON-LD exactly. House style mirrors the Mauritius
   travel-guide page. */

/** A titled prose block. The first one on a page drops its top border/spacing. */
export function ContentSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-9 scroll-mt-28 border-t border-ink/10 pt-8 first:mt-0 first:border-t-0 first:pt-0"
    >
      <h2 className="text-[24px] font-extrabold tracking-tight text-ink">{title}</h2>
      <div className="mt-4 flex flex-col gap-3.5 text-[15.5px] leading-relaxed text-ink/80">
        {children}
      </div>
    </section>
  );
}

/** Inline teal text link used inside prose. */
export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="font-semibold text-teal underline underline-offset-2 hover:text-teal-dark"
    >
      {children}
    </Link>
  );
}

/**
 * Visible, expandable FAQ. Answers are plain strings so the SAME text feeds the FAQPage JSON-LD —
 * never pass markup here, or the structured data would diverge from what users see.
 */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((f, i) => (
        <details
          key={f.q}
          open={i === 0}
          className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40"
        >
          <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">
            {f.q}
          </summary>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

/** Live, bookable tours pulled from the catalogue. Renders nothing when the list is empty, so a
 *  targeted page never shows the catalogue's "nothing here yet" placeholder. */
export async function FeaturedTours({
  title,
  intro,
  activities,
}: {
  title: string;
  intro?: string;
  activities: TourSummary[];
}) {
  if (activities.length === 0) return null;
  return (
    <section className="mt-9 scroll-mt-28 border-t border-ink/10 pt-8">
      <h2 className="text-[24px] font-extrabold tracking-tight text-ink">{title}</h2>
      {intro && <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-ink/75">{intro}</p>}
      <div className="mt-6">
        <ActivityGrid activities={activities} />
      </div>
    </section>
  );
}

/** A wrap of pill links to related pages — internal-linking for crawlers and humans. */
export function RelatedLinks({ links }: { links: { label: string; href: string }[] }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2.5">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="rounded-full border border-ink/15 bg-white px-4 py-2 text-[14px] font-semibold text-ink hover:border-teal hover:text-teal"
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/** The "book direct" CTA pair shown near the foot of every landing page. */
export function BookDirectCta({
  primary = { href: '/activities', label: 'Browse tours & activities' },
  secondary = { href: '/airport-transfers', label: 'Book an airport transfer' },
}: {
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <Link
        href={primary.href}
        className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
      >
        {primary.label}
      </Link>
      <Link
        href={secondary.href}
        className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        {secondary.label}
      </Link>
    </div>
  );
}
