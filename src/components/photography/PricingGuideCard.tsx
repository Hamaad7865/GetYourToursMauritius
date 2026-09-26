import Link from 'next/link';
import { Price } from '@/components/site/Price';
import { IconArrowRight } from '@/components/ui/icons';
import type { PhotoPackage } from './packages-data';

/**
 * The package card on /photography: the tour-card anatomy (cover with category pill + badges,
 * caps eyebrow, title, mood line, meta, rating, from-price, pill CTA), sized for a dense grid
 * of many packages. The whole card is the link.
 */
export function PricingGuideCard({
  pkg,
  groupLabel,
  fromLabel,
  onRequestLabel,
  ctaLabel,
  bestSellerLabel,
}: {
  pkg: PhotoPackage;
  groupLabel: string;
  fromLabel: string;
  onRequestLabel: string;
  ctaLabel: string;
  bestSellerLabel: string;
}) {
  const cls =
    'group flex flex-col overflow-hidden rounded-card border border-ink/10 bg-white shadow-[0_4px_18px_-6px_rgba(10,46,54,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_-18px_rgba(10,46,54,0.25)] focus-visible:outline-teal-dark';
  const inner = (
    <>
      <div className="relative aspect-[16/10] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pkg.image}
          alt={pkg.imageAlt}
          loading="lazy"
          className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
        />
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-ink shadow">
          {groupLabel}
        </span>
        {pkg.bestSeller && (
          <span className="absolute left-3 top-[42px] rounded-full bg-coral px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-widest text-white">
            {bestSellerLabel}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-teal-dark">
          {groupLabel}
        </p>
        <h2 className="mt-1 break-words text-[17px] font-extrabold leading-tight tracking-tight text-ink">
          {pkg.title}
        </h2>
        {pkg.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-muted">{pkg.summary}</p>
        )}
        {pkg.meta && <p className="mt-1.5 text-[11.5px] text-ink-muted">{pkg.meta}</p>}
        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between gap-3">
            {pkg.ratingAvg != null && (pkg.ratingCount ?? 0) > 0 ? (
              <p className="text-[11.5px] font-bold text-ink">
                <span className="text-gold-light">★</span> {pkg.ratingAvg.toFixed(1)}{' '}
                <span className="font-medium text-ink-muted">({pkg.ratingCount})</span>
              </p>
            ) : (
              <span />
            )}
            <p className="text-[11px] text-ink-muted">
              {pkg.priceEur != null ? (
                <>
                  {fromLabel}{' '}
                  <b className="text-base font-extrabold tracking-tight text-ink">
                    <Price eur={pkg.priceEur} />
                  </b>
                </>
              ) : (
                onRequestLabel
              )}
            </p>
          </div>
          <div className="mt-3 border-t border-ink/10 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal px-3.5 py-1.5 text-[11.5px] font-bold text-white transition group-hover:bg-teal-dark">
              {ctaLabel}
              <IconArrowRight width={13} height={13} />
            </span>
          </div>
        </div>
      </div>
    </>
  );

  return pkg.external ? (
    <a href={pkg.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={pkg.href} className={cls}>
      {inner}
    </Link>
  );
}
