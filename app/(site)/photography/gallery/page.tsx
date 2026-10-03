import { responsiveImage } from '@/lib/images/resize';
import { PHOTO_BANNER } from '@/lib/images/presets';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { BlurFade } from '@/components/photography/BlurFade';
import { GalleryGrid } from '@/components/photography/GalleryGrid';
import { buildGalleryItems } from '@/components/photography/packages-data';
import { IconArrowRight } from '@/components/ui/icons';
import { breadcrumbListJsonLd } from '@/lib/seo/jsonld';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { GALLERY_TAGS, slotUrl, type GalleryTag } from '@/lib/catalogue/photography';

export const runtime = 'edge';

/**
 * The photography gallery — every photo and film the owner adds in /admin/photography → Page photos
 * (the "gallery" slot), filterable by category (weddings, films, couples, family), with videos that
 * play in place. `?c=<category>` opens on one category, so each can be linked to directly.
 */

const DEFAULT_METADATA: Metadata = {
  title: { absolute: 'Mauritius Photographer Gallery | Belle Mare Tours' },
  description:
    'Wedding photos and films, couples, honeymoon and family shoots on the beaches of Mauritius. Browse the gallery by category, then book your own shoot online.',
  alternates: { canonical: '/photography/gallery' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/photography/gallery`,
    title: 'Mauritius Photographer Gallery | Belle Mare Tours',
    description:
      'Wedding photos and films, couples and family shoots on the beaches of Mauritius — browse by category.',
    images: [OG_IMAGE],
  },
};

export default async function PhotographyGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const t = await getT();
  const { c } = await searchParams;
  const initial: GalleryTag | 'all' = (GALLERY_TAGS as readonly string[]).includes(c ?? '')
    ? (c as GalleryTag)
    : 'all';
  const photos = await getPhotographyPhotos();
  const items = buildGalleryItems(t, photos);

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Photography'), path: '/photography' },
          { name: t('Gallery'), path: '/photography/gallery' },
        ])}
      />
      <GygHeader />
      <main className="bg-white">
        {/* Banner — swappable in /admin/photography (Gallery page banner). */}
        <section className="relative isolate flex min-h-[380px] items-end overflow-hidden bg-ink text-white sm:min-h-[440px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            {...responsiveImage(slotUrl(photos, 'gallery-hero'), PHOTO_BANNER)}
            alt={t('Photography in Mauritius')}
            fetchPriority="high"
            className="pg-focus-in absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,46,54,0.35)_0%,rgba(10,46,54,0.25)_45%,rgba(10,46,54,0.92)_100%)]"
          />
          <div className="mx-auto w-full max-w-shell px-6 pb-12 sm:pb-16">
            <nav
              aria-label={t('Breadcrumb')}
              className="mb-5 flex items-center gap-2 text-[12px] font-semibold text-white/70"
            >
              <Link href="/photography" className="hover:text-white">
                {t('Photography')}
              </Link>
              <span className="text-white/40">/</span>
              <span className="text-white">{t('Gallery')}</span>
            </nav>
            <h1 className="bm-rise text-[clamp(34px,6vw,72px)] font-extrabold leading-[0.95] tracking-tight [text-shadow:0_14px_60px_rgba(4,20,26,0.5)]">
              {t('The gallery')}
            </h1>
            <p className="bm-rise mt-4 max-w-xl text-[16px] leading-relaxed text-white/85 [animation-delay:0.15s]">
              {t(
                'Weddings, films, couples and families — shot on the beaches and islands of Mauritius.',
              )}
            </p>
          </div>
        </section>

        <section className="bg-ink px-6 pb-16 pt-6 text-white sm:pb-24">
          <div className="mx-auto max-w-shell">
            <GalleryGrid items={items} initialFilter={initial} syncUrl />
          </div>
        </section>

        <section className="px-6 py-16 text-center sm:py-20">
          <BlurFade className="mx-auto max-w-2xl">
            <h2 className="text-[clamp(26px,3.6vw,44px)] font-extrabold leading-none tracking-tight text-ink">
              {t('Like what you see?')}{' '}
              <span className="text-teal">{t('Book your own shoot.')}</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
              {t(
                'Pick a package and a date — 50% books it, the rest when your photos are delivered.',
              )}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-5">
              <Link
                href="/photography/packages"
                className="inline-flex items-center gap-2 rounded-full bg-coral px-7 py-3.5 text-[15px] font-bold text-white transition hover:bg-coral-dark"
              >
                {t('See packages & book')}
                <IconArrowRight width={16} height={16} />
              </Link>
              <Link
                href="/photography"
                className="border-b border-coral/45 pb-1 text-[13px] font-bold text-coral-dark hover:border-coral-dark"
              >
                {t('Back to Photography & film')}
              </Link>
            </div>
          </BlurFade>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/photography/gallery', DEFAULT_METADATA);
}
