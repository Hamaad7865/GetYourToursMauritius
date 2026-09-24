import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { GalleryGrid } from './GalleryGrid';
import { PricingGuideCard } from './PricingGuideCard';
import {
  buildGalleryItems,
  buildPackageCards,
  loadPhotographyGroups,
  loadPhotographyPackages,
} from './packages-data';
import { breadcrumbListJsonLd, itemListJsonLd, serviceJsonLd } from '@/lib/seo/jsonld';
import { getT } from '@/lib/i18n/server';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { getWhatsAppNumber } from '@/lib/settings/whatsapp-number';
import { slotUrl } from '@/lib/catalogue/photography';
import { SITE, whatsappUrl } from '@/lib/seo/site';

/** Both photography entry URLs share the same compact package catalogue. */
export async function PhotographyPricingPage({
  path,
}: {
  path: '/photography' | '/photography/packages';
}) {
  const t = await getT();
  const [live, photos, waNumber, groups] = await Promise.all([
    loadPhotographyPackages(),
    getPhotographyPhotos(),
    getWhatsAppNumber(),
    loadPhotographyGroups(),
  ]);
  const packages = buildPackageCards(t, live, waNumber, groups);
  const gallery = buildGalleryItems(t, photos);
  const contact = whatsappUrl(
    `Hi ${SITE.operator}! I’d like help choosing a photography package in Mauritius.`,
    waNumber,
  );

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
        <section className="relative isolate flex min-h-[280px] items-center justify-center overflow-hidden bg-ink px-6 py-14 text-center text-white sm:min-h-[340px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slotUrl(photos, path === '/photography' ? 'hero' : 'pricing-hero')}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 -z-10 bg-ink/55" />
          <div className="max-w-3xl">
            <h1 className="text-balance text-[clamp(32px,4.5vw,58px)] font-semibold leading-[1.1] tracking-tight">
              {t('Photoshoot packages in Mauritius')}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-balance text-sm leading-relaxed text-white/90 sm:text-base">
              {t('Choose your shoot. Pick a date. We will take care of the photos.')}
            </p>
          </div>
        </section>

        <nav aria-label={t('Photography')} className="border-b border-ink/10">
          <div className="mx-auto flex max-w-shell justify-center gap-8 px-6 py-5 text-sm font-semibold">
            <a href="#packages" className="text-teal-dark hover:underline">
              {t('Packages & prices')}
            </a>
            <a href="#gallery" className="text-ink-muted hover:text-teal-dark">
              {t('Gallery')}
            </a>
            <a
              href={contact}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-muted hover:text-teal-dark"
            >
              {t('Contact us')}
            </a>
          </div>
        </nav>

        <section
          id="packages"
          aria-label={t('Packages & prices')}
          className="mx-auto max-w-shell scroll-mt-24 px-6 py-12 sm:py-16"
        >
          <p className="mb-8 text-center text-sm leading-relaxed text-ink-muted">
            {t('Pay 50% to book your date. The balance is due when your photos are delivered.')}
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            {packages.map((pkg) => (
              <PricingGuideCard
                key={pkg.key}
                pkg={pkg}
                fromLabel={t('From')}
                onRequestLabel={t('Price on request')}
                ctaLabel={pkg.external ? t('Enquire') : t('See more')}
              />
            ))}
          </div>
        </section>

        <section
          id="gallery"
          className="mx-auto max-w-shell scroll-mt-24 border-t border-ink/10 px-6 pb-16 pt-12 sm:pb-20"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 className="text-3xl font-semibold tracking-tight">{t('Gallery')}</h2>
            <Link
              href="/photography/gallery"
              className="text-sm font-semibold text-teal-dark underline underline-offset-4"
            >
              {t('See the full gallery')}
            </Link>
          </div>
          <GalleryGrid items={gallery} limit={6} tone="light" />
        </section>

        <section className="border-t border-ink/10 px-6 py-10 text-center">
          <h2 className="text-lg font-semibold">{t('Not sure which package fits?')}</h2>
          <a
            href={contact}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-teal-dark underline underline-offset-4"
          >
            {t('Ask us on WhatsApp')}
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
