import Link from 'next/link';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';
import { destinationPath } from '@/lib/content/areas';
import { attractionImage, attractionImageSrc } from '@/lib/content/attractions';
import { wikimediaThumb } from '@/lib/content/wikimedia';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * The homepage's first-visit row. GetYourGuide lists cities here because it sells the world; we sell
 * one island, where the question a traveller actually has is "what is near where I'm staying?" — so
 * these are the places they will have booked a hotel in or already heard of, each linking to its guide.
 *
 * `photo` is a key into ATTRACTION_IMAGES: real photographs of the place itself, the same set the
 * attraction pages use. A tile whose photo is missing is dropped rather than shown as a placeholder.
 * `where` goes through t(); the place names are proper nouns and are not translated.
 */
const PLACES: { name: string; where: string; href: string; photo: string }[] = [
  {
    name: 'Belle Mare',
    where: 'East coast',
    href: destinationPath('belle-mare'),
    photo: 'belle-mare-beach',
  },
  {
    name: 'Île aux Cerfs',
    where: 'East coast lagoon',
    href: '/ile-aux-cerfs-tours',
    photo: 'ile-aux-cerfs',
  },
  {
    name: 'Le Morne',
    where: 'South-west coast',
    href: destinationPath('le-morne'),
    photo: 'le-morne-brabant',
  },
  {
    name: 'Chamarel',
    where: 'South-west highlands',
    href: '/attractions/chamarel-seven-coloured-earth',
    photo: 'chamarel-seven-coloured-earth',
  },
  {
    name: 'Trou aux Biches',
    where: 'North-west coast',
    href: destinationPath('trou-aux-biches'),
    photo: 'trou-aux-biches-beach',
  },
  {
    name: 'Port Louis',
    where: 'The capital',
    href: destinationPath('port-louis'),
    photo: 'port-louis-central-market',
  },
];

/** Widest a tile is ever drawn is ~190 CSS px, so a 500px rendition covers a 2x screen. */
const TILE_WIDTH = 500;

function resolvedPlaces() {
  return PLACES.flatMap((place) => {
    const image = attractionImage(place.photo);
    if (!image) return [];
    const credited = /(wikimedia|wikipedia)\.org/.test(image.source);
    return [
      {
        ...place,
        src: attractionImageSrc(wikimediaThumb(image.url, TILE_WIDTH)),
        credit: credited ? image.source : null,
      },
    ];
  });
}

export async function HomePlaces() {
  const t = await getT();
  const locale = await getLocale();
  const places = resolvedPlaces();
  if (places.length === 0) return null;

  return (
    <section aria-labelledby="places-heading" className="mx-auto max-w-shell px-6 pt-10 sm:pt-12">
      <h2
        id="places-heading"
        className="text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
      >
        {t('Things to do wherever you’re staying')}
      </h2>

      {/* Phones: an edge-to-edge snap rail (the next tile peeks in). sm+: a plain grid. scroll-px-6
          must mirror px-6 — snapping aligns to the padding box, so without it the first tile re-snaps
          flush with the screen edge, 24px left of the heading. */}
      <ul className="no-bar -mx-6 mt-5 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {places.map((place) => (
          <li key={place.name} className="w-[44%] shrink-0 snap-start sm:w-auto">
            <Link href={localePath(locale, place.href)} className="group block rounded-2xl">
              <div className="aspect-square overflow-hidden rounded-2xl bg-teal-tint">
                <img
                  src={place.src}
                  alt={t('{place}, Mauritius', { place: place.name })}
                  width={TILE_WIDTH}
                  height={TILE_WIDTH}
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
                />
              </div>
              <p className="mt-3 text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-ink decoration-2 underline-offset-4 group-hover:underline">
                {place.name}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">{t(place.where)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Attribution for the place photos, which are Creative Commons works from Wikimedia Commons. Rendered
 * once at the foot of the page rather than under each tile; every name links to its source page,
 * where the author and licence are stated.
 */
export async function HomePlacesCredits() {
  const t = await getT();
  const credited = resolvedPlaces().filter((p) => p.credit);
  if (credited.length === 0) return null;
  return (
    <p className="mx-auto mt-10 max-w-shell px-6 text-[12px] leading-relaxed text-ink-muted">
      {t('Place photos via Wikimedia Commons:')}{' '}
      {credited.map((place, i) => (
        <span key={place.name}>
          {i > 0 && ', '}
          <a
            href={place.credit!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline decoration-ink/25 underline-offset-2 hover:text-ink hover:decoration-ink"
          >
            {place.name}
          </a>
        </span>
      ))}
      .
    </p>
  );
}
