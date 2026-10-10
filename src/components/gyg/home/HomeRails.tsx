'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { localePath } from '@/lib/i18n/routing';
import { useCategories } from '@/lib/categories/useCategories';
import { isSightseeingCategory } from '@/lib/categories/categories';
import { RECENT_VIEWS_EVENT, readRecentViews } from '@/lib/recent/views';
import { PlannerPromoCard } from '@/components/catalogue/PlannerPromoCard';
import { useHomeActivities } from '../HomeShowcaseContext';
import { PlaceCard } from '../PlaceCard';

const PER_PANEL = 8;
/** Below this many suggestions a "For you" tab is thinner than the tab it would displace. */
const MIN_FOR_YOU = 4;

const hasPhoto = (a: TourSummary) => a.heroImage != null || a.images.length > 0;

interface Panel {
  id: string;
  label: string;
  items: TourSummary[];
  href: string;
  /** Sightseeing tours lead with the trip-planner card, as their listing page does. */
  planner: boolean;
}

/**
 * Tours the visitor has NOT opened that share a category or a coast with ones they have — the same
 * kind of trip first, then the same part of the island. Built from recently-viewed slugs held in
 * this browser; nothing is inferred beyond what they looked at.
 */
function suggestionsFor(viewedSlugs: string[], activities: TourSummary[]): TourSummary[] {
  const viewed = activities.filter((a) => viewedSlugs.includes(a.slug));
  if (viewed.length === 0) return [];
  const categories = new Set(viewed.map((a) => a.category));
  const regions = new Set(viewed.map((a) => a.region).filter(Boolean));
  return activities
    .filter((a) => !viewedSlugs.includes(a.slug) && hasPhoto(a))
    .map((a, order) => ({
      a,
      order,
      score: (categories.has(a.category) ? 2 : 0) + (a.region && regions.has(a.region) ? 1 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, PER_PANEL)
    .map((x) => x.a);
}

/**
 * The homepage catalogue: one row of tabs instead of a section per category, so the page stays short
 * and every category is one click away. Tabs follow the managed category order (DB order, static
 * fallback before it loads); "All" is first and is what the server renders, and a returning visitor
 * gets a "For you" tab ahead of it, built from what they viewed.
 *
 * Every panel stays in the document — switching tabs only toggles `hidden` — so each tour link the
 * old per-category sections exposed to crawlers is still in the HTML.
 */
export function HomeRails() {
  const t = useT();
  const { language } = usePreferences();
  const activities = useHomeActivities();
  const categories = useCategories();
  const [viewed, setViewed] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const sync = () => setViewed(readRecentViews());
    sync();
    window.addEventListener(RECENT_VIEWS_EVENT, sync);
    return () => window.removeEventListener(RECENT_VIEWS_EVENT, sync);
  }, []);

  if (activities.length === 0) {
    return (
      <section id="home-showcase" className="mx-auto max-w-shell scroll-mt-24 px-6 py-16">
        <p className="text-center text-[15px] text-ink-muted">
          {t('Activities appear here once the catalogue is connected.')}
        </p>
      </section>
    );
  }

  const byCategory = new Map<string, TourSummary[]>();
  for (const a of activities) {
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }
  const categoryNames = [
    ...categories.map((c) => c.name).filter((name) => byCategory.has(name)),
    ...[...byCategory.keys()].filter((name) => !categories.some((c) => c.name === name)),
  ];

  const forYou = suggestionsFor(viewed, activities);
  const panels: Panel[] = [
    ...(forYou.length >= MIN_FOR_YOU
      ? [{ id: 'for-you', label: t('For you'), items: forYou, href: '/activities', planner: false }]
      : []),
    {
      id: 'all',
      label: t('All'),
      // Tours without a photo are still listed under their own category; they just don't lead.
      items: activities.filter(hasPhoto).slice(0, PER_PANEL),
      href: '/activities',
      planner: false,
    },
    ...categoryNames.map((name) => {
      const planner = isSightseeingCategory(name);
      return {
        id: `cat-${name}`,
        label: t(name),
        // Leave room for the promo card so a sightseeing panel still fills whole rows.
        items: byCategory.get(name)!.slice(0, planner ? PER_PANEL - 1 : PER_PANEL),
        href: categoryHref(name),
        planner,
      };
    }),
  ];
  const active = panels.find((p) => p.id === picked) ?? panels[0]!;

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = panels.findIndex((p) => p.id === active.id);
    const next = panels[(index + step + panels.length) % panels.length]!;
    setPicked(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <section
      id="home-showcase"
      aria-labelledby="showcase-heading"
      className="mx-auto max-w-shell scroll-mt-24 px-6 pt-14 sm:pt-16"
    >
      <div className="flex items-end justify-between gap-4">
        <h2
          id="showcase-heading"
          className="text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink"
        >
          {t('Things to do across Mauritius')}
        </h2>
        <Link
          href={localePath(language, active.href)}
          className="group hidden shrink-0 items-center gap-1.5 text-[14px] font-bold text-teal-dark underline-offset-4 hover:underline sm:inline-flex"
        >
          {active.id.startsWith('cat-')
            ? t('See all {category}', { category: active.label })
            : t('See all activities')}
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </div>

      <div
        role="tablist"
        aria-labelledby="showcase-heading"
        onKeyDown={onKeyDown}
        className="no-bar -mx-6 mt-4 flex gap-7 overflow-x-auto border-b border-ink/10 px-6 sm:mx-0 sm:px-0"
      >
        {panels.map((panel) => {
          const selected = panel.id === active.id;
          return (
            <button
              key={panel.id}
              ref={(el) => {
                if (el) tabRefs.current.set(panel.id, el);
                else tabRefs.current.delete(panel.id);
              }}
              type="button"
              role="tab"
              id={`tab-${panel.id}`}
              aria-selected={selected}
              aria-controls={`panel-${panel.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPicked(panel.id)}
              className={`relative shrink-0 whitespace-nowrap pb-3 pt-2 text-[15px] transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:rounded-full after:transition-colors ${
                selected
                  ? 'font-bold text-ink after:bg-teal-dark'
                  : 'font-semibold text-ink-muted after:bg-transparent hover:text-ink hover:after:bg-ink/20'
              }`}
            >
              {panel.label}
            </button>
          );
        })}
      </div>

      {panels.map((panel) => (
        <div
          key={panel.id}
          role="tabpanel"
          id={`panel-${panel.id}`}
          aria-labelledby={`tab-${panel.id}`}
          hidden={panel.id !== active.id}
          className="pt-6"
        >
          {/* Phones: an edge-to-edge snap rail (cards peek the next). sm+: a grid. scroll-px-6 must
              mirror px-6: snapping aligns cards to the snapport (the padding box, NOT the content
              box), so without it the browser re-snaps the first card flush with the screen edge. */}
          <div className="no-bar -mx-6 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
            {/* w-[80%] + shrink-0 sizes the phone rail cell; h-full only from sm: (grid mode), where
                the row has a definite track height for it to resolve against. */}
            {panel.planner && (
              <div className="w-[80%] shrink-0 snap-start sm:h-full sm:w-auto sm:shrink">
                <PlannerPromoCard />
              </div>
            )}
            {panel.items.map((activity) => (
              <div
                key={activity.id}
                className="w-[80%] shrink-0 snap-start sm:h-full sm:w-auto sm:shrink"
              >
                <PlaceCard activity={activity} />
              </div>
            ))}
          </div>
          <Link
            href={localePath(language, panel.href)}
            className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-bold text-teal-dark underline-offset-4 hover:underline sm:hidden"
          >
            {panel.id.startsWith('cat-')
              ? t('See all {category}', { category: panel.label })
              : t('See all activities')}
            <span aria-hidden>→</span>
          </Link>
        </div>
      ))}
    </section>
  );
}
