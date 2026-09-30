'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { accountTabs, isActiveAccountTab } from './account-tabs';
import { useAccountGalleries } from './useAccountGalleries';

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

/** Account-area tabs: a vertical left rail on sm+; a horizontally-scrollable, edge-to-edge tab strip on
 *  mobile (the five tabs don't fit a phone row, so they'd otherwise clip). The active tab is centred in
 *  the strip on mount/route change so it's always visible. */
export function AccountNav() {
  const t = useT();
  const { session } = useAuth();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  // Until the list has loaded (and whenever it could not, or the customer is signed out) there is no
  // Galleries tab — no flash of a tab that then vanishes.
  const galleries = useAccountGalleries(session);
  const tabs = accountTabs(galleries.status === 'ready' && galleries.cards.length > 0);

  // Centre the active tab within the mobile scroll strip (sets the nav's OWN scrollLeft only — never the
  // window). A no-op on sm+ where the rail is vertical and has no horizontal overflow. Re-runs when
  // Galleries appears, because that can be the active tab and it arrives after the first paint.
  useEffect(() => {
    const nav = navRef.current;
    const el = activeRef.current;
    if (!nav || !el) return;
    nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.clientWidth) / 2;
  }, [pathname, tabs.length]);

  return (
    <nav
      ref={navRef}
      className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-col sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = isActiveAccountTab(pathname, tab.href);
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
