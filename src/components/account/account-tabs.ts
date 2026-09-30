import {
  IconBell,
  IconBookings,
  IconCamera,
  IconShield,
  IconUser,
  IconWallet,
} from '@/components/ui/icons';
import { splitLocalePath } from '@/lib/i18n/routing';

const TABS = [
  { href: '/account', label: 'Personal details', icon: IconUser },
  { href: '/account/bookings', label: 'Bookings', icon: IconBookings },
  { href: '/account/notifications', label: 'Notifications', icon: IconBell },
  { href: '/account/cards', label: 'Saved cards', icon: IconWallet },
  { href: '/account/privacy', label: 'Data & privacy', icon: IconShield },
];

/** The Galleries tab exists only for customers a gallery has been delivered to. */
const GALLERIES_TAB = { href: '/account/galleries', label: 'Galleries', icon: IconCamera };

/**
 * Whether `href` is the tab for the page being shown. The French site lives under /fr, and
 * `usePathname()` reports the prefixed path, so compare against the locale-free route — otherwise no
 * tab is ever marked current (or centred in the mobile strip) on a French page.
 */
export function isActiveAccountTab(pathname: string | null, href: string): boolean {
  return splitLocalePath(pathname ?? '/').path === href;
}

/** The rail's tabs: the fixed ones, plus Galleries (right after Bookings) once the customer has at
 *  least one delivered gallery — a customer with none never sees it. */
export function accountTabs(hasGalleries: boolean) {
  if (!hasGalleries) return TABS;
  const bookings = TABS.findIndex((tab) => tab.href === '/account/bookings');
  const at = bookings < 0 ? TABS.length : bookings + 1;
  return [...TABS.slice(0, at), GALLERIES_TAB, ...TABS.slice(at)];
}
