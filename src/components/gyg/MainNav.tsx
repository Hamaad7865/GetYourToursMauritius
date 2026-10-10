'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCategories } from '@/lib/categories/useCategories';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { localePath } from '@/lib/i18n/routing';
import { useHomeShowcase, showActivitiesOnHome } from './HomeShowcaseContext';
import { IconChevron } from '@/components/ui/icons';
import type { MegaMenuId } from './MegaMenu';

/**
 * GetYourGuide-style primary nav row: an "Explore Mauritius" label, the two menus GetYourGuide's bar
 * has ("Places to see", "Things to do" — each opens a full-width panel under the header), then the
 * site's own six links. Every item carries a teal underline that grows from its centre outward on
 * hover/focus. "Activities" keeps its small hover list of categories; the rest are plain links.
 */

interface NavItem {
  label: string;
  href: string;
  menu?: 'categories';
}

const NAV_ITEMS: NavItem[] = [
  { label: 'About Us', href: '/about' },
  { label: 'Activities', href: '/activities', menu: 'categories' },
  { label: 'AI Trip Planner', href: '/ai-road-trip-planner' },
  { label: 'Rent', href: '/rent' },
  { label: 'Airport Transfers', href: '/airport-transfers' },
  { label: 'Contact us', href: '/contact' },
];

const MEGA_MENUS: { id: MegaMenuId; label: string }[] = [
  { id: 'places', label: 'Places to see' },
  { id: 'things', label: 'Things to do' },
];

const MEGA_PANEL_ID = 'mega-menu';
/** Long enough to cross the bar without a menu flashing open; short enough to feel immediate. */
const OPEN_DELAY_MS = 90;
/** Covers the diagonal trip from a trigger to a link at the far side of its panel. */
const CLOSE_DELAY_MS = 180;

// Fetched the first time a menu is wanted: its lists stay out of every page's HTML and first
// JavaScript. The placeholder holds the panel's height so it does not grow as the chunk lands.
const loadMegaMenu = () => import('./MegaMenu').then((m) => m.MegaMenu);
const MegaMenu = dynamic(loadMegaMenu, {
  ssr: false,
  loading: () => <div aria-hidden className="h-[25.75rem]" />,
});

/** Label with the centre-out underline. The parent must be a `group`; `active` pins both the
 *  underline and the turned chevron on, for a menu that is open. */
function NavLabel({
  label,
  light,
  hasMenu,
  active = false,
}: {
  label: string;
  light: boolean;
  hasMenu?: boolean;
  active?: boolean;
}) {
  return (
    <span className="relative inline-flex items-center gap-1">
      {/* A notch smaller below lg: eight items have to fit a 768px tablet without the row
          overflowing and dragging a horizontal scrollbar onto the whole page. */}
      <span className={`text-[13px] font-bold lg:text-sm ${light ? 'text-white' : 'text-ink'}`}>
        {label}
      </span>
      {hasMenu && (
        <IconChevron
          width={14}
          height={14}
          className={`transition-transform duration-200 group-hover:rotate-180 ${
            active ? 'rotate-180' : ''
          } ${light ? 'text-white/70' : 'text-ink-muted'}`}
        />
      )}
      <span
        aria-hidden
        className={`absolute -bottom-1 left-1/2 h-[2px] -translate-x-1/2 rounded-full transition-[width] duration-300 ease-out group-hover:w-full group-focus-within:w-full ${
          active ? 'w-full' : 'w-0'
        } ${light ? 'bg-white' : 'bg-teal'}`}
      />
    </span>
  );
}

function CategoriesMenu() {
  const categories = useCategories();
  const { language } = usePreferences();
  return (
    <div className="invisible absolute left-0 top-full z-50 w-64 -translate-y-1 rounded-2xl border border-ink/10 bg-white p-2 opacity-0 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)] transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={localePath(language, categoryHref(category.name))}
          className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream hover:text-teal"
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}

export function MainNav({ light }: { light: boolean }) {
  const showcase = useHomeShowcase();
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState<MegaMenuId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Map<MegaMenuId, HTMLButtonElement>>(new Map());
  const timer = useRef<number | null>(null);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(
    (next: MegaMenuId | null, delay: number) => {
      cancelTimer();
      timer.current = window.setTimeout(() => setOpen(next), delay);
    },
    [cancelTimer],
  );
  const close = useCallback(() => {
    cancelTimer();
    setOpen(null);
  }, [cancelTimer]);

  // Following a link in the panel lands on a new page (or the same page at a new anchor).
  useEffect(() => close(), [pathname, close]);
  useEffect(() => cancelTimer, [cancelTimer]);

  // On the homepage the header is clear over the hero until the page scrolls. An open panel is a
  // white sheet hanging from it, so the bar turns white with it (GygHeader styles the attribute).
  useEffect(() => {
    const header = rootRef.current?.closest('header');
    if (!header) return;
    header.toggleAttribute('data-menu-open', open !== null);
    return () => header.removeAttribute('data-menu-open');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Hand focus back to the trigger: the panel it was in is about to disappear.
      triggerRefs.current.get(open)?.focus();
      close();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Hover opens a menu for a mouse only. A touch also fires pointerenter, immediately before its
  // click — acting on both would open the menu and then toggle it shut again.
  const hover = (e: React.PointerEvent, next: MegaMenuId | null, delay: number) => {
    if (e.pointerType === 'mouse') schedule(next, delay);
  };

  return (
    <div ref={rootRef}>
      {/* flex-wrap is the backstop: French labels run ~15% longer, and on a 768px tablet the eight
          items no longer fit one line. A second line is fine; a page that scrolls sideways is not. */}
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-x-0.5 px-6 lg:gap-x-2">
        <span
          className={`hidden items-center gap-3 whitespace-nowrap pr-1 text-sm font-semibold xl:flex ${
            light ? 'text-white/80' : 'text-ink-muted'
          }`}
        >
          {t('Explore Mauritius')}
          <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-50" />
        </span>

        {MEGA_MENUS.map((menu) => (
          <div key={menu.id} className="group relative">
            <button
              ref={(el) => {
                if (el) triggerRefs.current.set(menu.id, el);
                else triggerRefs.current.delete(menu.id);
              }}
              type="button"
              aria-expanded={open === menu.id}
              aria-controls={MEGA_PANEL_ID}
              onClick={() => {
                cancelTimer();
                setOpen((current) => (current === menu.id ? null : menu.id));
              }}
              onPointerEnter={(e) => {
                void loadMegaMenu();
                hover(e, menu.id, OPEN_DELAY_MS);
              }}
              onPointerLeave={(e) => hover(e, null, CLOSE_DELAY_MS)}
              onFocus={() => void loadMegaMenu()}
              className="flex items-center whitespace-nowrap py-3 pr-1"
            >
              <NavLabel label={t(menu.label)} light={light} hasMenu active={open === menu.id} />
            </button>
          </div>
        ))}

        {NAV_ITEMS.map((item) => {
          // On the homepage, "Activities" swaps the showcase in place instead of navigating.
          const swapsOnHome = item.label === 'Activities' && showcase !== null;
          return (
            <div key={item.label} className="group relative">
              {swapsOnHome ? (
                <button
                  type="button"
                  onClick={() => showActivitiesOnHome(showcase)}
                  className="flex items-center whitespace-nowrap py-3 pr-1 outline-none"
                >
                  <NavLabel label={t(item.label)} light={light} hasMenu />
                </button>
              ) : (
                <Link
                  href={item.href}
                  className="flex items-center whitespace-nowrap py-3 pr-1 outline-none"
                >
                  <NavLabel label={t(item.label)} light={light} hasMenu={!!item.menu} />
                </Link>
              )}
              {item.menu === 'categories' && <CategoriesMenu />}
            </div>
          );
        })}
      </div>

      {/* Full width, hung from the header (the nearest positioned ancestor) — not from a nav item,
          which would pin it under that item and clip it to the row. */}
      {open && (
        <div
          id={MEGA_PANEL_ID}
          onPointerEnter={cancelTimer}
          onPointerLeave={(e) => hover(e, null, CLOSE_DELAY_MS)}
          className="absolute inset-x-0 top-full z-40 max-h-[calc(100vh-9rem)] overflow-y-auto border-t border-ink/[0.08] bg-white shadow-[0_28px_40px_-28px_rgba(10,46,54,0.5)]"
        >
          <MegaMenu menu={open} onNavigate={close} />
        </div>
      )}
    </div>
  );
}
