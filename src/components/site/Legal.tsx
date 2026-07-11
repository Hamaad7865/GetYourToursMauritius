import type { ReactNode } from 'react';
import { IconChevron, IconInfo, IconCheck, IconX } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';

/** Shared building blocks for the legal / help articles (Terms, Privacy, Refunds, Help).
 *  All presentational, server-rendered, brand-token styled, no client JS — the only interactivity
 *  is native <details> (keyboard-accessible and works without hydration). */

export interface TocItem {
  id: string;
  label: string;
}

/**
 * Two-column reading layout: a sticky "On this page" rail on desktop, the article in a constrained
 * ~70-character measure for legibility. On mobile the rail collapses into a <details> jump menu.
 */
export async function LegalArticle({ toc, children }: { toc: TocItem[]; children: ReactNode }) {
  const t = await getT();
  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
      {/* Mobile / tablet: collapsible jump menu */}
      <details className="group mb-7 rounded-xl border border-ink/10 bg-cream/50 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
          {t('On this page')}
          <IconChevron
            width={16}
            height={16}
            className="text-ink-muted transition-transform group-open:rotate-180"
          />
        </summary>
        <nav aria-label={t('On this page')} className="flex flex-col gap-0.5 px-3 pb-3">
          {toc.map((t) => (
            <TocLink key={t.id} {...t} />
          ))}
        </nav>
      </details>

      {/* Desktop: sticky rail */}
      <nav
        aria-label={t('On this page')}
        className="sticky top-24 hidden h-max self-start lg:flex lg:flex-col lg:gap-0.5"
      >
        <p className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          {t('On this page')}
        </p>
        {toc.map((t) => (
          <TocLink key={t.id} {...t} />
        ))}
      </nav>

      <article className="max-w-2xl">{children}</article>
    </div>
  );
}

function TocLink({ id, label }: TocItem) {
  return (
    <a
      href={`#${id}`}
      className="rounded-md px-2 py-1.5 text-[13.5px] text-ink/70 no-underline hover:bg-teal/5 hover:text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
    >
      {label}
    </a>
  );
}

/** A titled section with an anchor id; scroll-mt offsets the sticky site header on jump. */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="mt-10 scroll-mt-28 border-t border-ink/10 pt-8 first:mt-0 first:border-t-0 first:pt-0"
    >
      <h2 className="text-[20px] font-extrabold tracking-tight text-ink sm:text-[22px]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Body paragraph. Links + <strong> inside are styled via descendant selectors. */
export function P({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-[15px] leading-[1.75] text-ink/80 first:mt-0 [&_a]:font-semibold [&_a]:text-teal hover:[&_a]:text-teal-dark [&_a]:underline-offset-2 [&_strong]:font-bold [&_strong]:text-ink">
      {children}
    </p>
  );
}

/** Sub-heading within a section. */
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 text-[15.5px] font-bold text-ink">{children}</h3>;
}

/** Coral-chevron bullet list, matching FeatureList on the landing pages. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0 text-[15px] leading-[1.7] text-ink/80">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 [&_strong]:font-bold [&_strong]:text-ink">
          <IconChevron width={15} height={15} className="mt-[5px] shrink-0 -rotate-90 text-coral" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

type CalloutTone = 'info' | 'success' | 'danger';

/** Highlighted note. Tone carries an icon + label so meaning never relies on colour alone. */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  const map = {
    info: { wrap: 'border-teal/25 bg-teal/[0.06]', icon: 'text-teal', Icon: IconInfo },
    success: {
      wrap: 'border-teal-bright/35 bg-teal-bright/[0.10]',
      icon: 'text-teal-dark',
      Icon: IconCheck,
    },
    danger: { wrap: 'border-coral/30 bg-coral/[0.07]', icon: 'text-coral', Icon: IconX },
  }[tone];
  const Icon = map.Icon;
  return (
    <div className={`mt-5 flex gap-3 rounded-2xl border p-4 sm:p-5 ${map.wrap}`}>
      <Icon width={18} height={18} className={`mt-0.5 shrink-0 ${map.icon}`} aria-hidden />
      <div className="text-[14.5px] leading-relaxed text-ink/85 [&_strong]:font-bold [&_strong]:text-ink">
        {title && <p className="font-bold text-ink">{title}</p>}
        <div className={title ? 'mt-1' : undefined}>{children}</div>
      </div>
    </div>
  );
}

/** A group of FAQ rows (GetYourGuide-style help centre). */
export function Faq({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 divide-y divide-ink/10 overflow-hidden rounded-2xl border border-ink/10">
      {children}
    </div>
  );
}

export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-bold text-ink [&::-webkit-details-marker]:hidden hover:bg-cream/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/40">
        <span>{q}</span>
        <IconChevron
          width={18}
          height={18}
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="px-5 pb-5 text-[14.5px] leading-[1.7] text-ink/80 [&_a]:font-semibold [&_a]:text-teal hover:[&_a]:text-teal-dark [&_strong]:font-bold [&_strong]:text-ink">
        {children}
      </div>
    </details>
  );
}
