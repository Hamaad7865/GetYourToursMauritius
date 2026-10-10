'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { useCategories } from '@/lib/categories/useCategories';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { localePath } from '@/lib/i18n/routing';
import {
  PLACES_MENU,
  THINGS_MENU_STATIC,
  type MenuGroup,
  type MenuLink,
} from '@/lib/nav/mega-menu';
import { IconPin } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

export type MegaMenuId = 'places' | 'things';

const COLUMNS = 3;

/**
 * A link's leading mark: its photo in a circle, or a pin tile when it has none — and also when the
 * photo fails to arrive. That second case is real: the photos come from Wikimedia through our proxy,
 * and a cold burst of eighteen at once gets some of them rate-limited (seen in testing). A pin is
 * what the reference shows for a place without a photo; an empty circle is just a hole.
 */
function Thumb({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-full bg-teal-tint object-cover"
      />
    );
  }
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink/[0.06] text-ink group-hover:bg-white">
      <IconPin width={18} height={18} />
    </span>
  );
}

/**
 * The panel under the header for "Places to see" and "Things to do", in GetYourGuide's layout: the
 * menu's groups down the left, the chosen group's links in three columns on the right.
 *
 * Loaded on demand by MainNav — nothing here is in a page's HTML or its first JavaScript, so adding
 * the menus added no site-wide links for a crawler to weigh and no weight to the first paint.
 *
 * The groups behave as vertical tabs: pointing at one (or focusing it, or the arrow keys) shows its
 * links. Links fill column by column, as the reference does, so a short group stays in the first
 * column instead of spreading one link per column.
 */
export function MegaMenu({ menu, onNavigate }: { menu: MegaMenuId; onNavigate: () => void }) {
  const t = useT();
  const { language } = usePreferences();
  const categories = useCategories();
  const [picked, setPicked] = useState<Record<MegaMenuId, string | null>>({
    places: null,
    things: null,
  });
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const groups: MenuGroup[] =
    menu === 'places'
      ? PLACES_MENU
      : [
          {
            id: 'tours',
            label: 'Tours & activities',
            // Category names are managed in the database; t() translates the ones it knows.
            links: categories.map((c) => ({
              label: c.name,
              href: categoryHref(c.name),
              translate: true,
            })),
            more: { label: 'See all activities', href: '/activities', translate: true },
          },
          ...THINGS_MENU_STATIC,
        ];
  const active = groups.find((g) => g.id === picked[menu]) ?? groups[0]!;
  const pick = (id: string) => setPicked((p) => ({ ...p, [menu]: id }));

  function onTabKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = groups.findIndex((g) => g.id === active.id);
    const next = groups[(index + step + groups.length) % groups.length]!;
    pick(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  const label = (link: MenuLink) => (link.translate ? t(link.label) : link.label);
  const rows = Math.max(1, Math.ceil(active.links.length / COLUMNS));

  return (
    <div className="mx-auto grid max-w-shell grid-cols-[minmax(0,16rem)_minmax(0,1fr)] px-6 pb-10 pt-9">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={menu === 'places' ? t('Places to see') : t('Things to do')}
        onKeyDown={onTabKeyDown}
        className="flex flex-col items-start gap-1 border-r border-ink/10 pr-6"
      >
        {groups.map((group) => {
          const selected = group.id === active.id;
          return (
            <button
              key={group.id}
              ref={(el) => {
                if (el) tabRefs.current.set(group.id, el);
                else tabRefs.current.delete(group.id);
              }}
              type="button"
              role="tab"
              id={`mega-tab-${group.id}`}
              aria-selected={selected}
              aria-controls="mega-panel"
              tabIndex={selected ? 0 : -1}
              onPointerEnter={() => pick(group.id)}
              onFocus={() => pick(group.id)}
              onClick={() => pick(group.id)}
              className={`flex items-center gap-3 rounded-lg py-2.5 pr-2 text-left text-[21px] font-extrabold leading-tight tracking-[-0.02em] transition-colors ${
                selected ? 'text-ink' : 'text-ink/60 hover:text-ink'
              }`}
            >
              <span
                aria-hidden
                className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                  selected ? 'bg-coral ring-[3px] ring-coral/25' : 'bg-transparent'
                }`}
              />
              {t(group.label)}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="mega-panel"
        aria-labelledby={`mega-tab-${active.id}`}
        className="min-h-[19.5rem] pl-9"
      >
        <ul
          className="grid grid-flow-col gap-x-6 gap-y-1"
          style={{
            gridTemplateRows: `repeat(${rows}, minmax(0, auto))`,
            gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          }}
        >
          {active.links.map((link) => (
            <li key={link.href}>
              <Link
                href={localePath(language, link.href)}
                onClick={onNavigate}
                className="group flex items-center gap-3 rounded-xl px-2 py-1.5 text-[15px] font-medium text-ink hover:bg-teal-tint"
              >
                <Thumb src={link.thumb} />
                <span className="min-w-0 truncate">{label(link)}</span>
              </Link>
            </li>
          ))}
        </ul>

        {active.more && (
          <Link
            href={localePath(language, active.more.href)}
            onClick={onNavigate}
            className="group ml-2 mt-5 inline-flex items-center gap-1.5 rounded-md text-[14px] font-bold text-teal-dark underline-offset-4 hover:underline"
          >
            {label(active.more)}
            <span
              aria-hidden
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
