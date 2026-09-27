import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { PhotoHeroCollage } from './PhotoHeroCollage';
import { PhotoPackagesSection, type V3PackageTab } from './PhotoPackagesSection';
import { PhotoGalleryMasonry, type V3GalleryItem } from './PhotoGalleryMasonry';
import {
  buildGalleryItems,
  buildHeroSlides,
  buildV3Packages,
  loadPhotographyBestSellers,
  loadPhotographyExtras,
  loadPhotographyGroups,
  loadPhotographyPackages,
} from './packages-data';
import { activityReviews } from '@/lib/content/activity-reviews-pool';
import {
  GALLERY_TAGS,
  PHOTOGRAPHY_CATEGORY,
  PHOTOGRAPHY_DEPOSIT_PERCENT,
  PHOTOGRAPHY_OCCASIONS,
  type GalleryTag,
  type PhotographyOccasion,
} from '@/lib/catalogue/photography';
import { breadcrumbListJsonLd, itemListJsonLd, serviceJsonLd } from '@/lib/seo/jsonld';
import { getLocale, getT } from '@/lib/i18n/server';
import { formatLocaleDate } from '@/lib/i18n/format';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { getWhatsAppNumber } from '@/lib/settings/whatsapp-number';
import { SITE, whatsappUrl } from '@/lib/seo/site';

/** Both photography entry URLs share the same v3 home screen. */
export async function PhotographyPricingPage({
  path,
}: {
  path: '/photography' | '/photography/packages';
}) {
  const t = await getT();
  const locale = await getLocale();
  const [live, photos, waNumber, groups, bestSellers, extras] = await Promise.all([
    loadPhotographyPackages(),
    getPhotographyPhotos(),
    getWhatsAppNumber(),
    loadPhotographyGroups(),
    loadPhotographyBestSellers(),
    loadPhotographyExtras(),
  ]);
  const packages = buildV3Packages(t, live, waNumber, groups, bestSellers, extras);
  const contact = whatsappUrl(
    `Hi ${SITE.operator}! I’d like help choosing a photography package in Mauritius.`,
    waNumber,
  );

  // Hero: gallery photos (owner-managed, else stock) pinned to the best-matching live package.
  const occasionLabels = Object.fromEntries(
    PHOTOGRAPHY_OCCASIONS.map(([id, label]) => [id, t(label)]),
  ) as Record<PhotographyOccasion, string>;
  const heroSlides = buildHeroSlides(t, photos, packages, occasionLabels);
  const minPrice = (group: 'shoots' | 'weddings') => {
    const prices = packages.filter((p) => p.group === group && p.priceEur != null);
    return prices.length ? Math.min(...prices.map((p) => p.priceEur!)) : null;
  };
  const fromLine = (group: 'shoots' | 'weddings') => {
    const min = minPrice(group);
    return min != null ? t('from €{n}', { n: Math.round(min) }) : null;
  };
  const tabs: V3PackageTab[] = [
    { id: 'shoots', label: t('Photoshoots'), fromLine: fromLine('shoots') },
    { id: 'weddings', label: t('Weddings'), fromLine: fromLine('weddings') },
  ];

  // Recent shoots: the real gallery, spans by aspect so the dense grid reads as a contact sheet.
  const tagLabel: Record<GalleryTag, string> = {
    weddings: t('wedding'),
    films: t('film'),
    couples: t('couple'),
    family: t('family'),
  };
  const galleryItems: V3GalleryItem[] = buildGalleryItems(t, photos)
    .slice(0, 12)
    .map((item) => ({
      key: String(item.key),
      src: item.thumb ?? item.src,
      alt: item.alt,
      tag: item.categories[0] ?? null,
      tall: item.aspect === 'aspect-[4/5]' || item.aspect === 'aspect-[3/4]',
      wide: item.aspect === 'aspect-video',
    }));

  // Testimonials: the operator's real TripAdvisor/Google reviews (the same pool the tour pages
  // draw from), newest relevant ones — never invented quotes.
  const reviews = activityReviews(
    { category: PHOTOGRAPHY_CATEGORY, slug: 'photography' },
    3,
  ).filter((r) => r.text && r.text.trim().length > 0);

  const heroFrom = minPrice('shoots') ?? 150;
  const heroStats = [
    [t('From €{n}', { n: Math.round(heroFrom) }), t('45 minutes to 3 hours')],
    [t('{pct}% deposit', { pct: PHOTOGRAPHY_DEPOSIT_PERCENT }), t('Holds your date')],
    [t('Rain? We reschedule'), t('Free, any day of your stay')],
    [t('Photos in 72 hours'), t('Private online gallery')],
  ] as const;

  const steps = [
    [
      t('Reserve your date'),
      t(
        'Pay the {pct}% deposit online. Your photographer is confirmed on WhatsApp within the hour.',
        { pct: PHOTOGRAPHY_DEPOSIT_PERCENT },
      ),
    ],
    [
      t('Get your style guide'),
      t('What to wear, where to meet, and the exact time the light is best that day.'),
    ],
    [
      t('Enjoy the shoot'),
      t('No posing experience needed. We guide every moment and keep it relaxed.'),
    ],
    [
      t('Receive your photos'),
      t('Edited photos and reels in a private gallery, ready to download and share.'),
    ],
  ] as const;

  const faqs = [
    [
      t('What if it rains?'),
      t(
        'Tropical showers usually pass within the hour. If the weather isn’t right, we move your shoot to another day of your stay at no cost.',
      ),
    ],
    [
      t('What should we wear?'),
      t(
        'Light, flowing fabrics in soft or neutral colours work best on the beach. After booking we send a short style guide.',
      ),
    ],
    [
      t('When do we get our photos?'),
      t(
        'Your private gallery arrives in 72 hours to 5 days depending on the shoot. Reels are delivered with the photos.',
      ),
    ],
    [
      t('Can you come to our hotel?'),
      t(
        'Yes, hotel shoots cost nothing extra. For Le Morne and Île aux Cerfs we arrange transport, included in Island Signature.',
      ),
    ],
    [
      t('We’re not used to being photographed.'),
      t('Most of our clients aren’t. Your photographer guides every pose and keeps it relaxed.'),
    ],
  ] as const;

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Photography'), path: '/photography' },
          ...(path === '/photography/packages' ? [{ name: t('Packages & prices'), path }] : []),
        ])}
      />
      {live.length > 0 && (
        <JsonLd
          data={itemListJsonLd(live.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })))}
        />
      )}
      <JsonLd
        data={serviceJsonLd({
          serviceType: 'Photographer',
          name: t('Photography & film · Mauritius'),
          description: t(
            'Photography packages for weddings, couples and family holidays in Mauritius.',
          ),
          path,
          offers: live.map((a) => ({
            name: a.title,
            path: `/activities/${a.slug}`,
            priceEur: a.fromPriceEur,
          })),
        })}
      />
      <GygHeader />
      <main className="bg-white text-ink">
        {/* Hero — copy left, rotating collage right (stacks below on mobile) */}
        <section className="mx-auto grid max-w-[1240px] items-center gap-10 px-6 py-12 sm:px-8 sm:py-16 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-7">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal">
              {t('Photography · Mauritius')}
            </p>
            <h1 className="text-balance text-[clamp(42px,5.6vw,74px)] font-bold leading-[1.02] tracking-[-0.035em]">
              {t('Your holiday, in the')}{' '}
              <em className="not-italic text-teal">{t('best light')}</em> {t('on the island.')}
            </h1>
            <p className="max-w-[480px] text-lg leading-relaxed text-ink-muted">
              {t(
                'Photoshoots and weddings with local photographers who know where the light lands, every month of the year.',
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="#packages"
                className="rounded-full bg-teal px-7 py-4 text-base font-bold text-white transition hover:bg-teal-dark"
              >
                {t('See the shoots')}
              </a>
              <a
                href={contact}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border-[1.5px] border-ink px-6 py-[14.5px] text-base font-bold text-ink transition hover:bg-ink hover:text-white"
              >
                {t('Ask on WhatsApp')}
              </a>
            </div>
            <div className="grid max-w-[520px] grid-cols-2 gap-x-6 gap-y-3.5 border-t border-ink/10 pt-6">
              {heroStats.map(([b, s]) => (
                <div key={s} className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold">{b}</span>
                  <span className="text-[13px] text-ink-muted">{s}</span>
                </div>
              ))}
            </div>
          </div>
          <PhotoHeroCollage slides={heroSlides} viewLabel={t('View ›')} />
        </section>

        {/* Packages — tabs + occasion chips + the design's cards */}
        <section id="packages" className="scroll-mt-24 border-y border-ink/10 bg-white">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-9 px-6 py-16 sm:px-8 sm:py-20">
            <PhotoPackagesSection
              eyebrow={t('Choose your shoot')}
              headingLead={t('What are we')}
              headingAccent={t('celebrating?')}
              tabs={tabs}
              occasions={[
                { id: 'all', label: t('All shoots') },
                ...PHOTOGRAPHY_OCCASIONS.map(([id, label]) => ({ id, label: t(label) })),
              ]}
              weddingIntro={t(
                'Elopements to full wedding days, at your hotel or on the beach. Every wedding includes a planning call and a sneak peek within 48 hours.',
              )}
              packages={packages}
              labels={{
                mostBooked: t('Most booked'),
                from: t('From'),
                priceOnRequest: t('Price on request'),
                checkDates: t('Check dates'),
              }}
            />
          </div>
        </section>

        {/* From booking to gallery — the 50% deposit lives in step 1 */}
        <section className="bg-teal-tint">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 py-16 sm:px-8 sm:py-20">
            <h2 className="text-[clamp(28px,3.4vw,42px)] font-bold leading-[1.1] tracking-[-0.03em]">
              {t('From booking to gallery')}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-8">
              {steps.map(([title, body], i) => (
                <div key={title} className="flex flex-col gap-2.5 border-t-2 border-ink pt-[18px]">
                  <span className="text-3xl font-bold leading-none text-teal">{i + 1}</span>
                  <h3 className="text-lg font-bold">{title}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Recent shoots — the real gallery in a dense, filterable masonry */}
        <section className="mx-auto flex max-w-[1240px] flex-col gap-8 px-6 py-16 sm:px-8 sm:py-20">
          <PhotoGalleryMasonry
            items={galleryItems}
            filters={[
              { id: 'all', label: t('All') },
              ...GALLERY_TAGS.map((tag) => ({ id: tag, label: tagLabel[tag] })),
            ]}
            seeAllHref="/photography/gallery"
            seeAllLabel={t('See the full gallery')}
          />
        </section>

        {/* Testimonials — real operator reviews from the same pool the tour pages use */}
        {reviews.length > 0 && (
          <section className="border-y border-ink/10 bg-white">
            <div className="mx-auto flex max-w-[1240px] flex-col gap-10 px-6 py-16 sm:px-8 sm:py-20">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <h2 className="text-[clamp(28px,3.4vw,42px)] font-bold leading-[1.1] tracking-[-0.03em]">
                  {t('What couples and families say')}
                </h2>
                <span className="text-[15px] font-semibold text-ink-muted">
                  {t('Reviews from guests across our private tours and transfers.')}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
                {reviews.map((r) => (
                  <figure
                    key={r.id}
                    className="flex flex-col gap-5 rounded-[18px] bg-[#F5F7F7] p-7"
                  >
                    <blockquote className="text-lg font-medium leading-relaxed text-ink">
                      “{r.text}”
                    </blockquote>
                    <figcaption className="mt-auto text-sm text-ink-muted">
                      <strong className="text-ink">{r.author}</strong> ·{' '}
                      {formatLocaleDate(r.createdAt, locale, { month: 'short', year: 'numeric' })}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mx-auto flex max-w-[900px] flex-col gap-7 px-6 py-16 sm:px-8 sm:py-20">
          <h2 className="text-[clamp(28px,3.4vw,42px)] font-bold leading-[1.1] tracking-[-0.03em]">
            {t('Questions before you book')}
          </h2>
          <div className="flex flex-col border-t border-ink/10">
            {faqs.map(([q, a]) => (
              <details key={q} className="group border-b border-ink/10">
                <summary className="flex w-full cursor-pointer list-none items-center justify-between gap-4 py-[22px] text-left text-lg font-bold text-ink [&::-webkit-details-marker]:hidden">
                  <span>{q}</span>
                  <span className="flex-none text-2xl font-normal text-teal transition duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-[90%] pb-6 text-base leading-relaxed text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA band */}
        <section className="px-6 pb-16 sm:px-8 sm:pb-20">
          <div className="mx-auto flex max-w-[1176px] flex-wrap items-center justify-between gap-8 rounded-3xl bg-teal p-8 text-white sm:p-14">
            <div className="flex max-w-[620px] flex-col gap-3">
              <h2 className="text-[clamp(26px,3.2vw,40px)] font-bold leading-[1.1] tracking-[-0.03em]">
                {t('Not sure which shoot?')}
              </h2>
              <p className="text-[17px] leading-relaxed">
                {t(
                  'Send us your dates and hotel. We’ll reply with the best spot and time for your stay.',
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={contact}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-white px-6 py-4 text-base font-bold text-ink transition hover:bg-white/90"
              >
                {t('Message us on WhatsApp')}
              </a>
              <a
                href="#packages"
                className="rounded-full border-[1.5px] border-white px-[22px] py-[14.5px] text-base font-bold text-white transition hover:bg-white/10"
              >
                {t('See the shoots')}
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
