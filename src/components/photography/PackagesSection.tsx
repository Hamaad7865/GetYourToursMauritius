'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { IconArrowRight, IconCheck } from '@/components/ui/icons';

export type PackageGroup = 'weddings' | 'shoots';

/** One card in the packages grid, already translated on the server. */
export interface PhotoPackage {
  key: string;
  group: PackageGroup;
  title: string;
  meta: string | null;
  /** Bullet list for the built-in cards; live catalogue packages show `summary` instead. */
  features: string[];
  summary: string | null;
  image: string;
  imageAlt: string;
  /** EUR "from" price, or null when the package is quote-only. */
  priceEur: number | null;
  href: string;
  /** True for the WhatsApp enquiry fallback (opens in a new tab). */
  external: boolean;
  highlight: boolean;
  /** The owner's "Best seller" pick (`extra.photographyBestSeller`) — badged on the card. */
  bestSeller: boolean;
}

/**
 * The packages grid, split into weddings vs holiday/family shoots. Live packages are ordinary
 * catalogue activities in the "Photography" category, so the Book button hands off to the normal
 * /activities/[slug] booking widget and checkout — nothing about the money path is re-implemented
 * here. With no live packages the same cards render as WhatsApp enquiries.
 */
export function PackagesSection({
  packages,
  addOnsNote,
}: {
  packages: PhotoPackage[];
  addOnsNote: string;
}) {
  const t = useT();
  const groups = (['weddings', 'shoots'] as const).filter((g) =>
    packages.some((p) => p.group === g),
  );
  const [active, setActive] = useState<PackageGroup>(groups[0] ?? 'weddings');
  const visible = packages.filter((p) => p.group === active);
  const label: Record<PackageGroup, string> = {
    weddings: t('Weddings'),
    shoots: t('Holiday & family shoots'),
  };

  return (
    <>
      {groups.length > 1 && (
        <div
          role="tablist"
          aria-label={t('Package type')}
          className="mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-ink/10 bg-white p-1.5 shadow-[0_1px_3px_rgba(10,46,54,0.05)]"
        >
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={active === g}
              onClick={() => setActive(g)}
              className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold transition ${
                active === g ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label[g]}
            </button>
          ))}
        </div>
      )}

      <div role="tabpanel" className="mt-10 grid gap-5 md:grid-cols-3">
        {visible.map((p) => (
          <PackageCard key={p.key} pkg={p} />
        ))}
      </div>

      <p className="mt-10 rounded-2xl border border-dashed border-ink/20 px-6 py-5 text-[14px] leading-relaxed text-ink/80">
        {addOnsNote}
      </p>
    </>
  );
}

function PackageCard({ pkg }: { pkg: PhotoPackage }) {
  const t = useT();
  const dark = pkg.highlight;
  const cta = pkg.external ? t('Enquire on WhatsApp') : t('Check dates & book');
  const ctaClass = `inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition ${
    dark ? 'bg-coral text-white hover:bg-coral-dark' : 'bg-ink text-white hover:bg-teal-dark'
  }`;

  return (
    <article
      className={`relative flex flex-col rounded-2xl p-6 transition ${
        dark
          ? 'bg-ink text-white shadow-[0_30px_60px_-25px_rgba(10,46,54,0.6)] md:-translate-y-3'
          : 'border border-ink/10 bg-white text-ink shadow-[0_1px_3px_rgba(10,46,54,0.05)] hover:border-teal/40 hover:shadow-[0_10px_28px_rgba(10,46,54,0.09)]'
      }`}
    >
      {dark && (
        <span className="absolute -top-3 left-6 rounded-full bg-gold-light px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-ink">
          {t('Our pick')}
        </span>
      )}
      {/* The dark "our pick" card keeps its left ribbon; the seller badge docks right instead. */}
      {pkg.bestSeller && (
        <span
          className={`absolute -top-3 rounded-full bg-coral px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-white ${dark ? 'right-6' : 'left-6'}`}
        >
          {t('Best seller')}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pkg.image}
        alt={pkg.imageAlt}
        loading="lazy"
        className="aspect-[16/10] w-full rounded-xl object-cover"
      />
      <h3 className="mt-6 text-xl font-extrabold tracking-tight">{pkg.title}</h3>
      {pkg.meta && (
        <p className={`mt-1 text-sm ${dark ? 'text-white/70' : 'text-ink-muted'}`}>{pkg.meta}</p>
      )}
      {pkg.features.length > 0 ? (
        <ul className="mt-5 space-y-2.5 text-sm">
          {pkg.features.map((f) => (
            <li key={f} className="flex items-start gap-2.5">
              <IconCheck
                width={16}
                height={16}
                className={`mt-0.5 shrink-0 ${dark ? 'text-teal-bright' : 'text-teal'}`}
              />
              <span className={dark ? 'text-white/90' : 'text-ink/80'}>{f}</span>
            </li>
          ))}
        </ul>
      ) : (
        pkg.summary && (
          <p
            className={`mt-4 line-clamp-4 text-sm leading-relaxed ${dark ? 'text-white/80' : 'text-ink/80'}`}
          >
            {pkg.summary}
          </p>
        )
      )}
      <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          {pkg.priceEur != null ? (
            <>
              <p className={`text-xs ${dark ? 'text-white/60' : 'text-ink-muted'}`}>{t('from')}</p>
              <Price eur={pkg.priceEur} className="text-3xl font-extrabold tracking-tight" />
            </>
          ) : (
            <p className={`text-sm font-bold ${dark ? 'text-white/80' : 'text-ink-muted'}`}>
              {t('Price on request')}
            </p>
          )}
        </div>
        {pkg.external ? (
          <a href={pkg.href} target="_blank" rel="noopener noreferrer" className={ctaClass}>
            {cta}
          </a>
        ) : (
          <Link href={pkg.href} className={ctaClass}>
            {cta}
            <IconArrowRight width={16} height={16} />
          </Link>
        )}
      </div>
    </article>
  );
}
