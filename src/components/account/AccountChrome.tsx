'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { IconBell, IconBookings, IconShield, IconUser, IconWallet } from '@/components/ui/icons';

export function AccountSpinner() {
  const t = useT();
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <p className="text-sm font-medium text-ink-muted">{t('Loading…')}</p>
    </div>
  );
}

export function SignedOutPrompt({ message }: { message: string }) {
  const t = useT();
  const { openAuth } = useAuth();
  return (
    <div className="grid min-h-[40vh] place-items-center px-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">{t('You’re signed out')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">{message}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
          >
            {t('Sign in')}
          </button>
          <button
            type="button"
            onClick={() => openAuth('signup')}
            className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:bg-cream"
          >
            {t('Create account')}
          </button>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { href: '/account', label: 'Personal details', icon: IconUser },
  { href: '/account/bookings', label: 'Bookings', icon: IconBookings },
  { href: '/account/notifications', label: 'Notifications', icon: IconBell },
  { href: '/account/cards', label: 'Saved cards', icon: IconWallet },
  { href: '/account/privacy', label: 'Data & privacy', icon: IconShield },
];

/** Account-area tabs: a vertical left rail on sm+; a horizontally-scrollable, edge-to-edge tab strip on
 *  mobile (the five tabs don't fit a phone row, so they'd otherwise clip). The active tab is centred in
 *  the strip on mount/route change so it's always visible. */
export function AccountNav() {
  const t = useT();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Centre the active tab within the mobile scroll strip (sets the nav's OWN scrollLeft only — never the
  // window). A no-op on sm+ where the rail is vertical and has no horizontal overflow.
  useEffect(() => {
    const nav = navRef.current;
    const el = activeRef.current;
    if (!nav || !el) return;
    nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.clientWidth) / 2;
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-col sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            ref={active ? activeRef : undefined}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-bold transition ${
              active ? 'bg-teal/10 text-teal-dark' : 'text-ink-muted hover:bg-cream hover:text-ink'
            }`}
          >
            <Icon width={18} height={18} />
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
