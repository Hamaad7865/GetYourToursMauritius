import type { ReactNode } from 'react';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { IconArrowRight, IconChat, IconChevron } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';

/** Branded shell for the static landing pages (About, Rent, Taxi, …): solid header,
 *  a teal hero band with title + intro, the page body, then the footer. */
export function InfoPage({
  title,
  intro,
  eyebrow,
  meta,
  heroImage,
  children,
}: {
  title: string;
  intro: string;
  eyebrow?: string;
  /** Optional small print under the intro (e.g. "Last updated 18 July 2026"). */
  meta?: ReactNode;
  /** Optional photo behind the hero band; a teal overlay keeps the white title legible. */
  heroImage?: string;
  children: ReactNode;
}) {
  return (
    <>
      <GygHeader />
      <main className="bg-white">
        <section className="relative overflow-hidden bg-[radial-gradient(120%_120%_at_50%_-20%,#13a0a6_0%,#0E8C92_42%,#0B5C63_100%)]">
          {heroImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImage} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-tr from-[#03262b]/95 via-[#0a4953]/88 to-[#0E8C92]/55" />
            </>
          )}
          <div className="relative mx-auto max-w-shell px-6 py-14 sm:py-20">
            {eyebrow && (
              <p className="mb-3 text-[12.5px] font-bold uppercase tracking-[0.16em] text-white/70">
                {eyebrow}
              </p>
            )}
            <h1 className={`max-w-3xl text-[clamp(28px,5vw,52px)] font-extrabold leading-[1.05] tracking-tight text-white${heroImage ? ' [text-shadow:0_2px_18px_rgba(2,22,24,0.55)]' : ''}`}>
              {title}
            </h1>
            <p className={`mt-4 max-w-2xl text-[15px] leading-relaxed text-white/85 sm:text-base${heroImage ? ' [text-shadow:0_2px_18px_rgba(2,22,24,0.55)]' : ''}`}>
              {intro}
            </p>
            {meta && <p className="mt-5 text-[13px] font-medium text-white/65">{meta}</p>}
          </div>
        </section>
        <div className="mx-auto max-w-shell px-6 py-12 sm:py-16">{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}

/** WhatsApp + phone call-to-action row used at the foot of each landing page. */
export async function EnquireRow({ message }: { message: string }) {
  const t = await getT();
  return (
    <div className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-ink/10 bg-cream/60 p-5">
      <p className="mr-auto text-[15px] font-bold text-ink">{t('Ready to book or have a question?')}</p>
      <a
        href={whatsappUrl(message)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
      >
        <IconChat width={17} height={17} /> {t('WhatsApp us')}
      </a>
      <a
        href={`tel:${SITE.phone.replace(/\s+/g, '')}`}
        className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        {SITE.phone}
      </a>
    </div>
  );
}

/** A titled content block with optional anchor id (used for #car / #scooter on Rent). */
export function InfoSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-ink/10 py-9 first:border-t-0 first:pt-0">
      <h2 className="text-[22px] font-extrabold tracking-tight text-ink">{title}</h2>
      <div className="mt-4 text-[15px] leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

/** A bullet list with coral chevrons. */
export async function FeatureList({ items }: { items: string[] }) {
  const t = await getT();
  return (
    <ul className="m-0 mt-4 flex list-none flex-col gap-2.5 p-0">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2.5">
          <IconChevron width={16} height={16} className="mt-1 shrink-0 -rotate-90 text-coral" />
          <span>{t(it)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Inline link to the activities catalogue. */
export async function BrowseLink() {
  const t = await getT();
  return (
    <Link
      href="/activities"
      className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
    >
      {t('Browse all activities')} <IconArrowRight width={16} height={16} />
    </Link>
  );
}
