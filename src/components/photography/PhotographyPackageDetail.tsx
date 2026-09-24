import Link from 'next/link';
import { Gallery } from '@/components/gyg/detail/Gallery';
import { Price } from '@/components/site/Price';
import { PhotographyBenefits, PhotographyInformation } from './PhotographyInformation';
import { buildInspirationItems } from './packages-data';
import { IconCheck } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';
import { durationLabel } from '@/lib/catalogue/detail';
import { activityFromPriceEur } from '@/lib/catalogue/options';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import {
  photographyGroup,
  savedPhotographyGroup,
  type GalleryTag,
} from '@/lib/catalogue/photography';
import type { TourDetail } from '@/lib/validation/tours';

export async function PhotographyPackageDetail({ activity }: { activity: TourDetail }) {
  const t = await getT();
  const duration = durationLabel(activity.durationMinutes);
  const price = activityFromPriceEur(activity);
  const photos = await getPhotographyPhotos();
  const group = photographyGroup(activity, savedPhotographyGroup(activity.extra));
  const { tag, items: inspiration } = buildInspirationItems(t, photos, activity, group);
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
        <Gallery images={activity.images} title={activity.title} leadOnly />
        {activity.summary && (
          <p className="text-base leading-relaxed text-ink/80">{activity.summary}</p>
        )}
        {duration && <p className="mt-4 text-sm font-semibold text-teal-dark">{duration}</p>}
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
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {inspiration.map((item) => (
                // eslint-disable-next-line @next/next/no-img-element -- CF Pages serves images unoptimized.
                <img
                  key={item.key}
                  src={item.thumb ?? item.src}
                  alt={item.alt}
                  loading="lazy"
                  className={`w-full rounded-xl object-cover ${item.aspect}`}
                />
              ))}
            </div>
            <Link
              href={`/photography/gallery?c=${tag}`}
              className="mt-4 inline-block text-sm font-bold text-teal-dark underline underline-offset-4"
            >
              {t('See more photos')}
            </Link>
          </section>
        )}
        {(activity.description || activity.exclusions.length > 0 || activity.meetingPoint) && (
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
          <PhotographyBenefits />
          <PhotographyInformation />
        </div>
      </div>
      <aside className="rounded-xl border border-ink/15 p-6 lg:sticky lg:top-6">
        <h2 className="text-xl font-bold text-ink">{activity.title}</h2>
        <p className="mt-5 text-sm text-ink-muted">{t('From')}</p>
        <div className="text-4xl font-extrabold tracking-tight text-ink">
          {price != null ? <Price eur={price} /> : t('On request')}
        </div>
        <ul className="mt-5 space-y-2.5 border-t border-ink/10 pt-5">
          {duration && (
            <li className="flex items-start gap-2.5 text-sm text-ink/85">
              <IconCheck width={16} height={16} className="mt-0.5 shrink-0 text-teal-dark" />
              {duration}
            </li>
          )}
          {activity.inclusions.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-ink/85">
              <IconCheck width={16} height={16} className="mt-0.5 shrink-0 text-teal-dark" />
              {item}
            </li>
          ))}
          <li className="flex items-start gap-2.5 text-sm text-ink/85">
            <IconCheck width={16} height={16} className="mt-0.5 shrink-0 text-teal-dark" />
            {t('50% now, 50% when your photos are delivered')}
          </li>
        </ul>
        <Link
          href={`/activities/${activity.slug}?booking=1`}
          className="mt-6 flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark/90"
        >
          {t('Book now')}
        </Link>
      </aside>
    </div>
  );
}
