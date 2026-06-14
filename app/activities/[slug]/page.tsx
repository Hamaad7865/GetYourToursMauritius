import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Breadcrumb } from '@/components/catalogue/Breadcrumb';
import { Gallery } from '@/components/catalogue/Gallery';
import { BookingPanel } from '@/components/catalogue/BookingPanel';
import { ReviewList } from '@/components/catalogue/ReviewList';
import { Faq } from '@/components/catalogue/Faq';
import { ActivityCard } from '@/components/catalogue/ActivityCard';
import { JsonLd } from '@/components/seo/JsonLd';
import { publicServiceContext } from '@/lib/http/context';
import { getActivity, searchActivities } from '@/lib/services/activities';
import { NotFoundError } from '@/lib/services/errors';
import {
  breadcrumbJsonLd,
  breadcrumbTrail,
  buildFaq,
  durationLabel,
  quickFacts,
  relatedActivities,
} from '@/lib/catalogue/detail';
import { productJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';
import type { TourDetail, TourSummary } from '@/lib/validation/tours';
import {
  IconCheck,
  IconPin,
  IconStar,
  IconTag,
  IconX,
} from '@/components/ui/icons';

export const runtime = 'edge';

// Deduped per request so generateMetadata and the page share a single RPC round-trip.
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
      pageSize: 8,
      category: activity.category,
    });
    return relatedActivities(items, activity.slug, 3);
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
      alternateLocale: 'fr_FR',
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="m-0 mb-4 font-display text-2xl font-medium tracking-tight text-ink">
      {children}
    </h2>
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

  const related = await loadRelated(activity);
  const trail = breadcrumbTrail(activity);
  const facts = quickFacts(activity);
  const faqs = buildFaq(activity);
  const duration = durationLabel(activity.durationMinutes);
  const descriptionParas = (activity.description ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const topRated = activity.ratingAvg != null && activity.ratingAvg >= 4.7;

  return (
    <>
      <JsonLd data={productJsonLd(activity)} />
      <JsonLd data={breadcrumbJsonLd(activity)} />
      <SiteHeader />

      <main className="mx-auto max-w-shell px-6 pb-16 pt-6">
        <Breadcrumb trail={trail} current={activity.title} />

        {/* Title row */}
        <div className="mb-5">
          <h1 className="m-0 max-w-[22ch] text-balance font-display text-[clamp(28px,4vw,42px)] font-medium leading-[1.08] tracking-tight text-ink">
            {activity.title}
          </h1>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5 text-ink">
              <IconStar width={16} height={16} className="text-gold-light" />
              <b>{activity.ratingAvg?.toFixed(1) ?? '—'}</b>
              {activity.ratingCount > 0 && (
                <a href="#reviews" className="font-semibold text-teal underline underline-offset-2">
                  {activity.ratingCount} reviews
                </a>
              )}
            </span>
            <span aria-hidden className="h-1 w-1 rounded-full bg-ink/20" />
            <span className="flex items-center gap-1.5 text-ink/70">
              Operated by <b className="text-ink">{SITE.operator}</b>
            </span>
            {topRated && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1 text-xs font-bold text-white">
                <IconStar width={12} height={12} /> Top rated
              </span>
            )}
            {activity.location && (
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal">
                <IconPin width={14} height={14} /> {activity.location}
              </span>
            )}
          </div>
        </div>

        {/* Photo + content + sticky panel */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_384px] lg:items-start lg:gap-x-10">
          <div className="lg:col-start-1 lg:row-start-1">
            <Gallery images={activity.images} title={activity.title} />
          </div>

          <aside className="mb-7 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mb-0 lg:sticky lg:top-[88px]">
            <BookingPanel
              type={activity.type}
              title={activity.title}
              fromPriceEur={activity.fromPriceEur}
              options={activity.options}
              languages={activity.languages}
            />
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            {/* Intro */}
            {activity.summary && (
              <p className="m-0 mb-6 text-base leading-relaxed text-ink/80">{activity.summary}</p>
            )}

            {/* Quick facts */}
            {facts.length > 0 && (
              <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-start gap-2.5 rounded-[14px] border border-ink/[0.08] bg-white p-3.5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-teal/10 text-teal">
                      <IconCheck width={18} height={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold leading-tight text-ink">
                        {fact.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{fact.sub}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Highlights */}
            {activity.highlights.length > 0 && (
              <section className="mb-8">
                <SectionTitle>Highlights</SectionTitle>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {activity.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-3 text-[15px] leading-snug text-ink/80">
                      <IconCheck width={18} height={18} className="mt-0.5 shrink-0 text-teal" />
                      {h}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Description */}
            {descriptionParas.length > 0 && (
              <section className="mb-8 border-t border-ink/10 pt-7">
                <SectionTitle>About this experience</SectionTitle>
                <div className="flex flex-col gap-3.5">
                  {descriptionParas.map((para, i) => (
                    <p key={i} className="m-0 text-[15px] leading-relaxed text-ink/80">
                      {para}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {/* Included / not included */}
            {(activity.inclusions.length > 0 || activity.exclusions.length > 0) && (
              <section className="mb-8 border-t border-ink/10 pt-7">
                <SectionTitle>What&apos;s included</SectionTitle>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-7">
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {activity.inclusions.map((it) => (
                      <li
                        key={it}
                        className="flex items-start gap-3 text-[14.5px] leading-snug text-ink/80"
                      >
                        <IconCheck width={17} height={17} className="mt-0.5 shrink-0 text-teal" />
                        {it}
                      </li>
                    ))}
                  </ul>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {activity.exclusions.map((ex) => (
                      <li
                        key={ex}
                        className="flex items-start gap-3 text-[14.5px] leading-snug text-ink-muted"
                      >
                        <IconX width={17} height={17} className="mt-0.5 shrink-0 text-coral" />
                        {ex}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* Meeting point */}
            {activity.meetingPoint && (
              <section className="mb-8 border-t border-ink/10 pt-7">
                <SectionTitle>
                  {activity.pickupAvailable ? 'Pickup & meeting point' : 'Meeting point'}
                </SectionTitle>
                <p className="m-0 mb-4 text-[15px] leading-relaxed text-ink/80">
                  {activity.meetingPoint}
                </p>
                <div className="relative h-[180px] overflow-hidden rounded-2xl border border-ink/10 bg-[linear-gradient(135deg,#cfe6e3,#aed4d4)]">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-50"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(0deg,rgba(255,255,255,.4) 0 1px,transparent 1px 40px),repeating-linear-gradient(90deg,rgba(255,255,255,.4) 0 1px,transparent 1px 40px)',
                    }}
                  />
                  <div className="absolute bottom-3.5 left-3.5 flex max-w-[88%] items-center gap-2 rounded-[11px] bg-white/95 px-3 py-2 text-[12.5px] font-semibold text-ink">
                    <IconPin width={15} height={15} className="text-coral" />
                    <span className="truncate">{activity.meetingPoint}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Options & pricing */}
            {activity.options.length > 0 && (
              <section className="mb-8 border-t border-ink/10 pt-7">
                <SectionTitle>
                  {activity.type === 'transport' ? 'Vehicles & pricing' : 'Options & pricing'}
                </SectionTitle>
                <div className="flex flex-col gap-3">
                  {activity.options.map((option) => (
                    <div
                      key={option.id}
                      className="rounded-[14px] border border-ink/[0.08] bg-white p-4"
                    >
                      <div className="flex items-center gap-2 text-[15px] font-bold text-ink">
                        <IconTag width={16} height={16} className="text-teal" />
                        {option.name}
                      </div>
                      {option.description && (
                        <p className="mt-1 text-[13.5px] leading-snug text-ink-muted">
                          {option.description}
                        </p>
                      )}
                      {option.prices.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {option.prices.map((price) => (
                            <span
                              key={price.id}
                              className="rounded-full border border-ink/10 bg-cream px-3 py-1.5 text-[13px] text-ink"
                            >
                              {price.label}{' '}
                              <b className="text-ink">€{price.amountEur}</b>
                              {price.maxGuests != null && (
                                <span className="text-ink-muted"> · up to {price.maxGuests}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Reviews */}
            <section id="reviews" className="mb-8 scroll-mt-24 border-t border-ink/10 pt-7">
              <SectionTitle>Guest reviews</SectionTitle>
              <ReviewList
                ratingAvg={activity.ratingAvg}
                ratingCount={activity.ratingCount}
                reviews={activity.reviews}
              />
            </section>

            {/* FAQ */}
            <section className="mb-8 border-t border-ink/10 pt-7">
              <SectionTitle>Frequently asked questions</SectionTitle>
              <Faq items={faqs} />
            </section>

            {/* Duration footnote when present but no facts shown it */}
            {duration && facts.length === 0 && (
              <p className="text-sm text-ink-muted">Duration: {duration}</p>
            )}
          </div>
        </div>

        {/* You might also like */}
        {related.length > 0 && (
          <section className="mt-4 border-t border-ink/10 pt-8">
            <SectionTitle>You might also like</SectionTitle>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item) => (
                <ActivityCard key={item.id} activity={item} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
