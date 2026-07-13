import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { Rail } from '@/components/gyg/Rail';
import { PlaceCard } from '@/components/gyg/PlaceCard';
import { WishHeart } from '@/components/gyg/WishHeart';
import { RecordView } from '@/components/gyg/RecordView';
import { Gallery } from '@/components/gyg/detail/Gallery';
import { BookingWidget } from '@/components/gyg/detail/BookingWidget';
import { BookingProvider } from '@/components/gyg/detail/BookingProvider';
import { MobileBookBar } from '@/components/gyg/detail/MobileBookBar';
import { BookingOptionCard } from '@/components/gyg/detail/BookingOptionCard';
import { ItineraryBuilder } from '@/components/gyg/detail/ItineraryBuilder';
import { SeeMore } from '@/components/gyg/detail/SeeMore';
import { ShareButton } from '@/components/gyg/detail/ShareButton';
import {
  LovedBanner,
  SightseeingHighlights,
  Overview,
  Itinerary,
  Includes,
} from '@/components/gyg/detail/Sections';
import { QuickFacts } from '@/components/gyg/detail/QuickFacts';
import { PriceListViewer } from '@/components/gyg/detail/PriceListViewer';
import { LocationMap } from '@/components/maps/LocationMap';
import { ReviewList } from '@/components/catalogue/ReviewList';
import { SIGHTSEEING_HIGHLIGHTS, SIGHTSEEING_IMPORTANT_INFO } from '@/lib/content/sightseeing';
import { activityRating } from '@/lib/content/activity-reviews';
import { activityReviews } from '@/lib/content/activity-reviews-pool';
import {
  CATAMARAN_WHAT_TO_BRING,
  CATAMARAN_KNOW_BEFORE,
  isCatamaranCruise,
} from '@/lib/content/catamaran';
import { Faq } from '@/components/catalogue/Faq';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { getT } from '@/lib/i18n/server';
import { publicServiceContext } from '@/lib/http/context';
import { getActivity, searchActivities, CATALOGUE_HIDDEN_SLUGS } from '@/lib/services/activities';
import { NotFoundError } from '@/lib/services/errors';
import {
  breadcrumbJsonLd,
  breadcrumbTrail,
  buildFaq,
  relatedActivities,
} from '@/lib/catalogue/detail';
import { productJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';
import type { TourDetail, TourSummary } from '@/lib/validation/tours';
import { IconStar } from '@/components/ui/icons';

export const runtime = 'edge';

const loadActivity = cache(async (slug: string): Promise<TourDetail | null> => {
  try {
    return await getActivity(publicServiceContext(), slug);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    console.error('[activity] fetch failed', error);
    return null;
  }
});

async function loadRelated(activity: TourDetail): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(), {
      page: 1,
      pageSize: 10,
      category: activity.category,
    });
    return relatedActivities(items, activity.slug, 6);
  } catch (error) {
    console.error('[activity] related fetch failed', error);
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const activity = await loadActivity(slug);
  if (!activity) return { title: 'Activity not found' };
  const title = activity.seoTitle ?? `${activity.title} | ${SITE.operator}`;
  const description =
    activity.seoDescription ?? activity.summary ?? activity.description ?? SITE.description;
  const canonical = `/activities/${activity.slug}`;
  const image = activity.heroImage?.url;
  return {
    // `absolute` so the root template doesn't append a SECOND brand (the title already ends in the
    // operator) — that double-brand was pushing tour keywords past SERP truncation.
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `${SITE.url}${canonical}`,
      locale: 'en_GB',
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 mb-4 text-[22px] font-extrabold tracking-tight text-ink">{children}</h2>
  );
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const activity = await loadActivity(slug);
  if (!activity) notFound();
  // Transfers are a separate product line — the generic activity detail page must never render one.
  // Send any /activities/<transfer> hit to the dedicated transfer flow instead.
  if (CATALOGUE_HIDDEN_SLUGS.includes(activity.slug)) redirect('/airport-transfers');

  const t = await getT();
  const related = await loadRelated(activity);
  const trail = breadcrumbTrail(activity);
  const faqs = buildFaq(activity);
  const descriptionParas = (activity.description ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const itinerary = activity.extra.itinerary ?? [];
  const badges = activity.extra.badges ?? [];

  // A "private sightseeing tour" is a vehicle-priced activity. Every one of them shows the same
  // premium highlights, the same know-before-you-go notes (incl. the "bring cash for entrance fees"
  // reminder) and genuine social proof — so the whole range stays consistent regardless of what each
  // tour's admin record happens to carry.
  const isSightseeing = activity.pricingMode === 'vehicle';
  const highlights = isSightseeing ? SIGHTSEEING_HIGHLIGHTS : activity.highlights;
  // Every catamaran cruise shares the same what-to-bring checklist + know-before-you-go notes, so the
  // whole range is consistent (any admin-added notes still merge in, deduped). Mirrors sightseeing.
  const isCatamaran = isCatamaranCruise(activity.category);
  const importantInfo = isSightseeing
    ? [
        ...SIGHTSEEING_IMPORTANT_INFO,
        ...(activity.extra.importantInfo ?? []).filter(
          (i) => !SIGHTSEEING_IMPORTANT_INFO.includes(i),
        ),
      ]
    : isCatamaran
      ? [
          ...CATAMARAN_KNOW_BEFORE,
          ...(activity.extra.importantInfo ?? []).filter((i) => !CATAMARAN_KNOW_BEFORE.includes(i)),
        ]
      : (activity.extra.importantInfo ?? []);
  const whatToBring = isCatamaran
    ? [
        ...CATAMARAN_WHAT_TO_BRING,
        ...(activity.extra.whatToBring ?? []).filter((i) => !CATAMARAN_WHAT_TO_BRING.includes(i)),
      ]
    : (activity.extra.whatToBring ?? []);

  // Reviews + rating: use the tour's own when it has them; otherwise fall back to the operator's real
  // TripAdvisor/Google reviews, picking the ones whose text is RELEVANT to this activity (a catamaran
  // review on a catamaran tour) and the honest aggregate for that topic. The block is labelled as
  // operator-wide reviews below, and the per-product JSON-LD still reads the tour's REAL own rating
  // (productJsonLd), so this visual fallback never inflates the structured aggregateRating.
  const hasOwnReviews = activity.ratingCount > 0;
  const reviewsFallback = !hasOwnReviews;
  const fallbackRating = activityRating(activity);
  const reviews = reviewsFallback ? activityReviews(activity, 9) : activity.reviews;
  const ratingAvg = reviewsFallback ? fallbackRating.avg : activity.ratingAvg;
  const ratingCount = reviewsFallback ? fallbackRating.count : activity.ratingCount;
  const showLoved = ratingAvg != null && ratingAvg >= 4.5 && ratingCount > 0;

  return (
    <>
      <JsonLd data={productJsonLd(activity)} />
      <JsonLd data={breadcrumbJsonLd(activity)} />
      {faqs.length > 0 && <JsonLd data={faqPageJsonLd(faqs)} />}
      <RecordView slug={activity.slug} />
      <GygHeader sticky={false} />

      <main className="bg-white">
        <div className="mx-auto max-w-shell px-6 pb-24 pt-3 lg:pb-16">
          {/* Breadcrumb */}
          <nav
            aria-label={t('Breadcrumb')}
            className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted"
          >
            {trail.map((c) => (
              <span key={c.href} className="flex items-center gap-2">
                <Link href={c.href} className="hover:text-teal">
                  {c.label}
                </Link>
                <span className="text-ink/25">/</span>
              </span>
            ))}
            <span className="font-semibold text-ink">{activity.title}</span>
          </nav>

          {/* Title row */}
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-[clamp(20px,2.3vw,30px)] font-extrabold leading-[1.15] tracking-tight text-ink">
                {activity.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                {ratingCount > 0 ? (
                  <span className="flex items-center gap-1.5 text-ink">
                    <IconStar width={16} height={16} className="text-gold-light" />
                    <b>{ratingAvg?.toFixed(1)}</b>
                    <a
                      href="#reviews"
                      className="font-semibold text-teal underline underline-offset-2"
                    >
                      {t('{n} reviews', { n: ratingCount })}
                    </a>
                  </span>
                ) : (
                  <span className="rounded bg-teal/10 px-2 py-0.5 text-[12px] font-bold text-teal">
                    {t('New activity')}
                  </span>
                )}
                <span aria-hidden className="h-1 w-1 rounded-full bg-ink/20" />
                <span className="text-ink/70">
                  {t('Activity provider:')} <b className="text-ink">{SITE.operator}</b>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex items-center gap-2 rounded-xl border border-ink/14 px-3.5 py-2 text-[13.5px] font-semibold text-ink">
                <WishHeart slug={activity.slug} size={16} className="h-5 w-5 bg-transparent" />{' '}
                {t('Wishlist')}
              </span>
              <ShareButton title={activity.title} />
            </div>
          </div>

          {/* GYG layout: gallery (left, top) + sticky booking (right), content below gallery */}
          <BookingProvider
            activity={{
              slug: activity.slug,
              type: activity.type,
              title: activity.title,
              fromPriceEur: activity.fromPriceEur,
              options: activity.options,
              languages: activity.languages,
              pricingMode: activity.pricingMode,
              vehiclePricing: activity.vehiclePricing ?? null,
              durationMinutes: activity.durationMinutes,
              pickupAvailable: activity.pickupAvailable,
              adultsOnly: activity.extra.adultsOnly ?? false,
              cancellationPolicy: activity.cancellationPolicy,
              minAdvanceDays: activity.minAdvanceDays,
              image: activity.heroImage?.url ?? activity.images[0]?.url ?? null,
              region: activity.region ?? null,
              lat: activity.lat ?? null,
              lng: activity.lng ?? null,
              transportBands: activity.transportBands ?? null,
              regionDistances: activity.regionDistances ?? null,
            }}
          >
            <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_374px] lg:items-start lg:gap-x-8">
              {/* Booking column — first in the DOM, a sibling of the gallery+content column. relative z-30 gives
                it its own stacking context so the calendar popover (floating left over the description) paints
                above the content. On mobile it's ordered LAST (after the content); the sticky MobileBookBar
                carries the mobile CTA. */}
              <aside
                id="book"
                className="relative z-30 order-last mt-8 lg:order-none lg:col-start-2 lg:row-start-1 lg:mb-0 lg:mt-0 lg:sticky lg:top-6"
              >
                <BookingWidget />
              </aside>

              {/* Gallery + ALL content share ONE normal-flow column so the description can NEVER overlap the
                gallery — there is no grid-row boundary between them (that boundary rounded into an overlap on
                some browsers / display scalings). The sticky booking column above spans this column's height. */}
              <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                {activity.images.length > 0 && (
                  <Gallery images={activity.images} title={activity.title} />
                )}
                {activity.summary && (
                  <p className="m-0 mb-6 text-[15px] leading-relaxed text-ink/80">
                    {activity.summary}
                  </p>
                )}

                {activity.pricingMode === 'vehicle' && (
                  <SightseeingHighlights durationMinutes={activity.durationMinutes} />
                )}

                <BookingOptionCard />

                {showLoved && <LovedBanner ratingAvg={ratingAvg} ratingCount={ratingCount} />}

                <QuickFacts
                  durationMinutes={activity.durationMinutes}
                  languages={activity.languages}
                  pickupAvailable={activity.pickupAvailable}
                  type={activity.type}
                  isPrivate={activity.extra.isPrivate ?? false}
                  cancellationPolicy={activity.cancellationPolicy}
                  startWindow={activity.extra.startWindow}
                  badges={badges}
                />

                {(activity.extra.availability || activity.extra.startWindow) && (
                  <section className="mt-8">
                    <SectionTitle>{t('Overview')}</SectionTitle>
                    <Overview durationMinutes={activity.durationMinutes} extra={activity.extra} />
                  </section>
                )}

                {itinerary.length > 0 && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Itinerary')}</SectionTitle>
                    {activity.pricingMode === 'vehicle' && (
                      <Link
                        href={`/ai-road-trip-planner?fromTour=${encodeURIComponent(activity.slug)}`}
                        className="group mb-5 flex items-center gap-3.5 rounded-2xl border border-teal/25 bg-gradient-to-r from-teal/[0.07] to-transparent px-4 py-3.5 transition hover:border-teal/50 hover:from-teal/[0.12]"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-coral">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M12 3l2.3 4.7L19.5 8l-3.7 3.6.9 5.1L12 14.5 7.3 16.7l.9-5.1L4.5 8l5.2-.3L12 3Z"
                              fill="#fff"
                            />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <b className="text-[15px] text-ink">{t('Customize your own tour')}</b>
                            <span className="rounded-full bg-coral/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-coral">
                              {t('AI Planner')}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-ink/70">
                            {t(
                              'Send these stops to the AI Trip Planner — add, drop or reorder them, then get a live quote.',
                            )}
                          </span>
                        </span>
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden
                          className="shrink-0 text-teal transition-transform group-hover:translate-x-0.5"
                        >
                          <path
                            d="M5 12h14M13 6l6 6-6 6"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    )}
                    {itinerary.some((s) => (s.options?.length ?? 0) > 0) ? (
                      <ItineraryBuilder
                        slug={activity.slug}
                        stops={itinerary}
                        meetingPoint={
                          activity.pricingMode === 'vehicle' ? null : activity.meetingPoint
                        }
                      />
                    ) : (
                      <>
                        <Itinerary
                          stops={itinerary}
                          meetingPoint={
                            activity.pricingMode === 'vehicle' ? null : activity.meetingPoint
                          }
                        />
                        <p className="mt-3 text-[12.5px] text-ink-muted">
                          {t('For reference only. Itineraries are subject to change.')}
                        </p>
                      </>
                    )}
                  </section>
                )}

                {highlights.length > 0 && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Highlights')}</SectionTitle>
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {highlights.map((h) => (
                        <li
                          key={h}
                          className="flex items-start gap-3 text-[15px] leading-snug text-ink/85"
                        >
                          <IconStar
                            width={17}
                            height={17}
                            className="mt-0.5 shrink-0 text-gold-light"
                          />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {descriptionParas.length > 0 && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Full description')}</SectionTitle>
                    <SeeMore>
                      <div className="flex flex-col gap-3.5">
                        {descriptionParas.map((para, i) => (
                          <p key={i} className="m-0 text-[15px] leading-relaxed text-ink/80">
                            {para}
                          </p>
                        ))}
                      </div>
                    </SeeMore>
                  </section>
                )}

                {activity.extra.priceList?.url?.startsWith('http') && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Price list')}</SectionTitle>
                    <PriceListViewer
                      url={activity.extra.priceList.url}
                      label={activity.extra.priceList.label ?? null}
                    />
                  </section>
                )}

                {(activity.inclusions.length > 0 || activity.exclusions.length > 0) && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Includes')}</SectionTitle>
                    <Includes inclusions={activity.inclusions} exclusions={activity.exclusions} />
                  </section>
                )}

                {(activity.meetingPoint || importantInfo.length > 0 || whatToBring.length > 0) && (
                  <section className="mt-8 border-t border-ink/10 pt-7">
                    <SectionTitle>{t('Important information')}</SectionTitle>
                    {activity.meetingPoint && (
                      <p className="m-0 mb-3 text-[14.5px] text-ink/80">
                        <b className="text-ink">{t('Meeting point / pickup:')}</b>{' '}
                        {activity.meetingPoint}
                      </p>
                    )}
                    {/* Sightseeing (vehicle) tours pick the customer up wherever they choose (set in the
                      checkout flow), so a fixed meeting-point map is misleading/unnecessary here — the
                      "pickup across Mauritius" line above already says it. Other activities keep the map. */}
                    {activity.pricingMode !== 'vehicle' &&
                      (activity.location || activity.meetingPoint) && (
                        <div className="mb-4">
                          {/* Geocode the SAME string we caption (meeting point first): the meeting
                              point is the concrete pickup and geocodes precisely, whereas `location`
                              is often a broad region ("East") that resolves to the island centroid —
                              which dropped the pin miles from the captioned address. */}
                          <LocationMap
                            query={activity.meetingPoint || activity.location || activity.title}
                            label={activity.meetingPoint || activity.location || undefined}
                          />
                        </div>
                      )}
                    {whatToBring.length > 0 && (
                      <div className="mb-5">
                        <SeeMore>
                          <div className="text-[14px] font-bold text-ink">{t('What to bring')}</div>
                          <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
                            {whatToBring.map((item) => (
                              <li
                                key={item}
                                className="flex items-start gap-2.5 text-[14px] leading-snug text-ink/80"
                              >
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                                {t(item)}
                              </li>
                            ))}
                          </ul>
                        </SeeMore>
                      </div>
                    )}
                    {importantInfo.length > 0 && (
                      <SeeMore>
                        <div className="text-[14px] font-bold text-ink">
                          {t('Know before you go')}
                        </div>
                        <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
                          {importantInfo.map((info) => (
                            <li
                              key={info}
                              className="flex items-start gap-2.5 text-[14px] leading-snug text-ink/80"
                            >
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                              {info}
                            </li>
                          ))}
                        </ul>
                      </SeeMore>
                    )}
                  </section>
                )}

                <section id="reviews" className="mt-8 scroll-mt-24 border-t border-ink/10 pt-7">
                  <SectionTitle>{t('Guest reviews')}</SectionTitle>
                  {reviewsFallback && (
                    <p className="m-0 mb-4 text-[13.5px] text-ink-muted">
                      {t('Reviews from guests across our private tours and transfers.')}
                    </p>
                  )}
                  <ReviewList ratingAvg={ratingAvg} ratingCount={ratingCount} reviews={reviews} />
                </section>

                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>{t('Frequently asked questions')}</SectionTitle>
                  <Faq items={faqs} />
                </section>
              </div>
            </div>
            <MobileBookBar />
          </BookingProvider>

          {related.length > 0 && (
            <section className="mt-12 border-t border-ink/10 pt-8">
              <SectionTitle>{t('You might also like')}</SectionTitle>
              <Rail ariaLabel={t('You might also like')}>
                {related.map((item) => (
                  <PlaceCard key={item.id} activity={item} rail />
                ))}
              </Rail>
            </section>
          )}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
