import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { RevealGroup } from '@/components/site/RevealGroup';
import { BelleMareHero } from '@/components/belle-mare/BelleMareHero';
import { HotelRail, type RailHotel } from '@/components/belle-mare/HotelRail';
import { getArea, areaMetaTitle, areaMetaDescription, localisedArea } from '@/lib/content/areas';
import {
  hotelGroupsFor,
  hotelsFor,
  DEFAULT_AIRPORT_MINUTES,
} from '@/lib/content/destination-hotels';
import { mergedFaq } from '@/lib/content/destination-faq-extra';
import { hotelPhoto } from '@/lib/content/hotel-photos';
import { getTransfer, transferPath } from '@/lib/content/transfers';
import { attractionImage, attractionImageSrc } from '@/lib/content/attractions';
import {
  destinationJsonLd,
  breadcrumbListJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
} from '@/lib/seo/jsonld';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE, whatsappUrl } from '@/lib/seo/site';
import { getT, getLocale } from '@/lib/i18n/server';

export const runtime = 'edge';

/**
 * The Belle Mare area guide.
 *
 * WHY IT IS NOT UNDER /destinations. This is the brand's own place name and the phrase the site
 * most needs to own, so the guide sits at the bare /belle-mare and the old /destinations/belle-mare
 * 308s onto it (next.config.mjs). Nothing about the CONTENT forked in the move: it still reads the
 * same `areas` record and the same `destination-hotels` roster the /destinations/[slug] route
 * renders for every other area, so the French translation, the FAQ merge and the /admin/seo row all
 * came along for free. The single expression of the move is AREA_PATH_OVERRIDES in areas.ts, which
 * is what the sitemap, the /destinations index, the breadcrumb and the canonical all read.
 *
 * WHY IT IS A BESPOKE LAYOUT. Every other guide uses the InfoPage shell. This one is the page the
 * company is named after and the one most likely to be a visitor's first impression, so it gets a
 * composed hero and a hotel rail. That is a deliberate exception, not a new default — a second page
 * wanting this treatment should extract the sections first rather than copy this file.
 *
 * The three siblings it must not collide with, all cross-linked below: /things-to-do-in-belle-mare
 * (activity-first), /belle-mare-tours (the operator), /attractions (island-wide).
 */

const SLUG = 'belle-mare';

/**
 * Photography for the beach cards, by the beach name in `areas.beaches`.
 *
 * Commons files route through `attractionImageSrc` — it proxies upload.wikimedia.org through our
 * own /api/img, which is not optional: hot-linking a burst of thumbnails gets 429ed. A beach with
 * no entry (Poste de Flacq) renders the typographic card, which is a designed state.
 */
const BEACH_IMAGE: Record<string, { url: string; source: string }> = {
  'Belle Mare Public Beach': attractionImage('belle-mare-beach') ?? { url: '', source: '' },
  // Ours, so no Commons credit — `source` is empty rather than absent to keep the shape uniform.
  'Palmar Beach': { url: '/activities/palmar-beach.jpg', source: '' },
  "Trou d'Eau Douce": attractionImage('trou-deau-douce') ?? { url: '', source: '' },
};

function isCommons(source: string | undefined): boolean {
  return !!source && /(wikimedia|wikipedia)\.org/.test(source);
}

/** Two-digit ordinal for the numbered lists ("01", "02", …). */
function pad(i: number): string {
  return String(i + 1).padStart(2, '0');
}

export default async function BelleMarePage() {
  const raw = getArea(SLUG);
  if (!raw) notFound();

  const t = await getT();
  const locale = await getLocale();
  const a = localisedArea(raw, locale);
  const groups = hotelGroupsFor(SLUG) ?? [];
  const hotels = hotelsFor(SLUG);
  const faq = mergedFaq(a.faq, SLUG, locale);

  const heroImage = attractionImage('belle-mare-beach');
  // "Belle Mare" → ["Belle", "Mare"]: the display type sets the last word on its own indented line.
  const lastSpace = a.name.lastIndexOf(' ');
  const nameLines: [string, string] =
    lastSpace > 0 ? [a.name.slice(0, lastSpace), a.name.slice(lastSpace + 1)] : [a.name, ''];

  /* Every per-hotel string the rail shows is finished HERE, not in the client component: a
     function cannot cross the RSC boundary, and resolving on the server also keeps `whatsappUrl`
     and the translator out of the client bundle. `total` is the flat roster length, so it is
     computed before the map rather than from `g.hotels`. */
  const total = hotels.length;
  const railHotels: RailHotel[] = groups.flatMap((g, gi) =>
    g.hotels.map((h) => {
      const index = hotels.findIndex((x) => x.slug === h.slug);
      /* The hotel's OWN airport-transfer landing page, where we run one — thirteen of the fourteen.
         That page is also the source of the journey time: quoting a separate hand-derived figure
         here would have this site publish two different numbers for the same hotel. */
      const transfer = getTransfer(h.slug);
      /* An owner-supplied file in destination-hotels.ts wins over the licence register, so a real
         press image dropped into /public/hotels/ takes over without touching hotel-photos.ts.
         Either way the picture must be of the PROPERTY — a hotel with no such file gets the
         typographic card rather than a photo of the coast it sits on. */
      const photo = h.image ? { url: h.image, credit: null } : hotelPhoto(h.slug);
      return {
        slug: h.slug,
        name: h.name,
        description: h.description,
        group: gi,
        airportMinutes: transfer
          ? String(transfer.durationMinFromAirport)
          : DEFAULT_AIRPORT_MINUTES,
        href: transfer ? transferPath(h.slug) : '/airport-transfers',
        enquiryHref: whatsappUrl(
          `Hi ${SITE.operator}! I'm staying at ${h.name} in ${a.name} and would like a pickup quote.`,
        ),
        position: t('{n} of {total} · {inGroup} in this group', {
          n: index + 1,
          total,
          inGroup: g.hotels.length,
        }),
        photo: photo
          ? {
              src: attractionImageSrc(photo.url),
              alt: t('{hotel}, Belle Mare, Mauritius', { hotel: h.name }),
              credit: photo.credit,
            }
          : null,
      };
    }),
  );

  return (
    <>
      <JsonLd data={destinationJsonLd({ name: a.name, description: a.intro, path: a.path })} />
      {hotels.length > 0 && (
        <JsonLd
          data={itemListJsonLd(hotels.map((h) => ({ name: h.name, path: '/airport-transfers' })))}
        />
      )}
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Destinations'), path: '/destinations' },
          { name: a.name, path: a.path },
        ])}
      />
      <JsonLd data={faqPageJsonLd(faq)} />

      <GygHeader />
      <main className="bg-white">
        <BelleMareHero
          eyebrow={t('Destination guide · {region} coast', { region: a.region })}
          nameLines={nameLines}
          intro={t(
            'The whitest sand on the island, a lagoon held back by a distant reef, and fourteen hotels whose gate we already know.',
          )}
          photo={heroImage ? attractionImageSrc(heroImage.url) : '/activities/palmar-beach.jpg'}
          photoAlt={t('The white sand and turquoise lagoon at Belle Mare, east coast Mauritius')}
          photoCredit={
            isCommons(heroImage?.source)
              ? { label: t('Photo via Wikimedia Commons'), href: heroImage!.source }
              : undefined
          }
          scrollCue={t('Dive in')}
        />

        {/* The coast — the area intro, on ink so it reads as a continuation of the hero's sea. */}
        <section className="bg-ink px-6 py-16 text-white sm:py-24">
          <div className="mx-auto grid max-w-shell gap-10 sm:grid-cols-2 sm:gap-14">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal-tint">
                {t('The coast')}
              </p>
              {/* The intro's first sentence, promoted to a standfirst; the rest runs as body text
                  opposite. One sentence at display size is the hook, four is a wall. */}
              <p className="mt-5 text-[clamp(21px,2.4vw,32px)] font-bold leading-[1.32] tracking-tight text-white">
                {a.intro.split('. ')[0]}.
              </p>
            </div>
            <div>
              <p className="text-[16px] leading-[1.78] text-white/70">
                {a.intro.split('. ').slice(1).join('. ')}
              </p>
              {a.goodFor.length > 0 && (
                <div className="mt-7 flex flex-wrap gap-2">
                  {a.goodFor.map((g) => (
                    <span
                      key={g}
                      className="rounded-full border border-teal-tint/35 px-3.5 py-1.5 text-[12.5px] font-semibold text-teal-tint"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Things to do — the numbered cards, linking on to the long-form activity guide. */}
        <section className="bg-white px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-shell">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <h2 className="text-[clamp(28px,4.4vw,56px)] font-extrabold leading-none tracking-tight text-ink">
                {t('Things to do in {name}', { name: a.name })}
              </h2>
              <Link
                href="/things-to-do-in-belle-mare"
                className="border-b border-coral/45 pb-1 text-[13px] font-bold text-coral-dark hover:border-coral-dark"
              >
                {t('Read the full things-to-do guide →')}
              </Link>
            </div>
            <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {a.highlights.map((h, i) => (
                <article
                  key={h}
                  className="rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_1px_3px_rgba(10,46,54,0.05)] transition hover:border-teal/40 hover:shadow-[0_10px_28px_rgba(10,46,54,0.09)]"
                >
                  <p className="text-[30px] font-extrabold leading-none tracking-tight text-teal">
                    {pad(i)}
                  </p>
                  <p className="mt-4 text-[15px] leading-relaxed text-ink/80">{h}</p>
                </article>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Beaches — photo cards where we hold a usable file, typographic where we do not. */}
        {a.beaches.length > 0 && (
          <section className="bg-white px-6 pb-16 sm:pb-24">
            <div className="mx-auto max-w-shell">
              <h2 className="text-[clamp(24px,3.4vw,44px)] font-extrabold leading-none tracking-tight text-ink">
                {t('Beaches near {name}', { name: a.name })}
              </h2>
              <RevealGroup className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                {a.beaches.map((b) => {
                  const img = BEACH_IMAGE[b];
                  return (
                    <figure
                      key={b}
                      className="relative overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0B5C63_0%,#0A2E36_100%)]"
                    >
                      <div className="aspect-[3/4] w-full">
                        {img?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={attractionImageSrc(img.url)}
                            alt={t('{beach}, east coast Mauritius', { beach: b })}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(10,46,54,0),rgba(10,46,54,0.88))] px-4 pb-4 pt-8 text-[15px] font-bold leading-tight text-white">
                        {b}
                      </figcaption>
                      {img && isCommons(img.source) && (
                        <a
                          href={img.source}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="absolute right-2 top-2 rounded-full bg-ink/55 px-2 py-1 text-[9px] font-semibold text-white/80 hover:text-white"
                        >
                          {t('Commons')}
                        </a>
                      )}
                    </figure>
                  );
                })}
              </RevealGroup>
            </div>
          </section>
        )}

        {/* Where to stay — the rail. The one section on the site that turns a hotel into an enquiry. */}
        {railHotels.length > 0 && (
          <section
            id="stay"
            className="relative overflow-hidden bg-[linear-gradient(180deg,#0B5C63_0%,#0A2E36_38%,#0A2E36_100%)] py-16 text-white sm:py-24"
          >
            {/* Teal bloom behind the fan — reads as the light the cards are lit by. Purely
                decorative, so it is out of the a11y tree and never intercepts a click. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-x-[10%] top-[10%] h-[70%] bg-[radial-gradient(60%_50%_at_50%_40%,rgba(19,160,166,0.18),transparent_70%)]"
            />
            {/* No horizontal padding on the section: the rail's stage is full-bleed, so each block
                that ISN'T the stage carries its own shell gutter (here and inside HotelRail). */}
            <div className="relative mx-auto max-w-shell px-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal-bright">
                {t('Where to stay')}
              </p>
              <h2 className="mt-4 text-[clamp(28px,5vw,68px)] font-extrabold leading-[0.98] tracking-tight text-white">
                {t('If yours is here, we already know')}
                <br />
                <span className="text-teal-tint">{t('the gate, the drive and the time.')}</span>
              </h2>
              <p className="mt-5 max-w-[560px] text-[16px] leading-[1.75] text-white/65">
                {t(
                  'These are the hotels we collect from — so if yours is here, we already know the gate, the drive and the journey time.',
                )}
              </p>
            </div>
            <div className="relative">
              <HotelRail
                groups={groups.map((g) => ({ area: g.area, blurb: g.blurb }))}
                hotels={railHotels}
                labels={{
                  minutes: t('min'),
                  airport: t('Airport'),
                  selected: t('Selected'),
                  quote: t('Quote my pickup from here'),
                  prices: t('See transfer prices'),
                  elsewhere: t('Staying somewhere else? We collect from there too —'),
                  elsewhereLink: t('tell us the hotel and we will quote it'),
                  previous: t('Previous hotel'),
                  next: t('Next hotel'),
                  choose: t('Choose hotel'),
                  photo: t('Photo:'),
                }}
              />
            </div>
          </section>
        )}

        {/* Getting there — the journey time as the headline figure, because it is the question. */}
        <section className="bg-white px-6 py-16 sm:py-24">
          <div className="mx-auto grid max-w-shell items-center gap-10 sm:grid-cols-2 sm:gap-14">
            <div>
              <h2 className="text-[clamp(28px,4.4vw,54px)] font-extrabold leading-none tracking-tight text-ink">
                {t('Getting to {name}', { name: a.name })}
              </h2>
              <p className="mt-8 flex items-baseline gap-4">
                <span className="text-[clamp(60px,10vw,130px)] font-extrabold leading-[0.8] tracking-tighter text-teal">
                  45–60
                </span>
                <span className="text-[12px] font-bold uppercase leading-tight tracking-[0.2em] text-ink-muted">
                  {t('minutes')}
                  <br />
                  {t('from SSR')}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[16.5px] leading-[1.8] text-ink/80">{a.gettingThere}</p>
              <Link
                href="/airport-transfers"
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
              >
                {t('See airport transfers & prices →')}
              </Link>
            </div>
          </div>
        </section>

        {/* What's nearby */}
        {a.nearbyAttractions.length > 0 && (
          <section className="bg-white px-6 pb-16 sm:pb-24">
            <div className="mx-auto max-w-shell">
              <h2 className="text-[clamp(24px,3.4vw,44px)] font-extrabold leading-none tracking-tight text-ink">
                {t("What's nearby")}
              </h2>
              <div className="mt-7 grid gap-x-12 sm:grid-cols-2">
                {a.nearbyAttractions.map((n, i) => (
                  <p
                    key={n}
                    className="flex items-baseline gap-4 border-t border-ink/10 py-5 text-[16px] leading-snug text-ink/85"
                  >
                    <span className="min-w-[22px] text-[11px] font-extrabold tracking-[0.16em] text-teal">
                      {pad(i)}
                    </span>
                    {n}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* FAQ. Not in the source mockup, kept deliberately: it is what earns the FAQ rich result,
            and `mergedFaq` folds in the People-Also-Ask questions Google shows for this place. */}
        <section className="bg-white px-6 pb-16 sm:pb-24">
          <div className="mx-auto max-w-shell">
            <h2 className="text-[clamp(24px,3.4vw,44px)] font-extrabold leading-none tracking-tight text-ink">
              {t('Frequently asked questions')}
            </h2>
            <div className="mt-7 flex flex-col gap-2.5">
              {faq.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-xl border border-ink/10 bg-white px-5 py-4 open:bg-teal-tint/30"
                >
                  <summary className="cursor-pointer list-none text-[15.5px] font-bold text-ink marker:hidden">
                    {f.q}
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink/75">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Close — the same two CTAs the other guides end on, at full width. */}
        <section className="bg-[linear-gradient(180deg,#0B5C63_0%,#0A2E36_55%)] px-6 py-20 text-center text-white sm:py-28">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-[clamp(32px,6vw,76px)] font-extrabold leading-[0.98] tracking-tight">
              {t('Explore from {name}', { name: a.name })}
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-[16.5px] leading-relaxed text-white/70">
              {t(
                'Book a private day tour or excursion, or design your own day around {name} with our free AI road-trip planner — with door-to-door pickup and instant confirmation.',
                { name: a.name },
              )}
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href="/activities"
                className="rounded-full bg-coral px-7 py-4 text-[15px] font-bold text-white transition hover:bg-[#ff8259]"
              >
                {t('Browse tours & activities')}
              </Link>
              <Link
                href="/ai-road-trip-planner"
                className="rounded-full border border-white/25 px-7 py-4 text-[15px] font-bold text-white transition hover:border-teal-tint hover:text-teal-tint"
              >
                {t('Plan a custom day with AI')}
              </Link>
            </div>
            <div className="mt-14 flex flex-wrap items-center justify-center gap-4 border-t border-white/15 pt-8 text-[14px] text-white/55">
              <span>{t('Ready to book or have a question?')}</span>
              <a
                href={whatsappUrl(
                  `Hi ${SITE.operator}! I'm staying in ${a.name} and would like to plan some tours and a transfer.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-teal-tint hover:underline"
              >
                {t('WhatsApp us')}
              </a>
              <a
                href={`tel:${SITE.phone.replace(/\s+/g, '')}`}
                className="font-bold text-teal-tint hover:underline"
              >
                {SITE.phone}
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override. The title/description come from the SAME
 *  helpers the /destinations group in the SEO editor previews, so the editor cannot drift from the
 *  page (see buildSeoPageGroups in src/lib/seo/page-groups.ts). */
export async function generateMetadata(): Promise<Metadata> {
  const raw = getArea(SLUG);
  if (!raw) return { title: 'Destination not found' };
  const a = localisedArea(raw, await getLocale());
  const title = areaMetaTitle(a);
  const description = areaMetaDescription(a);
  return overrideMetadata(a.path, {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${SITE.url}${a.path}`,
      images: [OG_IMAGE],
    },
  });
}
