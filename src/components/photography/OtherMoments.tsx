import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { GALLERY_TAGS, PHOTO_STOCK, type GalleryTag } from '@/lib/catalogue/photography';
import { buildGalleryItems } from './packages-data';

/** Stand-in portrait for a moment with no owner photo tagged yet. */
const FALLBACK: Record<GalleryTag, string> = {
  weddings: PHOTO_STOCK.weddingCouple,
  films: PHOTO_STOCK.film,
  couples: PHOTO_STOCK.couple,
  family: PHOTO_STOCK.family,
};

/**
 * "Other moments for you" — portrait cards into the gallery's four categories, so a package
 * page hands off to every other shoot type. The cover is the owner's first photo tagged for
 * the moment, else a built-in stand-in — the gallery the link opens is the same set.
 */
export async function OtherMoments() {
  const t = await getT();
  const photos = await getPhotographyPhotos();
  const items = buildGalleryItems(t, photos);
  // Literal t() calls so the i18n scanner finds every source string.
  const LABEL: Record<GalleryTag, string> = {
    weddings: t('Weddings'),
    films: t('Films'),
    couples: t('Couples'),
    family: t('Family'),
  };
  return (
    <section className="mt-8 border-t border-ink/10 pt-7">
      <h2 className="text-center text-lg font-bold uppercase tracking-[0.14em] text-ink">
        {t('Other moments for you')}
      </h2>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {GALLERY_TAGS.map((tag) => {
          const cover = items.find(
            (item) => item.kind === 'image' && item.categories.includes(tag),
          );
          const src = cover?.thumb ?? cover?.src ?? FALLBACK[tag];
          return (
            <Link
              key={tag}
              href={`/photography/gallery?c=${tag}`}
              className="group relative block overflow-hidden rounded-xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- CF Pages serves images unoptimized. */}
              <img
                src={src}
                alt={cover?.alt ?? LABEL[tag]}
                loading="lazy"
                className="aspect-[3/4] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              />
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent"
              />
              <span className="absolute inset-x-0 bottom-0 p-3 text-center text-[13px] font-extrabold uppercase tracking-[0.14em] text-white">
                {LABEL[tag]}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
