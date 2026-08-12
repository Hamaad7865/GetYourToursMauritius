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

/**
 * The back office's sections, as DATA.
 *
 * Extracted from AdminShell so the list can be asserted without mounting the shell (which pulls in
 * the auth provider, the notification bell and the Supabase browser client). What is worth asserting
 * is not the labels but the two things that fail silently: an entry pointing at a route that does
 * not exist — a dead link in the only navigation staff have — and an entry the restricted 'seo'
 * content role can see but RLS will refuse, which reads to that user as a broken screen rather than
 * as a boundary. Both are covered in tests/unit/admin-quotes-editor.test.ts.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
  /** When true the item is also shown to the restricted 'seo' content role. */
  seo?: boolean;
}

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconGrid, exact: true },
  { href: '/admin/bookings', label: 'Bookings', icon: IconBookings },
  // Operations calendar — shows guest names, so deliberately NOT seo-flagged (RLS locks that role
  // out of bookings/occurrences anyway; this is just navigation).
  { href: '/admin/calendar', label: 'Calendar', icon: IconCalendar },
  // A drafted offer carries the guest's name, their email, the price we offered and the operator's
  // own margin note on one row, and sending one emails a stranger on the company's behalf — so this
  // is staff-only for the same reason the send route refuses the 'seo' role outright.
  { href: '/admin/quotes', label: 'Quotes', icon: IconMail },
  // Standalone documents (quotes/invoices/proformas/receipts) for any client, any currency, paid
  // offline or unpaid. Staff-only for the same reason quotes are: they carry a client's name, address
  // and the amounts billed, and the tables are is_staff()-only at the database.
  { href: '/admin/documents', label: 'Documents', icon: IconDocument },
  // Financial — deliberately NOT seo-flagged; the seo content role is RLS-locked out of bookings/payments.
  { href: '/admin/reports', label: 'Reports', icon: IconChart },
  { href: '/admin/activities', label: 'Tours', icon: IconTag, seo: true },
  { href: '/admin/categories', label: 'Categories', icon: IconSliders },
  { href: '/admin/content', label: 'Standard content', icon: IconDocument },
  { href: '/admin/vehicle-pricing', label: 'Pricing', icon: IconWallet },
  { href: '/admin/rental', label: 'Rental', icon: IconCar },
  { href: '/admin/planner-places', label: 'Places', icon: IconPin, seo: true },
  { href: '/admin/seo', label: 'SEO', icon: IconTrendUp, seo: true },
  { href: '/admin/blog', label: 'Blog', icon: IconDocument, seo: true },
  { href: '/admin/redirects', label: 'Redirects', icon: IconSwap, seo: true },
  { href: '/admin/leads', label: 'Leads', icon: IconUsers },
  // Customer-submitted content awaiting approval — deliberately NOT seo-flagged (guest_reviews RLS
  // is is_staff()-only; the seo role has no access, matching Tours' pricing/availability panels).
  { href: '/admin/reviews', label: 'Reviews', icon: IconStar },
];

/** Sections visible to a role: the 'seo' content role sees only the seo-flagged items; staff/admin
 *  see everything. RLS enforces the same boundary server-side — this is just navigation. */
export function navForRole(role: string | undefined): NavItem[] {
  return role === 'seo' ? ADMIN_NAV.filter((n) => n.seo) : ADMIN_NAV;
}

export const BOTTOM_NAV_HREFS = ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'];
export const BOTTOM_NAV_HREFS_SEO = [
  '/admin/seo',
  '/admin/blog',
  '/admin/activities',
  '/admin/redirects',
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
