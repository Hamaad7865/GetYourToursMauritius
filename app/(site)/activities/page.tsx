import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { CategoryChips } from '@/components/catalogue/CategoryChips';
import { ActivityGrid } from '@/components/catalogue/ActivityGrid';
import { PlannerPromoCard } from '@/components/catalogue/PlannerPromoCard';
import { SearchFilterBar } from '@/components/catalogue/SearchFilterBar';
import { isSightseeingCategory } from '@/lib/categories/categories';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import {
  BROWSE_PAGE_SIZE,
  browseQueryString,
  parseBrowseParams,
  type BrowseParams,
} from '@/lib/catalogue/browse';
import { travellersQueryParams } from '@/lib/search/query';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { overrideMetadata } from '@/lib/seo/override';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { FaqAccordion } from '@/components/seo/LandingSections';
import { getLocale, getT } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';
import type { Locale } from '@/lib/i18n/config';
import type { TourSummary } from '@/lib/validation/tours';

// One array per locale, and the SAME array feeds the visible accordion and the FAQPage JSON-LD, so
// the two never drift (rich-result eligible) and /fr/activities no longer serves English FAQ data.
const ACTIVITIES_FAQS_EN: { q: string; a: string }[] = [
  {
    q: 'What activities can I book in Mauritius?',
    a: 'Catamaran cruises, dolphin swims, Île aux Cerfs day trips, sea walks, scuba diving, a submarine, hiking, skydiving, helicopter and seaplane flights, nature parks and private sightseeing tours, plus airport transfers. All of them are bookable online with instant confirmation.',
  },
  {
    q: 'What are the best activities in Mauritius?',
    a: 'The ones most visitors book are a catamaran day to Île aux Cerfs, an early dolphin swim off the west coast, an underwater sea walk and a private day tour of the wild south (Chamarel, Black River Gorges, Grand Bassin). For something bigger, try the seaplane over the “underwater waterfall” off Le Morne.',
  },
  {
    q: 'When is the best time of year for activities in Mauritius?',
    a: 'Every month works. The cooler, drier winter (May to October) is best for hiking, and whales pass the west coast from about July to October. The warm summer (November to April) brings the calmest, warmest sea for diving and snorkelling, with some cyclone risk from January to March.',
  },
  {
    q: 'How do I book a Mauritius activity online?',
    a: 'Pick an activity, choose your date and party size, and pay securely by card. You get an instant e-voucher by email — no reseller in the middle and no markup.',
  },
  {
    q: 'Are the activities run by a local operator?',
    a: 'Yes. Every activity is operated direct by Belle Mare Tours, a licensed Mauritian operator on the east coast — so you book with the people running the trip, not an overseas reseller.',
  },
  {
    q: 'Can I be picked up from my hotel?',
    a: 'Most activities include or offer door-to-door hotel pickup. The pickup option and any transport fee are shown on each activity before you book.',
  },
];

const ACTIVITIES_FAQS_FR: { q: string; a: string }[] = [
  {
    q: 'Quelles activités puis-je réserver à l’île Maurice ?',
    a: 'Croisières en catamaran, nage avec les dauphins, journées à l’Île aux Cerfs, marche sous-marine, plongée, sous-marin, randonnées, saut en parachute, vols en hélicoptère et en hydravion, parcs nature et visites privées de l’île, ainsi que les transferts aéroport. Tout se réserve en ligne avec confirmation immédiate.',
  },
  {
    q: 'Quelles sont les meilleures activités à l’île Maurice ?',
    a: 'Les plus demandées sont une journée en catamaran vers l’Île aux Cerfs, la nage matinale avec les dauphins sur la côte ouest, la marche sous-marine et une visite privée du sud sauvage (Chamarel, Black River Gorges, Grand Bassin). Pour une expérience hors du commun, essayez l’hydravion au-dessus de la « cascade sous-marine » du Morne.',
  },
  {
    q: 'Quelle est la meilleure période pour les activités à l’île Maurice ?',
    a: 'Toute l’année convient. L’hiver, plus frais et plus sec (mai à octobre), est idéal pour la randonnée, et les baleines longent la côte ouest d’environ juillet à octobre. L’été chaud (novembre à avril) offre la mer la plus calme et la plus chaude pour la plongée et le snorkeling, avec un risque de cyclone de janvier à mars.',
  },
  {
    q: 'Comment réserver une activité à Maurice en ligne ?',
    a: 'Choisissez une activité, la date et le nombre de participants, puis payez par carte en toute sécurité. Vous recevez un e-voucher immédiatement par e-mail — sans intermédiaire et sans marge.',
  },
  {
    q: 'Les activités sont-elles organisées par un opérateur local ?',
    a: 'Oui. Chaque activité est assurée en direct par Belle Mare Tours, un opérateur mauricien agréé de la côte est — vous réservez auprès de ceux qui organisent la sortie, pas d’un revendeur à l’étranger.',
  },
  {
    q: 'Puis-je être pris en charge à mon hôtel ?',
    a: 'La plupart des activités incluent ou proposent la prise en charge porte à porte à votre hôtel. L’option de prise en charge et les éventuels frais de transport sont indiqués sur chaque activité avant la réservation.',
  },
];

export const runtime = 'edge';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** adults/children carried from the header search — not a filter, just forwarded onto every
 *  result card's link so BookingProvider can seed the detail page's party size. */
function parseTravellersQs(raw: Record<string, string | string[] | undefined>): string {
  const adults = Number.parseInt(firstParam(raw.adults) ?? '', 10);
  const children = Number.parseInt(firstParam(raw.children) ?? '', 10);
  return travellersQueryParams(
    Number.isFinite(adults) ? adults : undefined,
    Number.isFinite(children) ? children : undefined,
  );
}

function heading(params: BrowseParams, t: Translate): string {
  if (params.q) return t('Results for “{q}”', { q: params.q });
  if (params.category) return t(params.category);
  if (params.type === 'transport') return t('Airport transfers & transport');
  if (params.type === 'activity') return t('Things to do');
  // Base (unfiltered) view: keyword-forward H1 — this is the page that should rank for "Mauritius activities".
  return t('Mauritius Activities & Tours');
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = parseBrowseParams(await searchParams);
  const t = await getT();
  const locale = await getLocale();
  // The unfiltered catalogue is the page that should rank for "Mauritius activities" — give it a
  // purpose-built title/description. Filtered views keep their dynamic heading. `absolute` in both
  // cases so the root "%s | Belle Mare Tours" template doesn't double-brand an already-branded title.
  const isBase = !params.q && !params.category && params.type === undefined;
  const title = isBase
    ? 'Mauritius Activities & Tours — Book Online | Belle Mare Tours'
    : `${heading(params, t)} | ${SITE.operator}`;
  const description = isBase
    ? 'Book Mauritius activities online, direct with the local operator: catamaran cruises, dolphin swims, sea walks, hiking, skydiving and private island tours.'
    : SITE.description;
  const defaults: Metadata = {
    title: { absolute: title },
    description,
    alternates: { canonical: '/activities' },
    openGraph: {
      type: 'website',
      title,
      description,
      locale: locale === 'fr' ? 'fr_FR' : 'en_GB',
      images: [OG_IMAGE],
    },
  };
  // Only the base catalogue takes the /admin/seo override — filtered views keep their dynamic heading.
  // (overrideMetadata would re-derive the same locale tag; computed once above either way.)
  return isBase ? overrideMetadata('/activities', defaults) : defaults;
}

async function loadResults(params: BrowseParams): Promise<{ items: TourSummary[]; total: number }> {
  try {
    const result = await searchActivities(publicServiceContext(await getLocale()), {
      page: params.page,
      pageSize: BROWSE_PAGE_SIZE,
      q: params.q,
      category: params.category,
      type: params.type,
    });
    return result;
  } catch (error) {
    console.error('[browse] catalogue fetch failed', error);
    return { items: [], total: 0 };
  }
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const params = parseBrowseParams(rawParams);
  const travellersQs = parseTravellersQs(rawParams);
  const t = await getT();
  const locale = await getLocale();
  const faqs = locale === 'fr' ? ACTIVITIES_FAQS_FR : ACTIVITIES_FAQS_EN;
  const { items, total } = await loadResults(params);
  const totalPages = Math.max(1, Math.ceil(total / BROWSE_PAGE_SIZE));
  // A tampered/stale ?page beyond the last page would render an empty grid under a
  // "Page N of N" footer — send the visitor to the last real page instead.
  if (total > 0 && params.page > totalPages) {
    redirect(`/activities${browseQueryString({ ...params, page: totalPages })}`);
  }
  const page = Math.min(params.page, totalPages);
  const isBase = !params.q && !params.category && params.type === undefined;

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: t('Home'), path: '/' },
          { name: t('Mauritius Activities'), path: '/activities' },
        ])}
      />
      {isBase && <JsonLd data={faqPageJsonLd(faqs)} />}
      {isBase && page === 1 && items.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            items.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
          )}
        />
      )}
      <GygHeader showSearch={false} />
      <main className="bg-cream">
        <div className="mx-auto max-w-shell px-6 pb-16 pt-6">
          <div className="mb-2">
            <h1 className="m-0 font-display text-3xl font-medium tracking-tight text-ink">
              {heading(params, t)}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {total > 0
                ? total === 1
                  ? t('{n} experience', { n: total })
                  : t('{n} experiences', { n: total })
                : t('Experiences')}{' '}
              {t('operated by {operator} · East-coast Mauritius', { operator: SITE.operator })}
            </p>
            {isBase && (
              <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-ink/70">
                {t(
                  'Browse and book the full range of Mauritius activities and tours direct with Belle Mare Tours — catamaran cruises, dolphin swims, Île aux Cerfs trips, sea walks and private island day tours, all with instant confirmation and no reseller markup.',
                )}
              </p>
            )}
          </div>

          <CategoryChips active={params.category} />

          {/* Mobile: pin the search/type filter below the header so it stays reachable while scrolling
              results. Desktop: a normal inline row. */}
          <div className="sticky top-[58px] z-30 -mx-6 mb-7 border-b border-ink/10 bg-cream px-6 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
            <SearchFilterBar params={params} />
          </div>

          <ActivityGrid
            activities={items}
            travellersQs={travellersQs}
            leadingCard={
              isSightseeingCategory(params.category) && page === 1 ? (
                <PlannerPromoCard />
              ) : undefined
            }
          />

          {totalPages > 1 && (
            <nav
              aria-label={t('Pagination')}
              className="mt-10 flex items-center justify-center gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page - 1 })}`}
                  className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="prev"
                >
                  ← {t('Previous')}
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  ← {t('Previous')}
                </span>
              )}
              <span className="text-ink-muted">
                {t('Page {page} of {total}', { page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/activities${browseQueryString({ ...params, page: page + 1 })}`}
                  className="rounded-xl border border-ink/15 bg-white px-4 py-2.5 font-semibold text-ink hover:border-teal"
                  rel="next"
                >
                  {t('Next')} →
                </Link>
              ) : (
                <span className="rounded-xl border border-ink/[0.06] px-4 py-2.5 font-semibold text-ink-muted/50">
                  {t('Next')} →
                </span>
              )}
            </nav>
          )}

          {isBase && <ActivitiesGuide locale={locale} t={t} />}

          {isBase && (
            <section className="mt-14 border-t border-ink/10 pt-10">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink">
                {t('Mauritius activities — frequently asked questions')}
              </h2>
              <div className="mt-5 max-w-3xl">
                <FaqAccordion items={faqs} />
              </div>
            </section>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * The unfiltered catalogue's editorial guide. A grid of cards alone gives Google little to rank for
 * "Mauritius activities" — the pages that do rank are written lists of things to do by type — so the
 * base view adds a short, crawlable guide that groups the catalogue and links each group to its
 * landing page or filtered listing. Prose is content, not UI chrome, so it picks an English or
 * French block by locale (the LandingSections convention) rather than going through t().
 */
/** Inline teal link inside the guide prose, on the visitor's own language prefix. */
function GuideLink({
  locale,
  href,
  children,
}: {
  locale: Locale;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={localePath(locale, href)}
      className="font-semibold text-teal underline underline-offset-2 hover:text-teal-dark"
    >
      {children}
    </Link>
  );
}

function ActivitiesGuide({ locale, t }: { locale: Locale; t: Translate }) {
  const fr = locale === 'fr';
  const groups = fr
    ? [
        {
          title: 'Sur l’eau',
          body: (
            <>
              Le lagon turquoise est la grande vedette de Maurice. Passez la journée en{' '}
              <GuideLink locale={locale} href="/mauritius-catamaran-cruise">
                croisière en catamaran
              </GuideLink>{' '}
              avec snorkeling et déjeuner grillé, rejoignez l’
              <GuideLink locale={locale} href="/ile-aux-cerfs-tours">
                Île aux Cerfs
              </GuideLink>{' '}
              en catamaran ou en vedette rapide, faites le tour des cinq îles de la côte est,
              admirez le coucher du soleil en mer, pagayez en kayak jusqu’à l’Île d’Ambre ou partez
              à la pêche au gros.
            </>
          ),
        },
        {
          title: 'Dauphins et baleines',
          body: (
            <>
              Tôt le matin, les dauphins sauvages se rassemblent dans les baies calmes de la côte
              ouest. Choisissez la{' '}
              <GuideLink locale={locale} href="/dolphin-swim-mauritius">
                nage avec les dauphins
              </GuideLink>{' '}
              seule ou une journée complète avec déjeuner à l’Île aux Bénitiers ; d’environ juillet
              à octobre, une sortie combine aussi l’observation des baleines.
            </>
          ),
        },
        {
          title: 'Sous la mer',
          body: (
            <>
              Pas besoin de savoir nager pour la marche sous-marine avec casque, idéale en famille.
              Les plus aventureux choisiront la plongée sous-marine ou le sous-marin et le
              subscooter de Blue Safari. Voir{' '}
              <GuideLink locale={locale} href="/activities?category=Sea walks & diving">
                marche sous-marine et plongée
              </GuideLink>
              .
            </>
          ),
        },
        {
          title: 'Sur terre',
          body: (
            <>
              L’intérieur de l’île est fait pour la randonnée :{' '}
              <GuideLink locale={locale} href="/activities?q=hiking">
                le Morne, les gorges de Rivière Noire et les sept cascades de Tamarin
              </GuideLink>
              . Ajoutez une balade à cheval sur la plage, ou une journée en famille à Casela ou au
              parc d’aventure de la Vallée.
            </>
          ),
        },
        {
          title: 'Dans les airs',
          body: (
            <>
              Vue d’en haut, Maurice est encore plus spectaculaire : saut en parachute en tandem,
              tour de l’île en hélicoptère, hydravion au-dessus de la « cascade sous-marine » du
              Morne, ou{' '}
              <GuideLink locale={locale} href="/activities?category=Parasailing">
                parachute ascensionnel
              </GuideLink>{' '}
              au-dessus du lagon.
            </>
          ),
        },
        {
          title: 'Visites de l’île',
          body: (
            <>
              Avec votre propre chauffeur-guide, découvrez le nord, le sud sauvage et la région du
              thé, Port-Louis ou les plus belles plages du nord, au rythme qui vous convient. Voir
              les{' '}
              <GuideLink locale={locale} href="/activities?category=Sightseeing tours">
                visites privées
              </GuideLink>
              , ou composez votre journée avec le{' '}
              <GuideLink locale={locale} href="/ai-road-trip-planner">
                planificateur de road trip IA
              </GuideLink>
              .
            </>
          ),
        },
      ]
    : [
        {
          title: 'On the water',
          body: (
            <>
              The turquoise lagoon is what Mauritius is famous for. Spend the day on a{' '}
              <GuideLink locale={locale} href="/mauritius-catamaran-cruise">
                catamaran cruise
              </GuideLink>{' '}
              with snorkelling stops and a grilled lunch, reach{' '}
              <GuideLink locale={locale} href="/ile-aux-cerfs-tours">
                Île aux Cerfs
              </GuideLink>{' '}
              by catamaran or speedboat, hop the five islands off the east coast, catch a sunset
              cruise, paddle a kayak to Ambre Island or go deep-sea fishing.
            </>
          ),
        },
        {
          title: 'Dolphins & whales',
          body: (
            <>
              Wild dolphins gather in the calm west-coast bays early in the morning. Book a{' '}
              <GuideLink locale={locale} href="/dolphin-swim-mauritius">
                dolphin swim
              </GuideLink>{' '}
              on its own or as a full day with lunch on Île aux Bénitiers; from about July to
              October, one trip adds whale-watching too.
            </>
          ),
        },
        {
          title: 'Under the sea',
          body: (
            <>
              An underwater sea walk needs no swimming and suits the whole family. For more, try
              scuba diving or the Blue Safari submarine and subscooter. Browse{' '}
              <GuideLink locale={locale} href="/activities?category=Sea walks & diving">
                sea walks &amp; diving
              </GuideLink>
              .
            </>
          ),
        },
        {
          title: 'On land',
          body: (
            <>
              The interior is made for walking:{' '}
              <GuideLink locale={locale} href="/activities?q=hiking">
                Le Morne, Black River Gorges and the Tamarind Falls
              </GuideLink>
              . Add horse riding on the beach, or a family day at Casela or Vallée Adventure Park.
            </>
          ),
        },
        {
          title: 'In the air',
          body: (
            <>
              Mauritius looks even better from above: tandem skydiving, a helicopter tour of the
              island, a seaplane over the “underwater waterfall” off Le Morne, or{' '}
              <GuideLink locale={locale} href="/activities?category=Parasailing">
                parasailing
              </GuideLink>{' '}
              over the lagoon.
            </>
          ),
        },
        {
          title: 'Island sightseeing',
          body: (
            <>
              With your own driver-guide, see the north, the wild south and tea country, Port Louis
              or the best northern beaches at your own pace. Browse{' '}
              <GuideLink locale={locale} href="/activities?category=Sightseeing tours">
                private sightseeing tours
              </GuideLink>
              , or plan your own day with the free{' '}
              <GuideLink locale={locale} href="/ai-road-trip-planner">
                AI road-trip planner
              </GuideLink>
              .
            </>
          ),
        },
      ];

  return (
    <section className="mt-14 border-t border-ink/10 pt-10">
      <h2 className="text-2xl font-extrabold tracking-tight text-ink">
        {t('Things to do in Mauritius, by type')}
      </h2>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink/75">
        {fr ? (
          <>
            Tout ce qui précède est organisé par {SITE.operator}, depuis Belle Mare sur la côte est,
            avec prise en charge à votre hôtel dans toute l’île. Pour des idées par région, voir les{' '}
            <GuideLink locale={locale} href="/attractions">
              choses à faire à Maurice
            </GuideLink>{' '}
            et les{' '}
            <GuideLink locale={locale} href="/mauritius-tours">
              excursions à Maurice
            </GuideLink>
            .
          </>
        ) : (
          <>
            Everything above is run by {SITE.operator} from Belle Mare on the east coast, with hotel
            pickup island-wide. For ideas by place, see{' '}
            <GuideLink locale={locale} href="/attractions">
              things to do in Mauritius
            </GuideLink>{' '}
            and our{' '}
            <GuideLink locale={locale} href="/mauritius-tours">
              Mauritius tours
            </GuideLink>{' '}
            guide.
          </>
        )}
      </p>
      <div className="mt-6 grid max-w-5xl gap-x-10 gap-y-6 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="text-[17px] font-bold text-ink">{g.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink/75">{g.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
