import type { ReactNode } from 'react';
import {
  IconBookings,
  IconCalendar,
  IconCar,
  IconChart,
  IconDocument,
  IconGrid,
  IconMail,
  IconPin,
  IconShield,
  IconSliders,
  IconStar,
  IconSwap,
  IconTag,
  IconTrendUp,
  IconUsers,
  IconWallet,
} from '@/components/ui/icons';
import { can, type AdminAccess, type PermissionKey } from '@/lib/admin/permissions';

/**
 * The back office's sections, as DATA.
 *
 * Extracted from AdminShell so the list can be asserted without mounting the shell. Each item names the
 * permission that opens it (src/lib/admin/permissions.ts); the owner decides who holds which in
 * /admin/roles. AdminShell uses the same item to guard the PAGE, not just the link, so typing a URL
 * shows "No access" — but the guarded data is only locked where the database locks it (prices, the
 * charge currency, refunds, roles). Covered in tests/unit/admin-permissions.test.ts.
 *
 * The sidebar shows the items in GROUPS (the back-office redesign,
 * docs/superpowers/specs/2026-11-14-backoffice-redesign-design.md). A group is presentation only: it
 * never decides who sees an item, and a group whose items someone may not open shows no label at all.
 */

/** The sidebar's groups, in the order they appear. Today stands alone above them (`group: null`). */
export const NAV_GROUPS = ['Operations', 'Catalogue', 'Money', 'Growth', 'Admin'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export interface NavItem {
  href: string;
  label: string;
  /** A shorter label for the phone's bottom bar, where five items share 360px. Defaults to `label`. */
  short?: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
  /** Who sees it: a permission (a list = any of them), 'owner', or null = any back-office member. */
  permission: PermissionKey | readonly PermissionKey[] | 'owner' | null;
  /** Its sidebar group, or null for Today, which sits above the groups. Presentation only. */
  group: NavGroup | null;
}

/**
 * In GROUP order, and within a group in sidebar order: `navFor` keeps this order, so the sidebar, the
 * breadcrumb and the phone's bottom bar all read the same list. A test keeps each group contiguous.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Today', icon: IconGrid, exact: true, permission: null, group: null },

  {
    href: '/admin/bookings',
    label: 'Bookings',
    icon: IconBookings,
    permission: 'section.bookings',
    group: 'Operations',
  },
  {
    href: '/admin/calendar',
    label: 'Calendar',
    icon: IconCalendar,
    permission: 'section.calendar',
    group: 'Operations',
  },
  {
    href: '/admin/quotes',
    label: 'Quotes',
    icon: IconMail,
    permission: 'section.quotes',
    group: 'Operations',
  },
  {
    href: '/admin/leads',
    label: 'Enquiries',
    icon: IconUsers,
    permission: 'section.leads',
    group: 'Operations',
  },

  {
    href: '/admin/activities',
    label: 'Tours',
    icon: IconTag,
    permission: 'section.tours',
    group: 'Catalogue',
  },
  // Categories and Standard content are two items for now; the redesign later shows them as two tabs
  // of one screen, each tab keeping its own route and permission.
  {
    href: '/admin/categories',
    label: 'Categories',
    icon: IconSliders,
    permission: 'section.categories',
    group: 'Catalogue',
  },
  {
    href: '/admin/content',
    label: 'Standard content',
    short: 'Content',
    icon: IconDocument,
    permission: 'section.content',
    group: 'Catalogue',
  },
  // The Pricing page holds the fares AND the charge-currency card; either permission opens it, and the
  // page shows only the half that permission covers.
  {
    href: '/admin/vehicle-pricing',
    label: 'Pricing',
    icon: IconWallet,
    permission: ['money.prices', 'money.currency'],
    group: 'Catalogue',
  },
  {
    href: '/admin/rental',
    label: 'Rental fleet',
    short: 'Rental',
    icon: IconCar,
    permission: 'section.rental',
    group: 'Catalogue',
  },
  {
    href: '/admin/planner-places',
    label: 'Planner places',
    short: 'Places',
    icon: IconPin,
    permission: 'section.places',
    group: 'Catalogue',
  },

  {
    href: '/admin/reports',
    label: 'Reports',
    icon: IconChart,
    permission: 'money.reports',
    group: 'Money',
  },
  {
    href: '/admin/documents',
    label: 'Documents',
    icon: IconDocument,
    permission: 'section.documents',
    group: 'Money',
  },

  {
    href: '/admin/seo',
    label: 'SEO',
    icon: IconTrendUp,
    permission: 'section.seo',
    group: 'Growth',
  },
  {
    href: '/admin/blog',
    label: 'Blog',
    icon: IconDocument,
    permission: 'section.blog',
    group: 'Growth',
  },
  {
    href: '/admin/reviews',
    label: 'Reviews',
    icon: IconStar,
    permission: 'section.reviews',
    group: 'Growth',
  },
  // Its own item for now (the redesign later makes it a tab of SEO). Last in Growth, so the content
  // role's sidebar and phone bar keep their old order: Tours, SEO, Blog, Redirects.
  {
    href: '/admin/redirects',
    label: 'Redirects',
    icon: IconSwap,
    permission: 'section.redirects',
    group: 'Growth',
  },

  // Owner only: who may open what. The database refuses every write behind it from anyone else.
  {
    href: '/admin/roles',
    label: 'Team and roles',
    short: 'Roles',
    icon: IconShield,
    permission: 'owner',
    group: 'Admin',
  },
];

export function allows(access: AdminAccess, item: NavItem): boolean {
  // null = any back-office member: the Owner, or someone on a team/content base (even with no role
  // yet). A customer, or nobody, is not a member.
  if (item.permission === null) return access.isOwner || access.base !== null;
  if (item.permission === 'owner') return access.isOwner;
  return can(access, item.permission);
}

export function navFor(access: AdminAccess): NavItem[] {
  return ADMIN_NAV.filter((item) => allows(access, item));
}

export interface NavSection {
  /** null = the ungrouped head of the list (Today), drawn without a label. */
  group: NavGroup | null;
  items: NavItem[];
}

/**
 * The sidebar's sections for an already-filtered list (`navFor(access)`): Today first, then each group
 * in NAV_GROUPS order. A group with no items is left out, so its label never shows over nothing.
 */
export function groupedNav(items: readonly NavItem[]): NavSection[] {
  const sections: NavSection[] = [];
  for (const group of [null, ...NAV_GROUPS] as const) {
    const inGroup = items.filter((item) => item.group === group);
    if (inGroup.length > 0) sections.push({ group, items: inGroup });
  }
  return sections;
}

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The nav item a path belongs to (the longest matching href), or null for a path no item owns. */
export function navItemForPath(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const item of ADMIN_NAV) {
    if (isActive(pathname, item) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/**
 * The top bar's breadcrumb: the section a path belongs to and its group ("Catalogue / Tours" on a tour's
 * edit page). Null for a path no item owns. Says nothing about access; the page guard decides that.
 */
export function crumbFor(
  pathname: string,
): { group: NavGroup | null; label: string; href: string } | null {
  const item = navItemForPath(pathname);
  return item ? { group: item.group, label: item.label, href: item.href } : null;
}

/**
 * The page guard: may this person see the screen at `pathname`? A path no nav item owns is Owner-only
 * (fail closed) — tests/unit/admin-permissions.test.ts keeps every real page inside the nav.
 */
export function pageAllowedFor(access: AdminAccess, pathname: string): boolean {
  const item = navItemForPath(pathname);
  return item ? allows(access, item) : access.isOwner;
}

export const BOTTOM_NAV_HREFS = ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'];
export const BOTTOM_NAV_HREFS_CONTENT = [
  '/admin/seo',
  '/admin/blog',
  '/admin/activities',
  '/admin/redirects',
];
const BOTTOM_NAV_SLOTS = 4;

/**
 * The mobile bottom bar, in sidebar order: the usual four that the person may open, topped up to four
 * from their other allowed items when they may open fewer (a Calendar-only role gets Calendar there,
 * not an empty bar).
 */
export function bottomNavFor(access: AdminAccess): NavItem[] {
  const usual = access.base === 'content' ? BOTTOM_NAV_HREFS_CONTENT : BOTTOM_NAV_HREFS;
  const items = navFor(access);
  const chosen = new Set(items.filter((n) => usual.includes(n.href)).map((n) => n.href));
  for (const item of items) {
    if (chosen.size >= BOTTOM_NAV_SLOTS) break;
    chosen.add(item.href);
  }
  return items.filter((n) => chosen.has(n.href));
}
