import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { RevealGroup } from '@/components/site/RevealGroup';
import { JsonLd } from '@/components/seo/JsonLd';
import { PackagesSection, type PhotoPackage } from '@/components/photography/PackagesSection';
import { PortfolioGrid, type PortfolioShot } from '@/components/photography/PortfolioGrid';
import { IconArrowRight } from '@/components/ui/icons';
import { breadcrumbListJsonLd, faqPageJsonLd, serviceJsonLd } from '@/lib/seo/jsonld';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE, whatsappUrl } from '@/lib/seo/site';
import { getLocale, getT } from '@/lib/i18n/server';
import { getWhatsAppNumber } from '@/lib/settings/whatsapp-number';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import type { TourSummary } from '@/lib/validation/tours';

export const runtime = 'edge';

/**
 * Photography & film — weddings, wedding films, couples/holiday and family shoots.
 *
 * BOOKING. There is no photography-specific booking code. A package is an ordinary catalogue
 * activity whose category is exactly PHOTOGRAPHY_CATEGORY, set up in /admin like any tour (pricing
 * tiers, supplements for add-ons, schedule). Its card links to /activities/<slug>, so date picking,
 * holds, Peach payment and settlement all run through the one audited money path. Until the owner
 * publishes a package, the built-in cards below render as WhatsApp enquiries instead — the page is
 * never a dead end.
 *
 * PHOTOS. Everything under /public/photography is licensed stand-in stock (Unsplash) until the
 * team's own work replaces it, which is why the gallery is labelled "The look", not "Our work".
 */

const PHOTOGRAPHY_CATEGORY = 'Photography';

const IMG = {
  hero: '/photography/wedding-beach.jpg',
  weddingSunset: '/photography/wedding-sunset.jpg',
  weddingCouple: '/photography/wedding-couple.jpg',
  weddingDetail: '/photography/wedding-detail.jpg',
  couple: '/photography/couple.jpg',
  family: '/photography/family.jpg',
  family2: '/photography/family-2.jpg',
  film: '/photography/film.jpg',
  film2: '/photography/film-2.jpg',
  aerial: '/hero/islands/aerial-lagoon.jpg',
  islet: '/hero/islands/ile-aux-aigrettes.jpg',
  passe: '/hero/islands/ile-de-la-passe.jpg',
};

const DEFAULT_METADATA: Metadata = {
  title: { absolute: 'Wedding & Holiday Photography in Mauritius | Belle Mare Tours' },
  description:
    'Wedding photography, wedding films, couples and family holiday shoots in Mauritius by a local Belle Mare team. See packages, pick a date and book online.',
  alternates: { canonical: '/photography' },
  keywords: [
    'wedding photographer Mauritius',
    'wedding videographer Mauritius',
    'Mauritius photoshoot',
    'honeymoon photographer Mauritius',
    'family photoshoot Mauritius',
    'Belle Mare photographer',
  ],
  openGraph: {
    type: 'website',
    url: `${SITE.url}/photography`,
    title: 'Wedding & Holiday Photography in Mauritius | Belle Mare Tours',
    description:
      'Wedding photos and films, couples and family shoots on the beaches of Mauritius — book online with a local team.',
    images: [OG_IMAGE],
  },
};

async function loadPackages(): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(await getLocale()), {
      page: 1,
      pageSize: 24,
      category: PHOTOGRAPHY_CATEGORY,
    });
    return items;
  } catch (error) {
    // The built-in enquiry cards stand in, so a failed read degrades rather than breaks the page.
    console.error('[photography] package fetch failed', error);
    return [];
  }
}

function isWeddingPackage(a: TourSummary): boolean {
  return /wedding|elop|film|mariage/i.test(`${a.title} ${a.summary ?? ''}`);
}

export default async function PhotographyPage() {
  const t = await getT();
  const [live, waNumber] = await Promise.all([loadPackages(), getWhatsAppNumber()]);
  const enquire = (what: string) =>
    whatsappUrl(
      `Hi ${SITE.operator}! I’m interested in ${what} in Mauritius. Could you send availability and prices?`,
      waNumber,
    );

  const hours = (minutes: number | null) =>
    minutes ? t('{n} hours', { n: Math.round((minutes / 60) * 10) / 10 }) : null;

  let packages: PhotoPackage[];
  if (live.length > 0) {
    const weddings = live.filter(isWeddingPackage);
    const shoots = live.filter((a) => !isWeddingPackage(a));
    const toCard = (
      a: TourSummary,
      group: PhotoPackage['group'],
      i: number,
      n: number,
    ): PhotoPackage => ({
      key: a.id,
      group,
      title: a.title,
      meta: hours(a.durationMinutes),
      features: [],
      summary: a.summary,
      image: a.heroImage?.url ?? (group === 'weddings' ? IMG.weddingSunset : IMG.couple),
      imageAlt: a.heroImage?.alt ?? a.title,
      priceEur: a.fromPriceEur,
      href: `/activities/${a.slug}`,
      external: false,
      // The middle card of a full row of three gets the dark "our pick" treatment, as designed.
      highlight: n === 3 && i === 1,
    });
    packages = [
      ...weddings.map((a, i) => toCard(a, 'weddings', i, weddings.length)),
      ...shoots.map((a, i) => toCard(a, 'shoots', i, shoots.length)),
    ];
  } else {
    const fallback = (
      key: string,
      group: PhotoPackage['group'],
      title: string,
      meta: string,
      features: string[],
      image: string,
      highlight = false,
    ): PhotoPackage => ({
      key,
      group,
      title,
      meta,
      features,
      summary: null,
      image,
      imageAlt: title,
      priceEur: null,
      href: enquire(`the “${title}” package`),
      external: true,
      highlight,
    });
    packages = [
      fallback(
        'ceremony-photo',
        'weddings',
        t('Ceremony · Photo'),
        t('4 hours · 1 photographer'),
        [t('Edited high-resolution photos'), t('Private online gallery'), t('Location scouting')],
        IMG.weddingDetail,
      ),
      fallback(
        'ceremony-photo-film',
        'weddings',
        t('Ceremony · Photo + Film'),
        t('6 hours · photographer + videographer'),
        [
          t('Edited high-resolution photos'),
          t('Cinematic film + short teaser'),
          t('Drone aerials, where permitted'),
        ],
        IMG.weddingCouple,
        true,
      ),
      fallback(
        'full-day',
        'weddings',
        t('Full day · Photo + Film'),
        t('10 hours · 2 photographers + videographer'),
        [
          t('Getting ready to first dance'),
          t('Feature film + teaser'),
          t('Printed album available'),
        ],
        IMG.weddingSunset,
      ),
      fallback(
        'couples',
        'shoots',
        t('Couples session'),
        t('1 hour · 1 beach'),
        [t('Sunrise or golden hour'), t('Honeymoon & proposal friendly'), t('Online gallery')],
        IMG.couple,
      ),
      fallback(
        'island-holiday',
        'shoots',
        t('Island holiday session'),
        t('2 hours · 2 locations'),
        [t('Two island backdrops'), t('Vertical reel for social'), t('Online gallery')],
        IMG.islet,
        true,
      ),
      fallback(
        'family',
        'shoots',
        t('Family & kids'),
        t('1 hour · up to 8 people'),
        [t('Kid-paced, no stiff poses'), t('Beach, hotel or villa'), t('Online gallery')],
        IMG.family,
      ),
    ];
  }

  const services = [
    {
      n: '01',
      title: t('Wedding photography'),
      body: t('Getting ready to first dance, with one or two photographers.'),
      img: IMG.weddingSunset,
    },
    {
      n: '02',
      title: t('Wedding films'),
      body: t('A cinematic edit, drone aerials and a short teaser to share.'),
      img: IMG.film,
    },
    {
      n: '03',
      title: t('Couples & holidays'),
      body: t('Honeymoons, proposals, anniversaries and babymoons.'),
      img: IMG.couple,
    },
    {
      n: '04',
      title: t('Family shoots'),
      body: t('Relaxed, kid-friendly sessions on the beach or at your villa.'),
      img: IMG.family,
    },
  ];

  const shots: PortfolioShot[] = [
    {
      src: IMG.weddingCouple,
      alt: t('Bride and groom by the water'),
      categories: ['weddings'],
      aspect: 'aspect-[4/5]',
    },
    {
      src: IMG.film2,
      alt: t('Filming a wedding on the beach'),
      categories: ['films'],
      aspect: 'aspect-video',
      badge: t('Film'),
    },
    {
      src: IMG.couple,
      alt: t('Couple on a Mauritius beach'),
      categories: ['couples'],
      aspect: 'aspect-square',
    },
    {
      src: IMG.weddingDetail,
      alt: t('Wedding details'),
      categories: ['weddings'],
      aspect: 'aspect-[3/4]',
    },
    {
      src: IMG.family2,
      alt: t('Family on the beach'),
      categories: ['family'],
      aspect: 'aspect-[4/3]',
    },
    {
      src: IMG.aerial,
      alt: t('Aerial view of a Mauritius lagoon'),
      categories: ['films', 'weddings'],
      aspect: 'aspect-[4/5]',
      badge: t('Drone'),
    },
    {
      src: IMG.weddingSunset,
      alt: t('Couple at sunset'),
      categories: ['weddings'],
      aspect: 'aspect-[4/3]',
    },
    {
      src: IMG.family,
      alt: t('Family holiday portrait'),
      categories: ['family'],
      aspect: 'aspect-[3/4]',
    },
    {
      src: IMG.passe,
      alt: t('Island backdrop for a couples shoot'),
      categories: ['couples'],
      aspect: 'aspect-[4/3]',
    },
  ];

  const steps = [
    {
      title: t('Book online'),
      body: t('Pick a package, a date and a time, and pay securely by card.'),
    },
    {
      title: t('Plan together'),
      body: t('Your photographer messages you to plan the shot list, location and timing.'),
    },
    {
      title: t('Shoot day'),
      body: t('We meet you at your hotel or the spot you’ve chosen — you just enjoy it.'),
    },
    {
      title: t('Your gallery'),
      body: t('Your edited photos and films arrive in a private online gallery.'),
    },
  ];

  const reasons = [
    {
      title: t('A local team'),
      body: t(
        'We live and work in Belle Mare, so we know where the light falls and when the beaches are quiet.',
      ),
    },
    {
      title: t('One booking for your trip'),
      body: t(
        'Add a shoot to your catamaran day or island tour and pay for everything in one checkout.',
      ),
    },
    {
      title: t('Secure online payment'),
      body: t('Book and pay by card on this site, with instant confirmation by email.'),
    },
  ];

  const faqs = [
    {
      q: t('What if it rains on the day?'),
      a: t(
        'Tropical showers usually pass quickly. If the weather really doesn’t cooperate, we’ll work with you to move the shoot to another day of your stay.',
      ),
    },
    {
      q: t('When do we get our photos and film?'),
      a: t(
        'Your photographer confirms delivery timing when you book. Photos come first; wedding films take longer to edit.',
      ),
    },
    {
      q: t('Can we cancel or change the date?'),
      a: t(
        'Every package shows its cancellation policy before you pay. To change your date, message us and we’ll move it if the new day is free.',
      ),
    },
    {
      q: t('Do you shoot anywhere on the island?'),
      a: t(
        'Yes — we shoot all around Mauritius. Tell us your hotel or dream location and we’ll plan around it.',
      ),
    },
    {
      q: t('Can we combine a shoot with a tour?'),
      a: t(
        'Yes. Book a shoot alongside a catamaran day or island tour and it all goes in one basket and one checkout.',
      ),
    },
  ];

  const waGeneral = whatsappUrl(
    `Hi ${SITE.operator}! I’d like to ask about photography or filming in Mauritius.`,
    waNumber,
  );

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Photography'), path: '/photography' },
        ])}
      />
      <JsonLd data={faqPageJsonLd(faqs)} />
      <JsonLd
        data={serviceJsonLd({
          serviceType: 'Wedding and holiday photography',
          name: 'Wedding & holiday photography in Mauritius',
          description:
            'Wedding photography, wedding films, couples and family holiday shoots across Mauritius by a local Belle Mare team.',
          path: '/photography',
          areaServed: 'Mauritius',
        })}
      />

      <GygHeader />
      <main className="bg-white">
        {/* Hero — full-bleed photo, headline bottom-left. */}
        <section className="relative isolate flex h-[min(86svh,780px)] min-h-[560px] items-end overflow-hidden bg-ink text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={IMG.hero}
            alt={t('A couple on a Mauritius beach at sunset')}
            fetchPriority="high"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,46,54,0.35)_0%,rgba(10,46,54,0.15)_40%,rgba(10,46,54,0.92)_100%)]"
          />
          <div className="mx-auto w-full max-w-shell px-6 pb-14 sm:pb-20">
            <p className="bm-rise text-[11px] font-bold uppercase tracking-[0.28em] text-teal-tint [animation-delay:0.05s]">
              {t('Photography & film · Mauritius')}
            </p>
            <h1 className="mt-4 font-extrabold leading-[0.95] tracking-tight [text-shadow:0_14px_60px_rgba(4,20,26,0.5)]">
              <span className="bm-rise block text-[clamp(38px,6vw,80px)] [animation-delay:0.15s]">
                {t('Say yes where')}
              </span>
              <span className="bm-rise block text-[clamp(38px,6vw,80px)] text-teal-tint [animation-delay:0.27s]">
                {t('the lagoon turns gold.')}
              </span>
            </h1>
            <p className="bm-rise mt-6 max-w-md text-[16px] leading-relaxed text-white/85 [animation-delay:0.42s]">
              {t(
                'Wedding photos, films and holiday shoots by a local team who know every beach, light and tide.',
              )}
            </p>
            <div className="bm-rise mt-8 flex flex-wrap items-center gap-5 [animation-delay:0.55s]">
              <a
                href="#packages"
                className="rounded-full bg-coral px-7 py-4 text-[15px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(247,108,94,0.7)] transition hover:bg-coral-dark"
              >
                {t('See packages & book')}
              </a>
              <a
                href={waGeneral}
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-white/50 pb-1 text-[14px] font-bold text-white hover:border-white"
              >
                {t('Ask us on WhatsApp')}
              </a>
            </div>
          </div>
        </section>

        {/* Services — editorial bento. */}
        <section className="px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-shell">
            <div className="grid gap-6 md:grid-cols-2 md:items-end">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
                  {t('What we shoot')}
                </p>
                <h2 className="mt-4 max-w-[16ch] text-[clamp(28px,4.4vw,56px)] font-extrabold leading-none tracking-tight text-ink">
                  {t('Four ways to take the island home with you.')}
                </h2>
              </div>
              <p className="max-w-sm text-[15px] leading-relaxed text-ink-muted md:justify-self-end">
                {t(
                  'Every shoot includes planning, location scouting, professional editing and a private online gallery.',
                )}
              </p>
            </div>

            <RevealGroup className="mt-12 grid gap-4 md:grid-cols-12 md:grid-rows-[260px_260px_220px]">
              {services.map((s, i) => (
                <a
                  key={s.n}
                  href="#packages"
                  className={`group relative isolate flex min-h-[240px] overflow-hidden rounded-2xl bg-ink text-white ${
                    i === 0
                      ? 'md:col-span-7 md:row-span-2'
                      : i === 3
                        ? 'md:col-span-12'
                        : 'md:col-span-5'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.img}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 -z-10 h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                  />
                  <div
                    aria-hidden
                    className={`absolute inset-0 -z-10 ${
                      i === 3
                        ? 'bg-[linear-gradient(90deg,rgba(10,46,54,0.85)_0%,rgba(10,46,54,0.3)_55%,rgba(10,46,54,0)_100%)]'
                        : 'bg-[linear-gradient(180deg,rgba(10,46,54,0)_30%,rgba(10,46,54,0.88)_100%)]'
                    }`}
                  />
                  <div
                    className={`flex w-full flex-col justify-end p-6 sm:p-7 ${i === 3 ? 'max-w-md md:justify-center' : ''}`}
                  >
                    <p className="text-[12px] font-bold text-teal-tint">{s.n}</p>
                    <h3
                      className={`mt-1 font-extrabold tracking-tight ${i === 0 ? 'text-[clamp(24px,3vw,34px)]' : 'text-2xl'}`}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/80">{s.body}</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-white">
                      {t('See packages')}
                      <IconArrowRight
                        width={15}
                        height={15}
                        className="transition group-hover:translate-x-0.5"
                      />
                    </span>
                  </div>
                </a>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* The look — dark band with the filterable masonry. */}
        <section className="bg-ink px-6 py-16 text-white sm:py-24">
          <div className="mx-auto max-w-shell">
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal-bright">
                {t('The look')}
              </p>
              <h2 className="mx-auto mt-4 max-w-[18ch] text-[clamp(28px,4.4vw,56px)] font-extrabold leading-none tracking-tight">
                {t('Real light.')} <span className="text-teal-tint">{t('No filters needed.')}</span>
              </h2>
            </div>
            <PortfolioGrid shots={shots} />
          </div>
        </section>

        {/* Packages — live catalogue activities, or enquiry cards until they exist. */}
        <section id="packages" className="scroll-mt-24 bg-teal-tint/40 px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-shell">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
              {t('Packages')}
            </p>
            <h2 className="mt-4 text-[clamp(28px,4.4vw,56px)] font-extrabold leading-none tracking-tight text-ink">
              {live.length > 0 ? t('Clear prices. Book in minutes.') : t('Choose your package.')}
            </h2>
            <PackagesSection
              packages={packages}
              addOnsNote={
                live.length > 0
                  ? t(
                      'Add drone aerials, extra hours, a same-day preview or a printed album when you book. Prices are per shoot, not per person.',
                    )
                  : t(
                      'Drone aerials, extra hours, a same-day preview and printed albums are all available. Message us for a quote for your date.',
                    )
              }
            />
          </div>
        </section>

        {/* How it works. */}
        <section className="px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-shell">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
              {t('How it works')}
            </p>
            <h2 className="mt-4 max-w-[20ch] text-[clamp(28px,4.4vw,56px)] font-extrabold leading-none tracking-tight text-ink">
              {t('From booking to gallery,')}{' '}
              <span className="text-teal">{t('you just show up.')}</span>
            </h2>
            <RevealGroup className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <article
                  key={s.title}
                  className="rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_1px_3px_rgba(10,46,54,0.05)] transition hover:border-teal/40 hover:shadow-[0_10px_28px_rgba(10,46,54,0.09)]"
                >
                  <p className="text-[30px] font-extrabold leading-none tracking-tight text-teal">
                    {String(i + 1).padStart(2, '0')}
                  </p>
                  <h3 className="mt-4 text-lg font-extrabold text-ink">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{s.body}</p>
                </article>
              ))}
            </RevealGroup>
          </div>
        </section>

        {/* Why us — photo + three reasons on the brand's teal-to-ink band. */}
        <section className="bg-[linear-gradient(180deg,#0B5C63_0%,#0A2E36_55%)] px-6 py-16 text-white sm:py-24">
          <div className="mx-auto grid max-w-shell items-stretch gap-10 md:grid-cols-[1.2fr_1fr] md:gap-14">
            <div className="relative min-h-[320px] overflow-hidden rounded-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMG.weddingSunset}
                alt={t('Couple at sunset')}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal-tint">
                {t('Why book with us')}
              </p>
              <h2 className="mt-4 text-[clamp(28px,4vw,48px)] font-extrabold leading-none tracking-tight">
                {t('Born here.')} <span className="text-teal-tint">{t('Shooting here.')}</span>
              </h2>
              <ul className="mt-8 space-y-6">
                {reasons.map((r) => (
                  <li key={r.title} className="border-l-2 border-teal-bright/60 pl-5">
                    <h3 className="text-[17px] font-extrabold">{r.title}</h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-white/70">{r.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ. */}
        <section className="px-6 py-16 sm:py-24">
          <div className="mx-auto grid max-w-shell gap-10 md:grid-cols-[1fr_1.5fr] md:gap-14">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
                {t('FAQ')}
              </p>
              <h2 className="mt-4 text-[clamp(26px,3.4vw,44px)] font-extrabold leading-none tracking-tight text-ink">
                {t('Good questions,')} <span className="text-teal">{t('straight answers.')}</span>
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-ink-muted">
                {t('Something else on your mind? Message us on WhatsApp.')}
              </p>
              <a
                href={waGeneral}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-block border-b border-coral/45 pb-1 text-[13px] font-bold text-coral-dark hover:border-coral-dark"
              >
                {t('Chat on WhatsApp →')}
              </a>
            </div>
            <div className="space-y-3">
              {faqs.map((f, i) => (
                <details
                  key={f.q}
                  open={i === 0}
                  className="group rounded-xl border border-ink/10 bg-white px-5 py-4 open:bg-teal-tint/30"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-bold text-ink">
                    {f.q}
                    <span
                      aria-hidden
                      className="text-xl font-bold text-teal transition group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action. */}
        <section className="relative isolate overflow-hidden px-6 py-20 text-center text-white sm:py-28">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={IMG.aerial}
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 -z-10 bg-ink/70" />
          <div className="mx-auto max-w-shell">
            <h2 className="mx-auto max-w-[18ch] text-[clamp(30px,5vw,64px)] font-extrabold leading-none tracking-tight">
              {t('Pick your date.')}{' '}
              <span className="text-teal-tint">{t('We’ll handle the light.')}</span>
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[16px] leading-relaxed text-white/80">
              {t('Peak wedding season books up early — check your date now.')}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-5">
              <a
                href="#packages"
                className="rounded-full bg-coral px-8 py-4 text-[15px] font-bold text-white transition hover:bg-coral-dark"
              >
                {t('See packages & book')}
              </a>
              <Link
                href="/activities"
                className="border-b border-white/50 pb-1 text-[14px] font-bold text-white hover:border-white"
              >
                {t('Pair it with a tour')}
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/photography', DEFAULT_METADATA);
}
