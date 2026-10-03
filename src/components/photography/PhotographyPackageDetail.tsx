import Link from 'next/link';
/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */
import { Price } from '@/components/site/Price';
import { PhotographyBenefits, PhotographyInformation } from './PhotographyInformation';
import { OtherMoments } from './OtherMoments';
import { InspirationGrid } from './InspirationGrid';
import { PhotoBookingCard } from './PhotoBookingCard';
import { buildInspirationItems } from './packages-data';
import { getT } from '@/lib/i18n/server';
import { durationLabel } from '@/lib/catalogue/detail';
import { Gallery } from '@/components/gyg/detail/Gallery';
import { packageGalleryImages } from '@/lib/catalogue/package-gallery';
import { activityFromPriceEur } from '@/lib/catalogue/options';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import {
  isLocationSupplementName,
  PHOTO_STOCK,
  photographyCover,
  photographyGroup,
  photographyInspirationIds,
  photographySlots,
  photographySpecs,
  savedPhotographyGroup,
  type GalleryTag,
} from '@/lib/catalogue/photography';
import type { TourDetail } from '@/lib/validation/tours';

/**
 * The v3 package page (design: .design-tmp/photo-handoff "Photography Services v3", Package
 * screen): breadcrumb, photo + video gallery (lead + four, "View all"), spec chips, long copy, "What's included", the "Photographed
 * by locals" card, meeting-point + cancellation info cards, and the sticky PhotoBookingCard — all
 * on live catalogue data. The v3 "How the session runs" timeline has no data source in the
 * catalogue, so it is omitted rather than faked.
 */
export async function PhotographyPackageDetail({ activity }: { activity: TourDetail }) {
  const t = await getT();
  const specs = photographySpecs(activity.extra);
  const group = photographyGroup(activity, savedPhotographyGroup(activity.extra));
  // Only enabled slots reach the card's picker.
  const slots = photographySlots(activity.extra, group).filter((s) => s.enabled);
  const price = activityFromPriceEur(activity);
  const duration = durationLabel(activity.durationMinutes);
  const privateOpt = activity.options.find((o) => o.privateBaseEur != null);
  const maxGuests = privateOpt?.privateMaxGuests ?? privateOpt?.privateIncluded ?? null;
  const addOnNames = (activity.supplements ?? [])
    .map((s) => s.name)
    // "Location: …" rows are location surcharges (chosen with the location), not generic add-ons.
    .filter((n) => n.trim() && !isLocationSupplementName(n));
  const photos = await getPhotographyPhotos();
  // The lead tile is the package's COVER (cards/search/SEO read the same URL); the tiles after it are the
  // gallery the owner arranged — photos, uploaded videos and YouTube / Vimeo links. The first PHOTO always
  // leads (a video can never be the lead tile), and the cover is never repeated.
  const gallery = packageGalleryImages(
    activity.images,
    photographyCover(activity.extra) ?? activity.images[0]?.url ?? null,
    activity.title,
  );
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
  const descriptionParas = (activity.description ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-col gap-7">
      <nav
        aria-label={t('Breadcrumb')}
        className="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
      >
        <Link href="/photography" className="font-semibold text-teal hover:text-teal-dark">
          {t('Photography')}
        </Link>
        <span aria-hidden>/</span>
        <Link href="/photography/packages" className="font-semibold text-teal hover:text-teal-dark">
          {group === 'weddings' ? t('Weddings') : t('Photoshoots')}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-semibold text-ink">{activity.title}</span>
      </nav>

      {/* Lead + four tiles, then "View all N" for the rest. Photos, uploaded videos and YouTube / Vimeo
          links; the owner arranges them in Photography → package → Gallery photos & videos. */}
      {gallery.length > 0 && (
        <Gallery variant="photography" images={gallery} title={activity.title} />
      )}

      <div className="flex flex-wrap items-start gap-10">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-10">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {duration && specs.showDuration && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {duration}
                </span>
              )}
              {maxGuests != null && specs.showGuests && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {t('Up to {n} guests', { n: maxGuests })}
                </span>
              )}
              <span className="rounded-full bg-teal-tint px-3 py-1.5 text-[13px] font-bold text-teal-dark">
                {group === 'weddings' ? t('Sneak peek in 48 hours') : t('Free weather reschedule')}
              </span>
              {specs.photoCount != null && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {t('Up to {n} edited photos', { n: specs.photoCount })}
                </span>
              )}
              {specs.location && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {specs.location}
                </span>
              )}
              {specs.delivery && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {specs.delivery}
                </span>
              )}
              {addOnNames.length > 0 && specs.showAddOns && (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-[13px] font-bold">
                  {t('Optional add-ons: {names}', { names: addOnNames.join(', ') })}
                </span>
              )}
            </div>
            <h1 className="m-0 text-balance text-[clamp(34px,4.4vw,54px)] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
              {activity.title}
            </h1>
            {activity.summary && (
              <p className="m-0 max-w-[620px] text-lg leading-relaxed text-ink-muted">
                {activity.summary}
              </p>
            )}
            {descriptionParas.map((para, i) => (
              <p key={i} className="m-0 max-w-[620px] text-[15px] leading-relaxed text-ink/75">
                {para}
              </p>
            ))}
            <a
              href="#book"
              className="w-fit rounded-full border-[1.5px] border-ink px-5 py-3 text-[15px] font-bold text-ink transition hover:bg-ink hover:text-white"
            >
              {t('Check dates')} · {t('from')}{' '}
              {price != null ? <Price eur={price} /> : t('On request')}
            </a>
          </div>

          {activity.inclusions.length > 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="m-0 text-[22px] font-bold tracking-[-0.015em] text-ink">
                {t("What's included")}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
                {activity.inclusions.map((inc) => (
                  <div
                    key={inc}
                    className="flex items-start gap-3 rounded-[14px] border border-ink/10 bg-white p-4 text-[15px] leading-snug text-ink"
                  >
                    <span className="mt-px grid h-5 w-5 flex-none place-items-center rounded-full bg-teal text-[11px] font-bold text-white">
                      ✓
                    </span>
                    <span>{inc}</span>
                  </div>
                ))}
              </div>
              {activity.exclusions.length > 0 && (
                <div className="mt-1">
                  <h3 className="m-0 text-[15px] font-bold text-ink">{t('Not included')}</h3>
                  <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink/70">
                    {activity.exclusions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-5 rounded-[18px] border border-ink/10 bg-white p-6">
            <div className="flex flex-none">
              {[PHOTO_STOCK.couple, PHOTO_STOCK.family2, PHOTO_STOCK.weddingCouple].map(
                (src, i) => (
                  <div
                    key={src}
                    className={`h-[60px] w-[60px] overflow-hidden rounded-full border-[3px] border-white bg-teal-tint ${i > 0 ? '-ml-4' : ''}`}
                  >
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </div>
                ),
              )}
            </div>
            <div className="flex flex-[1_1_260px] flex-col gap-1">
              <span className="text-[17px] font-bold text-ink">{t('Photographed by locals')}</span>
              <span className="text-sm leading-relaxed text-ink-muted">
                {t(
                  'Island-born photographers who shoot these beaches every week. We match you by language and style: English, French, German or Kreol.',
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-6 rounded-[18px] bg-teal-tint p-6">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-teal">
                {group === 'weddings' ? t('Planning call') : t('Meeting point')}
              </span>
              <span className="text-[15px] leading-relaxed text-ink">
                {group === 'weddings'
                  ? t(
                      'Four weeks before, we plan the timeline, shot list and family groups with you.',
                    )
                  : (activity.meetingPoint ??
                    t('Chosen with you after booking. Hotel shoots start in your lobby.'))}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-teal">
                {t('Cancellation')}
              </span>
              <span className="text-[15px] leading-relaxed text-ink">
                {activity.cancellationPolicy ??
                  (group === 'weddings'
                    ? t('Full refund up to 60 days before. One free date change.')
                    : t('Full refund up to 7 days before. Weather changes are always free.'))}
              </span>
            </div>
          </div>
        </div>

        <PhotoBookingCard slots={slots} group={group} bestSeller={specs.bestSeller} />
      </div>

      {inspiration.length > 0 && (
        <section className="border-t border-ink/10 pt-7">
          <h2 className="m-0 text-lg font-bold text-ink">
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

      <div className="space-y-10 border-t border-ink/10 pt-8">
        <PhotographyBenefits />
        <PhotographyInformation />
      </div>

      <OtherMoments />
    </div>
  );
}
