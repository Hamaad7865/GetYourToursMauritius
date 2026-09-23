import Link from 'next/link';
import { Price } from '@/components/site/Price';
import { IconArrowRight } from '@/components/ui/icons';
import type { PhotoPackage } from './PackagesSection';

/**
 * One row card of the /photography/packages pricing guide: copy on the left, the photo bleeding in
 * from the right, the "from" price and a See-more button at the foot. Server-rendered — only the
 * price is a client island (currency switching).
 */
export function PricingGuideCard({
  pkg,
  fromLabel,
  onRequestLabel,
  ctaLabel,
}: {
  pkg: PhotoPackage;
  fromLabel: string;
  onRequestLabel: string;
  ctaLabel: string;
}) {
  const cls =
    'group relative isolate flex min-h-[340px] overflow-hidden rounded-2xl border border-ink/10 bg-teal-tint/60 shadow-[0_1px_3px_rgba(10,46,54,0.05)] transition hover:border-teal/40 hover:shadow-[0_18px_40px_-24px_rgba(10,46,54,0.35)] sm:min-h-[380px]';
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pkg.image}
        alt={pkg.imageAlt}
        loading="lazy"
        className="absolute inset-y-0 right-0 -z-10 h-full w-[62%] object-cover transition duration-700 group-hover:scale-[1.03]"
      />
      {/* Fades the photo into the card so the copy always sits on a calm field. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#EAF7F5_0%,#EAF7F5_38%,rgba(234,247,245,0.85)_52%,rgba(234,247,245,0)_78%)]"
      />
      <div className="flex w-full flex-col p-6 sm:p-8">
        <h3 className="max-w-[16ch] text-[clamp(20px,2.2vw,28px)] font-extrabold uppercase leading-[1.05] tracking-[0.04em] text-ink">
          {pkg.title}
        </h3>
        {pkg.meta && (
          <p className="mt-2 text-[12px] font-bold uppercase tracking-[0.18em] text-teal">
            {pkg.meta}
          </p>
        )}
        {pkg.summary && (
          <p className="mt-4 max-w-[26ch] text-[15px] leading-relaxed text-ink/80 sm:max-w-[30ch]">
            {pkg.summary}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-8">
          <p className="text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink">
            {pkg.priceEur != null ? (
              <>
                {fromLabel} <Price eur={pkg.priceEur} />
              </>
            ) : (
              onRequestLabel
            )}
          </p>
          <span className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white transition group-hover:bg-teal-dark">
            {ctaLabel}
            <IconArrowRight width={16} height={16} />
          </span>
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
