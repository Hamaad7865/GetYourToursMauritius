import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { Rail } from '@/components/gyg/Rail';
import { PlaceCard } from '@/components/gyg/PlaceCard';
import { WishHeart } from '@/components/gyg/WishHeart';
import { RecordView } from '@/components/gyg/RecordView';
import { Gallery } from '@/components/gyg/detail/Gallery';
import { BookingWidget } from '@/components/gyg/detail/BookingWidget';
import { VehicleOptionCard } from '@/components/gyg/detail/VehicleOptionCard';
import { ItineraryBuilder } from '@/components/gyg/detail/ItineraryBuilder';
import { SeeMore } from '@/components/gyg/detail/SeeMore';
import { ShareButton } from '@/components/gyg/detail/ShareButton';
import { QuickFacts, Overview, Itinerary, Includes } from '@/components/gyg/detail/Sections';
import { LocationMap } from '@/components/maps/LocationMap';
import { ReviewList } from '@/components/catalogue/ReviewList';
import { Faq } from '@/components/catalogue/Faq';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { publicServiceContext } from '@/lib/http/context';
import { getActivity, searchActivities } from '@/lib/services/activities';
import { NotFoundError } from '@/lib/services/errors';
import { breadcrumbJsonLd, breadcrumbTrail, buildFaq, durationLabel, relatedActivities } from '@/lib/catalogue/detail';
import { productJsonLd } from '@/lib/seo/jsonld';
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
    title,
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
  return <h2 className="m-0 mb-4 text-[22px] font-extrabold tracking-tight text-ink">{children}</h2>;
}

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const activity = await loadActivity(slug);
  if (!activity) notFound();

  const related = await loadRelated(activity);
  const trail = breadcrumbTrail(activity);
  const faqs = buildFaq(activity);
  const descriptionParas = (activity.description ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const itinerary = activity.extra.itinerary ?? [];
  const optionalStops = activity.extra.optionalStops ?? [];
  const importantInfo = activity.extra.importantInfo ?? [];

  return (
    <>
      <JsonLd data={productJsonLd(activity)} />
      <JsonLd data={breadcrumbJsonLd(activity)} />
      <RecordView slug={activity.slug} />
      <GygHeader sticky={false} />

      <main className="bg-white">
        <div className="mx-auto max-w-shell px-6 pb-16 pt-3">
          {/* Breadcrumb */}
          <nav
            aria-label="Breadcrumb"
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
                {activity.ratingCount > 0 ? (
                  <span className="flex items-center gap-1.5 text-ink">
                    <IconStar width={16} height={16} className="text-gold-light" />
                    <b>{activity.ratingAvg?.toFixed(1)}</b>
                    <a href="#reviews" className="font-semibold text-teal underline underline-offset-2">
                      {activity.ratingCount} reviews
                    </a>
                  </span>
                ) : (
                  <span className="rounded bg-teal/10 px-2 py-0.5 text-[12px] font-bold text-teal">
                    New activity
                  </span>
                )}
                <span aria-hidden className="h-1 w-1 rounded-full bg-ink/20" />
                <span className="text-ink/70">
                  Activity provider: <b className="text-ink">{SITE.operator}</b>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="flex items-center gap-2 rounded-xl border border-ink/14 px-3.5 py-2 text-[13.5px] font-semibold text-ink">
                <WishHeart slug={activity.slug} size={16} className="h-5 w-5 bg-transparent" /> Wishlist
              </span>
              <ShareButton title={activity.title} />
            </div>
          </div>

          {/* GYG layout: gallery (left, top) + sticky booking (right), content below gallery */}
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_374px] lg:items-start lg:gap-x-8">
            <div className="lg:col-start-1 lg:row-start-1">
              {activity.images.length > 0 && (
                <Gallery images={activity.images} title={activity.title} />
              )}
            </div>

            <aside id="book" className="mb-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mb-0 lg:sticky lg:top-6">
              <BookingWidget
                slug={activity.slug}
                type={activity.type}
                fromPriceEur={activity.fromPriceEur}
                options={activity.options}
                languages={activity.languages}
                title={activity.title}
                pricingMode={activity.pricingMode}
                vehiclePricing={activity.vehiclePricing}
                image={activity.heroImage?.url ?? activity.images[0]?.url ?? null}
              />
            </aside>

            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              {activity.summary && (
                <p className="m-0 mb-6 text-[15px] leading-relaxed text-ink/80">
                  {activity.summary}
                </p>
              )}

              {activity.pricingMode === 'vehicle' && activity.vehiclePricing && (
                <div className="mb-6">
                  <VehicleOptionCard
                    title={activity.title}
                    cfg={activity.vehiclePricing}
                    durationLabel={durationLabel(activity.durationMinutes)}
                    pickupAvailable={activity.pickupAvailable}
                    languages={activity.languages}
                  />
                </div>
              )}

              <QuickFacts
                durationMinutes={activity.durationMinutes}
                languages={activity.languages}
                pickupAvailable={activity.pickupAvailable}
                type={activity.type}
                cancellationPolicy={activity.cancellationPolicy}
                ratingAvg={activity.ratingAvg}
                ratingCount={activity.ratingCount}
                startWindow={activity.extra.startWindow}
              />

              {(activity.extra.availability || activity.extra.startWindow) && (
                <section className="mt-8">
                  <SectionTitle>Overview</SectionTitle>
                  <Overview durationMinutes={activity.durationMinutes} extra={activity.extra} />
                </section>
              )}

              {(itinerary.length > 0 || optionalStops.length > 0) && (
                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>Itinerary</SectionTitle>
                  {optionalStops.length > 0 ? (
                    <ItineraryBuilder
                      slug={activity.slug}
                      defaultStops={itinerary}
                      optionalStops={optionalStops}
                      maxStops={activity.extra.maxStops}
                    />
                  ) : (
                    <>
                      <Itinerary stops={itinerary} meetingPoint={activity.meetingPoint} />
                      <p className="mt-3 text-[12.5px] text-ink-muted">
                        For reference only. Itineraries are subject to change.
                      </p>
                    </>
                  )}
                </section>
              )}

              {activity.highlights.length > 0 && (
                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>Highlights</SectionTitle>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {activity.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-3 text-[15px] leading-snug text-ink/85">
                        <IconStar width={17} height={17} className="mt-0.5 shrink-0 text-gold-light" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {descriptionParas.length > 0 && (
                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>Full description</SectionTitle>
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

              {(activity.inclusions.length > 0 || activity.exclusions.length > 0) && (
                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>Includes</SectionTitle>
                  <Includes inclusions={activity.inclusions} exclusions={activity.exclusions} />
                </section>
              )}

              {(activity.meetingPoint || importantInfo.length > 0) && (
                <section className="mt-8 border-t border-ink/10 pt-7">
                  <SectionTitle>Important information</SectionTitle>
                  {activity.meetingPoint && (
                    <p className="m-0 mb-3 text-[14.5px] text-ink/80">
                      <b className="text-ink">Meeting point / pickup:</b> {activity.meetingPoint}
                    </p>
                  )}
                  {(activity.location || activity.meetingPoint) && (
                    <div className="mb-4">
                      <LocationMap
                        query={activity.location || activity.meetingPoint || activity.title}
                        label={activity.meetingPoint || activity.location || undefined}
                      />
                    </div>
                  )}
                  {importantInfo.length > 0 && (
                    <SeeMore>
                      <div className="text-[14px] font-bold text-ink">Know before you go</div>
                      <ul className="m-0 mt-2 flex list-none flex-col gap-2.5 p-0">
                        {importantInfo.map((info) => (
                          <li key={info} className="flex items-start gap-2.5 text-[14px] leading-snug text-ink/80">
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
                <SectionTitle>Guest reviews</SectionTitle>
                <ReviewList
                  ratingAvg={activity.ratingAvg}
                  ratingCount={activity.ratingCount}
                  reviews={activity.reviews}
                />
              </section>

              <section className="mt-8 border-t border-ink/10 pt-7">
                <SectionTitle>Frequently asked questions</SectionTitle>
                <Faq items={faqs} />
              </section>
            </div>
          </div>

          {related.length > 0 && (
            <section className="mt-12 border-t border-ink/10 pt-8">
              <SectionTitle>You might also like</SectionTitle>
              <Rail ariaLabel="You might also like">
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
