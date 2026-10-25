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
 */
export interface NavItem {
  href: string;
  label: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
  /** Who sees it: a permission (a list = any of them), 'owner', or null = everyone in the back office. */
  permission: PermissionKey | readonly PermissionKey[] | 'owner' | null;
}

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconGrid, exact: true, permission: null },
  {
    href: '/admin/bookings',
    label: 'Bookings',
    icon: IconBookings,
    permission: 'section.bookings',
  },
  {
    href: '/admin/calendar',
    label: 'Calendar',
    icon: IconCalendar,
    permission: 'section.calendar',
  },
  { href: '/admin/quotes', label: 'Quotes', icon: IconMail, permission: 'section.quotes' },
  {
    href: '/admin/documents',
    label: 'Documents',
    icon: IconDocument,
    permission: 'section.documents',
  },
  { href: '/admin/reports', label: 'Reports', icon: IconChart, permission: 'money.reports' },
  { href: '/admin/activities', label: 'Tours', icon: IconTag, permission: 'section.tours' },
  {
    href: '/admin/categories',
    label: 'Categories',
    icon: IconSliders,
    permission: 'section.categories',
  },
  {
    href: '/admin/content',
    label: 'Standard content',
    icon: IconDocument,
    permission: 'section.content',
  },
  // The Pricing page holds the fares AND the charge-currency card; either permission opens it, and the
  // page shows only the half that permission covers.
  {
    href: '/admin/vehicle-pricing',
    label: 'Pricing',
    icon: IconWallet,
    permission: ['money.prices', 'money.currency'],
  },
  { href: '/admin/rental', label: 'Rental', icon: IconCar, permission: 'section.rental' },
  { href: '/admin/planner-places', label: 'Places', icon: IconPin, permission: 'section.places' },
  { href: '/admin/seo', label: 'SEO', icon: IconTrendUp, permission: 'section.seo' },
  { href: '/admin/blog', label: 'Blog', icon: IconDocument, permission: 'section.blog' },
  { href: '/admin/redirects', label: 'Redirects', icon: IconSwap, permission: 'section.redirects' },
  { href: '/admin/leads', label: 'Leads', icon: IconUsers, permission: 'section.leads' },
  { href: '/admin/reviews', label: 'Reviews', icon: IconStar, permission: 'section.reviews' },
];

export function allows(access: AdminAccess, item: NavItem): boolean {
  if (item.permission === null) return true;
  if (item.permission === 'owner') return access.isOwner;
  return can(access, item.permission);
}

export function navFor(access: AdminAccess): NavItem[] {
  return ADMIN_NAV.filter((item) => allows(access, item));
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

export const BOTTOM_NAV_HREFS = ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'];
export const BOTTOM_NAV_HREFS_CONTENT = [
  '/admin/seo',
  '/admin/blog',
  '/admin/activities',
  '/admin/redirects',
];

/** The mobile bottom bar: the usual four, in that order, minus any the person cannot open. */
export function bottomNavFor(access: AdminAccess): NavItem[] {
  const hrefs = access.base === 'content' ? BOTTOM_NAV_HREFS_CONTENT : BOTTOM_NAV_HREFS;
  const items = navFor(access);
  return hrefs.flatMap((href) => items.filter((n) => n.href === href));
}
