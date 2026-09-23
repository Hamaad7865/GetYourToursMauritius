'use client';

import Link from 'next/link';
import { useCategories } from '@/lib/categories/useCategories';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { usePhotographyPackages } from '@/lib/photography/usePhotographyPackages';
import { useHomeShowcase, showActivitiesOnHome } from './HomeShowcaseContext';
import { IconChevron } from '@/components/ui/icons';

/**
 * GetYourGuide-style primary nav row. Every item carries a coral underline that grows from
 * its centre outward on hover/focus. "Activities" opens a hover/focus mega-menu listing the
 * categories; the rest — including "Rent" — are plain links.
 */

interface NavItem {
  label: string;
  href: string;
  menu?: 'categories' | 'photography';
}

const NAV_ITEMS: NavItem[] = [
  { label: 'About Us', href: '/about' },
  { label: 'Activities', href: '/activities', menu: 'categories' },
  { label: 'AI Trip Planner', href: '/ai-road-trip-planner' },
  { label: 'Rent', href: '/rent' },
  { label: 'Airport Transfers', href: '/airport-transfers' },
  { label: 'Photography', href: '/photography', menu: 'photography' },
  { label: 'Contact us', href: '/contact' },
];

/** Label with the centre-out coral underline. The parent must be a `group`. */
function NavLabel({ label, light, hasMenu }: { label: string; light: boolean; hasMenu?: boolean }) {
  return (
    <span className="relative inline-flex items-center gap-1">
      <span className={`text-sm font-bold ${light ? 'text-white' : 'text-ink'}`}>{label}</span>
      {hasMenu && (
        <IconChevron
          width={14}
          height={14}
          className={`transition-transform duration-200 group-hover:rotate-180 ${
            light ? 'text-white/70' : 'text-ink-muted'
          }`}
        />
      )}
      <span
        aria-hidden
        className={`absolute -bottom-1 left-1/2 h-[2px] w-0 -translate-x-1/2 rounded-full transition-[width] duration-300 ease-out group-hover:w-full group-focus-within:w-full ${
          light ? 'bg-white' : 'bg-teal'
        }`}
      />
    </span>
  );
}

function CategoriesMenu() {
  const categories = useCategories();
  return (
    <div className="invisible absolute left-0 top-full z-50 w-64 -translate-y-1 rounded-2xl border border-ink/10 bg-white p-2 opacity-0 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)] transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/activities?category=${encodeURIComponent(category.name)}`}
          className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream hover:text-teal"
        >
          {category.name}
        </Link>
      ))}
    </div>
  );
}

/** The photography packages (live catalogue activities), then the price list and the overview. With
 *  no package published yet it still offers the two groups on the price list. */
function PhotographyMenu() {
  const t = useT();
  const packages = usePhotographyPackages();
  const link =
    'block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream hover:text-teal';
  return (
    <div className="invisible absolute left-0 top-full z-50 w-72 -translate-y-1 rounded-2xl border border-ink/10 bg-white p-2 opacity-0 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)] transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
      <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.22em] text-teal">
        {t('Packages')}
      </p>
      {packages.length > 0 ? (
        packages.slice(0, 8).map((p) => (
          <Link
            key={p.slug}
            href={`/activities/${p.slug}`}
            className={`${link} flex items-baseline justify-between gap-3`}
          >
            <span className="min-w-0 truncate">{p.title}</span>
            {p.fromPriceEur != null && (
              <span className="shrink-0 text-[12px] text-ink-muted">
                {t('from')} <Price eur={p.fromPriceEur} />
              </span>
            )}
          </Link>
        ))
      ) : (
        <>
          <Link href="/photography/packages#weddings" className={link}>
            {t('Weddings')}
          </Link>
          <Link href="/photography/packages#shoots" className={link}>
            {t('Holiday & family shoots')}
          </Link>
        </>
      )}
      <div className="mt-1 border-t border-ink/10 pt-1">
        <Link href="/photography/packages" className={`${link} font-bold text-teal-dark`}>
          {t('All packages & prices')}
        </Link>
        <Link href="/photography" className={link}>
          {t('Photography & film')}
        </Link>
      </div>
    </div>
  );
}

export function MainNav({ light }: { light: boolean }) {
  const showcase = useHomeShowcase();
  const t = useT();
  return (
    <div className="mx-auto flex max-w-shell items-center gap-2 px-6">
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
            {item.menu === 'photography' && <PhotographyMenu />}
          </div>
        );
      })}
    </div>
  );
}
