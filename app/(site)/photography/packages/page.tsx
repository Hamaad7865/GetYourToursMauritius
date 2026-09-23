import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { RevealGroup } from '@/components/site/RevealGroup';
import { JsonLd } from '@/components/seo/JsonLd';
import { Price } from '@/components/site/Price';
import { PricingGuideCard } from '@/components/photography/PricingGuideCard';
import { BlurFade } from '@/components/photography/BlurFade';
import { FOCUS_CARDS } from '@/components/photography/motion';
import {
  buildPackageCards,
  loadPhotographyGroups,
  loadPhotographyPackages,
  loadPrivateTours,
} from '@/components/photography/packages-data';
import { IconArrowRight } from '@/components/ui/icons';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE, whatsappUrl } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';
import { getWhatsAppNumber } from '@/lib/settings/whatsapp-number';
import { getPhotographyPhotos } from '@/lib/settings/photography-photos';
import { slotUrl } from '@/lib/catalogue/photography';

export const runtime = 'edge';

/**
 * The photography pricing guide — every package as a big card, grouped weddings vs holiday/family
 * shoots, each "See more" opening the package's own /activities/<slug> page where the guest picks a
 * date, the party (extra guests), the add-ons and checks out. /photography is the story; this is
 * the price list its "Choose your package" and the navbar dropdown lead to.
 */

const DEFAULT_METADATA: Metadata = {
  title: { absolute: 'Mauritius Photographer Prices & Packages | Belle Mare Tours' },
  description:
    'Mauritius photographer prices: wedding, couples, holiday and family photo packages. Compare prices, add drone or extra hours and book your date online.',
  alternates: { canonical: '/photography/packages' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/photography/packages`,
    title: 'Mauritius Photographer Prices & Packages | Belle Mare Tours',
    description:
      'Wedding, couples, holiday and family photography packages in Mauritius — compare and book online.',
    images: [OG_IMAGE],
  },
};

export default async function PhotographyPackagesPage() {
  const t = await getT();
  const [live, waNumber, privateTours, photos, savedGroups] = await Promise.all([
    loadPhotographyPackages(),
    getWhatsAppNumber(),
    loadPrivateTours(3),
    getPhotographyPhotos(),
    loadPhotographyGroups(),
  ]);
  const packages = buildPackageCards(t, live, waNumber, savedGroups);
  const groups = [
    {
      id: 'weddings' as const,
      title: t('Weddings'),
      intro: t('Ceremony, portraits and film — for weddings, elopements and vow renewals.'),
    },
    {
      id: 'shoots' as const,
      title: t('Holiday & family shoots'),
      intro: t('Couples, honeymoons, proposals and families, on the beach or at your hotel.'),
    },
  ].filter((g) => packages.some((p) => p.group === g.id));

  const steps = [
    { title: t('Pick your date'), body: t('Only days we can actually shoot are shown.') },
    {
      title: t('Add your guests'),
      body: t('The price covers your couple or family; add extra guests if you need to.'),
    },
    {
      title: t('Choose add-ons'),
      body: t('Drone aerials, an extra hour, a same-day preview or a printed album.'),
    },
    {
      title: t('Pay 50% to book'),
      body: t('Pay half by card to secure your date — the rest when your photos are delivered.'),
    },
  ];

  const waGeneral = whatsappUrl(
    `Hi ${SITE.operator}! I’d like help choosing a photography package in Mauritius.`,
    waNumber,
  );

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Photography'), path: '/photography' },
          { name: t('Packages & prices'), path: '/photography/packages' },
        ])}
      />
      {live.length > 0 && (
        <JsonLd
          data={itemListJsonLd(live.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })))}
        />
      )}

      <GygHeader />
      <main className="bg-white">
        {/* Hero banner — the pricing-guide title over a calm sea. */}
        <section className="relative isolate flex min-h-[420px] items-center overflow-hidden bg-ink text-white sm:min-h-[480px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slotUrl(photos, 'pricing-hero')}
            alt={t('A couple on a Mauritius beach at sunset')}
            fetchPriority="high"
            className="pg-focus-in absolute inset-0 -z-10 h-full w-full object-cover object-[50%_60%]"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(10,46,54,0.55)_0%,rgba(10,46,54,0.35)_45%,rgba(10,46,54,0.85)_100%)]"
          />
          <div className="mx-auto w-full max-w-shell px-6 py-16 text-center">
            <nav
              aria-label={t('Breadcrumb')}
              className="mb-6 flex items-center justify-center gap-2 text-[12px] font-semibold text-white/70"
            >
              <Link href="/photography" className="hover:text-white">
                {t('Photography')}
              </Link>
              <span className="text-white/40">/</span>
              <span className="text-white">{t('Packages & prices')}</span>
            </nav>
            <p className="bm-rise text-[11px] font-bold uppercase tracking-[0.28em] text-teal-tint">
              {t('Photography & film · Mauritius')}
            </p>
            <h1 className="bm-rise mx-auto mt-4 max-w-[18ch] text-[clamp(34px,6vw,76px)] font-extrabold uppercase leading-[0.95] tracking-tight [animation-delay:0.12s] [text-shadow:0_14px_60px_rgba(4,20,26,0.5)]">
              {t('Photoshoot pricing guide')}
            </h1>
            <p className="bm-rise mx-auto mt-5 max-w-2xl text-[13px] font-bold uppercase tracking-[0.2em] text-white/85 [animation-delay:0.24s]">
              {t(
                'Packages for weddings, holidays, couples and families — pick yours and book online.',
              )}
            </p>
          </div>
        </section>

        {groups.map((g) => (
          <section key={g.id} id={g.id} className="scroll-mt-24 px-6 pt-16 sm:pt-20">
            <div className="mx-auto max-w-shell">
              <BlurFade className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
                    {t('Packages')}
                  </p>
                  <h2 className="mt-3 text-[clamp(26px,3.6vw,44px)] font-extrabold leading-none tracking-tight text-ink">
                    {g.title}
                  </h2>
                </div>
                <p className="max-w-sm text-[15px] leading-relaxed text-ink-muted">{g.intro}</p>
              </BlurFade>
              <RevealGroup className={`mt-8 grid gap-5 md:grid-cols-2 ${FOCUS_CARDS}`}>
                {packages
                  .filter((p) => p.group === g.id)
                  .map((p) => (
                    <PricingGuideCard
                      key={p.key}
                      pkg={p}
                      fromLabel={t('From')}
                      onRequestLabel={t('Price on request')}
                      ctaLabel={p.external ? t('Enquire') : t('See more')}
                    />
                  ))}
              </RevealGroup>
            </div>
          </section>
        ))}

        {/* How booking works — the four choices the package page offers. */}
        <section className="px-6 py-16 sm:py-24">
          <div className="mx-auto max-w-shell">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal">
              {t('How booking works')}
            </p>
            <h2 className="mt-3 max-w-[28ch] text-[clamp(26px,3.6vw,44px)] font-extrabold leading-none tracking-tight text-ink">
              {t('Your date, your party, your add-ons.')}
            </h2>
            <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <article
                  key={s.title}
                  className="rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_1px_3px_rgba(10,46,54,0.05)]"
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

        {/* Pair with a private tour — the reverse of a tour's photography add-on. */}
        {privateTours.length > 0 && (
          <section className="bg-[linear-gradient(180deg,#0B5C63_0%,#0A2E36_55%)] px-6 py-16 text-white sm:py-24">
            <div className="mx-auto max-w-shell">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-teal-tint">
                    {t('Make a day of it')}
                  </p>
                  <h2 className="mt-3 max-w-[20ch] text-[clamp(26px,3.6vw,44px)] font-extrabold leading-none tracking-tight">
                    {t('Pair your shoot with a private tour.')}
                  </h2>
                </div>
                <p className="max-w-sm text-[15px] leading-relaxed text-white/70">
                  {t('Your photographer comes along — both go in one basket and one checkout.')}
                </p>
              </div>
              <RevealGroup className="mt-10 grid gap-4 md:grid-cols-3">
                {privateTours.map((a) => {
                  const img = a.heroImage?.url ?? a.images[0]?.url;
                  return (
                    <Link
                      key={a.id}
                      href={`/activities/${a.slug}`}
                      className="group overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/10 transition hover:bg-white/[0.1]"
                    >
                      {img && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img}
                          alt={a.heroImage?.alt ?? a.title}
                          loading="lazy"
                          className="aspect-[16/10] w-full object-cover"
                        />
                      )}
                      <div className="p-5">
                        <h3 className="text-[17px] font-extrabold leading-snug">{a.title}</h3>
                        {a.fromPriceEur != null && (
                          <p className="mt-2 text-sm text-white/70">
                            {t('from')}{' '}
                            <Price eur={a.fromPriceEur} className="font-bold text-white" />
                          </p>
                        )}
                        <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-teal-tint">
                          {t('View tour')}
                          <IconArrowRight width={14} height={14} />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </RevealGroup>
            </div>
          </section>
        )}

        {/* Help. */}
        <section className="px-6 py-16 text-center sm:py-20">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-[clamp(24px,3vw,36px)] font-extrabold leading-tight tracking-tight text-ink">
              {t('Not sure which package fits?')}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              {t('Tell us your date and what you have in mind — we’ll suggest the right shoot.')}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-5">
              <a
                href={waGeneral}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-ink px-6 py-3.5 text-sm font-bold text-white hover:bg-teal-dark"
              >
                {t('Ask us on WhatsApp')}
              </a>
              <Link
                href="/photography"
                className="border-b border-coral/45 pb-1 text-[13px] font-bold text-coral-dark hover:border-coral-dark"
              >
                {t('Back to Photography & film')}
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
  return overrideMetadata('/photography/packages', DEFAULT_METADATA);
}
