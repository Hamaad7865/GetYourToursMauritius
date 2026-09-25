import Link from 'next/link';
import { Gallery } from '@/components/gyg/detail/Gallery';
import { Price } from '@/components/site/Price';
import { PhotographyBenefits, PhotographyInformation } from './PhotographyInformation';
import { OtherMoments } from './OtherMoments';
import { InspirationGrid } from './InspirationGrid';
import { buildInspirationItems } from './packages-data';
import { IconCheck } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';
import { durationLabel } from '@/lib/catalogue/detail';
import { videosFirst } from '@/lib/media';
import { activityFromPriceEur } from '@/lib/catalogue/options';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import {
  photographyCover,
  photographyGroup,
  photographyInspirationIds,
  photographySpecs,
  savedPhotographyGroup,
  type GalleryTag,
} from '@/lib/catalogue/photography';
import type { TourDetail } from '@/lib/validation/tours';

/**
 * One spec line in the sticky price card: a circled check + divider, reference-style. `strong`
 * marks the package-derived lines (guests, add-ons) that carry the booking facts.
 */
function SpecTick({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 py-2.5 text-[13.5px] leading-snug ${
        strong ? 'font-bold text-ink' : 'font-semibold text-ink/85'
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-teal-dark text-teal-dark">
        <IconCheck width={11} height={11} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export async function PhotographyPackageDetail({ activity }: { activity: TourDetail }) {
  const t = await getT();
  const duration = durationLabel(activity.durationMinutes);
  const price = activityFromPriceEur(activity);
  // Card ticks that describe THIS package, not generic copy: the shoot's guest capacity (its
  // private option covers N, capped at max) and the add-ons the owner priced for it.
  const privateOpt = activity.options.find((o) => o.privateBaseEur != null);
  const maxGuests = privateOpt?.privateMaxGuests ?? privateOpt?.privateIncluded ?? null;
  const addOnNames = (activity.supplements ?? []).map((s) => s.name).filter((n) => n.trim());
  const specs = photographySpecs(activity.extra);
  const photos = await getPhotographyPhotos();
  const group = photographyGroup(activity, savedPhotographyGroup(activity.extra));
  // The lead tile plays: videos first, then photos (stable). The COVER never appears here —
  // it lives on cards, search and SEO. The form always writes it as images[0], and the explicit
  // key covers a reorder in the full editor; with neither, images[0] is still the cover by form
  // convention, so it is skipped too.
  const cover = photographyCover(activity.extra);
  const galleryPool = cover
    ? activity.images.filter((i) => i.url !== cover)
    : activity.images.slice(1);
  const galleryImages = videosFirst(galleryPool);
  const { tag, items: inspiration } = buildInspirationItems(
    t,
    photos,
    activity,
    group,
    6,
    photographyInspirationIds(activity.extra),
  );
  // Literal t() calls (not the dynamic map key) so the i18n scanner can find every source string.
  const TAG_LABEL: Record<GalleryTag, string> = {
    weddings: t('wedding'),
    films: t('film'),
    couples: t('couple'),
    family: t('family'),
  };
  // The sticky price card and the scrolling content must share ONE grid row spanning the whole
  // page — everything (gallery, description, benefits, useful information) lives in the LEFT
  // column so that column's height is the sticky card's containing block. Splitting content into a
  // second grid row (col-span-2) shrinks that containing block to just the first row, so the card
  // stops sticking partway down and then floats, overlapping whatever comes after it.
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
      <div className="min-w-0">
        <Gallery images={galleryImages} title={activity.title} />
        {activity.summary && (
          <p className="text-base leading-relaxed text-ink/80">{activity.summary}</p>
        )}
        {activity.inclusions.length > 0 && (
          <section className="mt-6 border-t border-ink/10 pt-6">
            <h2 className="text-lg font-bold text-ink">{t('Includes')}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/80">
              {activity.inclusions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        <Link
          href="/photography/gallery"
          className="mt-6 inline-block text-sm font-bold text-teal-dark underline underline-offset-4"
        >
          {t('View full gallery')}
        </Link>
        {inspiration.length > 0 && (
          <section className="mt-8 border-t border-ink/10 pt-7">
            <h2 className="text-lg font-bold text-ink">
              {t('Get inspired by these {category} shots', { category: TAG_LABEL[tag] })}
            </h2>
            <InspirationGrid
              items={inspiration.map((item) => ({
                key: item.key,
                src: item.src,
                thumb: item.thumb,
                alt: item.alt,
                aspect: item.aspect,
              }))}
            />
            <Link
              href={`/photography/gallery?c=${tag}`}
              className="mt-4 inline-block text-sm font-bold text-teal-dark underline underline-offset-4"
            >
              {t('See more photos')}
            </Link>
          </section>
        )}
        {specs.showDetails &&
          (activity.description || activity.exclusions.length > 0 || activity.meetingPoint) && (
            <details className="mt-6 border-y border-ink/10 py-4">
              <summary className="cursor-pointer font-semibold text-ink">
                {t('Package details')}
              </summary>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink/80">
                {(activity.description ?? '')
                  .split(/\n{2,}/)
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                {activity.meetingPoint && (
                  <p>
                    <b>{t('Meeting point / pickup:')}</b> {activity.meetingPoint}
                  </p>
                )}
                {activity.exclusions.length > 0 && (
                  <>
                    <h3 className="font-bold">{t('Not included')}</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {activity.exclusions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </details>
          )}
        <div className="mt-10 space-y-10 border-t border-ink/10 pt-8">
          <PhotographyInformation />
          <PhotographyBenefits />
        </div>
        <OtherMoments />
      </div>
      <aside className="rounded-xl border border-ink/15 p-6 text-center lg:sticky lg:top-6">
        <h2 className="text-xl font-bold text-ink">{activity.title}</h2>
        {specs.bestSeller && (
          <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-coral">
            {t('Best seller')}
          </p>
        )}
        <p className="mt-5 text-sm text-ink-muted">{t('From')}</p>
        <div className="text-5xl font-extrabold tracking-tight text-ink">
          {price != null ? <Price eur={price} /> : t('On request')}
        </div>
        <ul className="mt-5 divide-y divide-ink/10 border-y border-ink/10 text-left">
          {duration && specs.showDuration && <SpecTick>{duration}</SpecTick>}
          {specs.photoCount != null && (
            <SpecTick>{t('Up to {n} edited photos', { n: specs.photoCount })}</SpecTick>
          )}
          {specs.location && <SpecTick>{specs.location}</SpecTick>}
          {specs.delivery && <SpecTick>{specs.delivery}</SpecTick>}
          {maxGuests != null && specs.showGuests && (
            <SpecTick strong>{t('Up to {n} guests', { n: maxGuests })}</SpecTick>
          )}
          {addOnNames.length > 0 && specs.showAddOns && (
            <SpecTick strong>
              {t('Optional add-ons: {names}', { names: addOnNames.join(', ') })}
            </SpecTick>
          )}
          {specs.showDeposit && (
            <SpecTick>{t('50% now, 50% when your photos are delivered')}</SpecTick>
          )}
        </ul>
        <Link
          href={`/activities/${activity.slug}?booking=1`}
          className="mt-6 flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-4 text-base font-extrabold uppercase tracking-wide text-white hover:bg-teal-dark/90"
        >
          {t('Book now')}
        </Link>
      </aside>
    </div>
  );
}
