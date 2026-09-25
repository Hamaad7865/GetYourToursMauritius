import Link from 'next/link';
import { Price } from '@/components/site/Price';
import { IconArrowRight } from '@/components/ui/icons';
import type { PhotoPackage } from './PackagesSection';

/**
 * A quiet split panel: package details beside the admin-managed photo.
 */
export function PricingGuideCard({
  pkg,
  fromLabel,
  onRequestLabel,
  ctaLabel,
  bestSellerLabel,
}: {
  pkg: PhotoPackage;
  fromLabel: string;
  onRequestLabel: string;
  ctaLabel: string;
  bestSellerLabel: string;
}) {
  const cls =
    'group relative grid grid-cols-[1.1fr_1fr] overflow-hidden bg-teal-tint/40 transition-colors hover:bg-teal-tint/80 focus-visible:outline-teal-dark';
  const inner = (
    <>
      <div className="flex min-h-[290px] min-w-0 flex-col p-5 sm:min-h-[310px] sm:p-7">
        {pkg.bestSeller && (
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-coral">
            {bestSellerLabel}
          </p>
        )}
        <h2 className="break-words text-[19px] font-semibold leading-tight tracking-tight text-ink sm:text-[23px]">
          {pkg.title}
        </h2>
        {pkg.meta && <p className="mt-2 text-xs font-medium text-ink-muted">{pkg.meta}</p>}
        {pkg.summary && (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-muted sm:text-sm">
            {pkg.summary}
          </p>
        )}
        <div className="mt-auto pt-6">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {pkg.priceEur != null ? (
              <>
                {fromLabel} <Price eur={pkg.priceEur} />
              </>
            ) : (
              onRequestLabel
            )}
          </p>
          <span className="mt-4 inline-flex items-center gap-2 border-b border-teal-dark pb-1 text-sm font-semibold text-teal-dark">
            {ctaLabel}
            <IconArrowRight width={16} height={16} />
          </span>
        </div>
      </div>
      <div className="relative min-h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pkg.image}
          alt={pkg.imageAlt}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
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
