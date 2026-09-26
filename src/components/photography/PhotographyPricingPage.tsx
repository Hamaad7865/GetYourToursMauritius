import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { PricingGuideCard } from './PricingGuideCard';
import {
  buildGalleryItems,
  buildPackageCards,
  loadPhotographyBestSellers,
  loadPhotographyGroups,
  loadPhotographyPackages,
} from './packages-data';
import { breadcrumbListJsonLd, itemListJsonLd, serviceJsonLd } from '@/lib/seo/jsonld';
import { getT } from '@/lib/i18n/server';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { getWhatsAppNumber } from '@/lib/settings/whatsapp-number';
import { slotUrl, type GalleryTag } from '@/lib/catalogue/photography';
import { SITE, whatsappUrl } from '@/lib/seo/site';

/** Both photography entry URLs share the same compact package catalogue. */
export async function PhotographyPricingPage({
  path,
}: {
  path: '/photography' | '/photography/packages';
}) {
  const t = await getT();
  const [live, photos, waNumber, groups, bestSellers] = await Promise.all([
    loadPhotographyPackages(),
    getPhotographyPhotos(),
    getWhatsAppNumber(),
    loadPhotographyGroups(),
    loadPhotographyBestSellers(),
  ]);
  const packages = buildPackageCards(t, live, waNumber, groups, bestSellers);
  const gallery = buildGalleryItems(t, photos);
  const contact = whatsappUrl(
    `Hi ${SITE.operator}! I’d like help choosing a photography package in Mauritius.`,
    waNumber,
  );
  // Literal t() calls (not the dynamic map key) so the i18n scanner can find every source string.
  const groupLabel = { weddings: t('Weddings'), shoots: t('Photoshoots') } as const;
  const tagLabel: Record<GalleryTag, string> = {
    weddings: t('wedding'),
    films: t('film'),
    couples: t('couple'),
    family: t('family'),
  };

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
        {/* Compact light hero — the packages below are the star */}
        <section className="mx-auto grid max-w-shell items-center gap-10 px-6 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">
              {t('Photography & film · Mauritius')}
            </p>
            <h1 className="mt-4 text-balance text-[clamp(34px,4.6vw,58px)] font-extrabold leading-[1.04] tracking-tight">
              {t('Photoshoot packages in Mauritius')}
            </h1>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
              {t('Choose your shoot. Pick a date. We will take care of the photos.')}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#packages"
                className="inline-flex items-center gap-2 rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
              >
                {t('See the packages')}
              </a>
              <a
                href={contact}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 bg-white px-7 py-3.5 text-sm font-bold text-ink transition hover:border-teal hover:text-teal-dark"
              >
                {t('Ask us on WhatsApp')}
              </a>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[26px] shadow-[0_30px_70px_-30px_rgba(10,46,54,0.4)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slotUrl(photos, path === '/photography' ? 'hero' : 'pricing-hero')}
              alt=""
              fetchPriority="high"
              className="aspect-[4/3.4] h-full w-full object-cover"
            />
            <div className="absolute bottom-4 left-4 flex max-w-[85%] items-center gap-3 rounded-2xl bg-white/95 p-3.5 shadow-lg backdrop-blur">
              <span aria-hidden className="text-xl">
                📷
              </span>
              <p className="text-xs leading-snug text-ink-muted">
                <b className="block text-[13.5px] text-ink">{t('Your photographer lives here.')}</b>
                {t('We know where the light lands, every month of the year.')}
              </p>
            </div>
          </div>
        </section>

        {/* Packages — the dominant section */}
        <section
          id="packages"
          aria-label={t('Packages & prices')}
          className="mx-auto max-w-shell scroll-mt-24 px-6 pb-16 sm:pb-20"
        >
          <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
                {t('Photography packages')}
              </h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                {t('{n} experiences · 50% deposit holds your date', { n: packages.length })}
              </p>
            </div>
            <Link
              href="/photography/gallery"
              className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 px-5 py-2.5 text-[13.5px] font-bold transition hover:border-teal hover:bg-teal-tint hover:text-teal-dark"
            >
              {t('See the gallery')} →
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {packages.map((pkg) => (
              <PricingGuideCard
                key={pkg.key}
                pkg={pkg}
                groupLabel={groupLabel[pkg.group]}
                fromLabel={t('From')}
                onRequestLabel={t('Price on request')}
                ctaLabel={pkg.external ? t('Enquire') : t('See this package')}
                bestSellerLabel={t('Best seller')}
              />
            ))}
          </div>
        </section>

        {/* Gallery teaser — the full gallery lives on its own page */}
        <section id="gallery" className="scroll-mt-24 border-t border-ink/10 py-14 sm:py-16">
          <div className="mx-auto max-w-shell px-6">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
                  {t('The look')}
                </h2>
                <p className="mt-1.5 text-sm text-ink-muted">
                  {t('A few frames — the full gallery lives on its own page')}
                </p>
              </div>
              <Link
                href="/photography/gallery"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 px-5 py-2.5 text-[13.5px] font-bold transition hover:border-teal hover:bg-teal-tint hover:text-teal-dark"
              >
                {t('See all')} →
              </Link>
            </div>
            <div className="grid auto-cols-[190px] grid-flow-col gap-4 overflow-x-auto pb-3 sm:auto-cols-[220px]">
              {gallery.slice(0, 8).map((item) => (
                <Link
                  key={item.key}
                  href={`/photography/gallery${item.categories[0] ? `?c=${item.categories[0]}` : ''}`}
                  className="group relative aspect-[3/3.6] overflow-hidden rounded-card border border-ink/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumb ?? item.src}
                    alt={item.alt}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                  />
                  {item.kind === 'video' && (
                    <span
                      aria-hidden
                      className="absolute inset-0 grid place-items-center text-2xl text-white drop-shadow"
                    >
                      ▶
                    </span>
                  )}
                  {item.categories[0] && (
                    <span className="absolute bottom-2.5 left-3 rounded-full bg-white/90 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-ink">
                      {tagLabel[item.categories[0]]}
                    </span>
                  )}
                </Link>
              ))}
              <Link
                href="/photography/gallery"
                className="flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-ink/10 p-5 text-center transition hover:border-teal hover:bg-teal-tint"
              >
                <span className="text-[17px] font-extrabold leading-snug tracking-tight text-teal-dark">
                  {t('See the full gallery')}
                </span>
                <span aria-hidden className="text-xl text-teal">
                  ⟶
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* Booking in three moves + the deposit promise */}
        <section className="bg-teal-tint py-14 sm:py-16">
          <div className="mx-auto max-w-shell px-6">
            <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
              {t('Booked in three moves')}
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {t('Just like booking a tour — no email ping-pong')}
            </p>
            <div className="mt-9 grid gap-6 md:grid-cols-3">
              {(
                [
                  [
                    t('Choose your package'),
                    t('Pick one above — or message us and we’ll shape one around your plans.'),
                  ],
                  [
                    t('Pick a date, pay 50%'),
                    t(
                      'Your deposit reserves the day. Sunrise and sunset slots go first, so don’t sit on it.',
                    ),
                  ],
                  [
                    t('Balance on delivery'),
                    t(
                      'You pay the rest only when your gallery lands. Sneak peek within 48 hours, full set in 5 days.',
                    ),
                  ],
                ] as const
              ).map(([title, body], i) => (
                <div key={title} className="rounded-card border border-ink/10 bg-white p-6">
                  <p className="grid h-10 w-10 place-items-center rounded-full bg-teal text-[15px] font-extrabold text-white">
                    {i + 1}
                  </p>
                  <h3 className="mt-4 text-[16.5px] font-extrabold tracking-tight">{title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 max-w-[660px] rounded-2xl border border-ink/10 border-l-4 border-l-coral bg-white p-5 text-[13.5px] text-ink-muted">
              <b className="text-ink">{t('50% today, 50% when the photos arrive.')}</b>{' '}
              {t('No full prepayments, no fine print — the deposit simply holds your date.')}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-6 py-16 text-center sm:py-24">
          <h2 className="text-balance text-[clamp(26px,3.4vw,40px)] font-extrabold tracking-tight">
            {t('Not sure which package fits?')}
          </h2>
          <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
            {t(
              'Tell us your dates and what you’re celebrating — we’ll point you at the right package the same day.',
            )}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={contact}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
            >
              {t('Ask us on WhatsApp')}
            </a>
            <a
              href="#packages"
              className="inline-flex items-center rounded-full border-[1.5px] border-ink/10 bg-white px-7 py-3.5 text-sm font-bold text-ink transition hover:border-teal hover:text-teal-dark"
            >
              {t('See the packages')}
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
