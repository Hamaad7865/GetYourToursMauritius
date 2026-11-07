'use client';

import NextLink from 'next/link';
import Link from '@/components/site/LocaleLink';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { IconBell, IconBookings, IconShield, IconUser, IconWallet } from '@/components/ui/icons';

/** The white card every account tab sits in, on the grey band below the hero. */
export function AccountPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(10,46,54,0.45)] sm:p-7 ${className}`}
    >
      {children}
    </div>
  );
}

/** `inline` drops the card, for a spinner that sits inside a panel that is already there. */
export function AccountSpinner({ inline = false }: { inline?: boolean }) {
  const t = useT();
  const body = (
    <div className={`grid place-items-center ${inline ? 'min-h-[20vh]' : 'min-h-[30vh]'}`}>
      <p className="text-sm font-medium text-ink-muted">{t('Loading…')}</p>
    </div>
  );
  return inline ? body : <AccountPanel>{body}</AccountPanel>;
}

export function SignedOutPrompt({ message }: { message: string }) {
  const t = useT();
  const { openAuth } = useAuth();
  return (
    <AccountPanel>
      <div className="grid min-h-[30vh] place-items-center px-2 text-center">
        <div>
          {/* h2: the hero above already carries the page's one h1. */}
          <h2 className="font-display text-2xl font-semibold text-ink">{t('You’re signed out')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">{message}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => openAuth('signin')}
              className="rounded-full bg-teal-dark px-5 py-2.5 text-sm font-bold text-white hover:bg-ink"
            >
              {t('Sign in')}
            </button>
            <button
              type="button"
              onClick={() => openAuth('signup')}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:bg-ink/5"
            >
              {t('Create account')}
            </button>
          </div>
        </div>
      </div>
    </AccountPanel>
  );
}

/**
 * The account tabs. `title` is the hero heading when it differs from the rail label, `intro` the line
 * under it. The hero owns the page's h1, so the tab components themselves start at their content.
 */
const TABS = [
  {
    href: '/account',
    label: 'Personal details',
    intro: 'Manage your contact details for bookings.',
    icon: IconUser,
  },
  {
    href: '/account/bookings',
    label: 'Bookings',
    title: 'My bookings',
    intro: 'Every trip you’ve booked with Belle Mare Tours, all in one place.',
    icon: IconBookings,
  },
  {
    href: '/account/notifications',
    label: 'Notifications',
    intro: 'Updates about your cart holds and bookings.',
    icon: IconBell,
  },
  {
    href: '/account/cards',
    label: 'Saved cards',
    intro: 'Save a card at checkout for faster payment next time.',
    icon: IconWallet,
  },
  {
    href: '/account/privacy',
    label: 'Data & privacy',
    intro: 'Download a copy of your data, or permanently delete your account.',
    icon: IconShield,
  },
] as const;

/** The tab a path belongs to: an exact match, else the deepest tab it sits under (a sub-page). */
function activeTab(pathname: string | null) {
  const path = pathname ?? '';
  return (
    TABS.find((x) => x.href === path) ??
    [...TABS]
      .filter((x) => path.startsWith(`${x.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0] ??
    TABS[0]
  );
}

/** Bookings a guest actually made. An abandoned checkout (held/draft, then expired or failed) is not one. */
const NOT_A_BOOKING = '(draft,held,expired,failed)';

/**
 * How many bookings the signed-in account holds — the count on the rail's Bookings tab. Own rows only,
 * as on the bookings screen: a staff account must not count every booking it can read.
 */
function useBookingCount(): number | null {
  const { session } = useAuth();
  const ownerId = session?.user.id ?? null;
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!ownerId) {
      setCount(null);
      return;
    }
    let active = true;
    void getBrowserSupabase()
      .from('bookings')
      .select('ref', { count: 'exact', head: true })
      .eq('user_id', ownerId)
      .not('status', 'in', NOT_A_BOOKING)
      .then(({ count: n, error }) => {
        if (active) setCount(error ? null : (n ?? 0));
      });
    return () => {
      active = false;
    };
  }, [ownerId]);
  return count;
}

/** The dark band at the top of every account page: a greeting, the tab's title and what it is for. */
export function AccountHero() {
  const t = useT();
  const pathname = usePathname();
  const { session, profile } = useAuth();
  const tab = activeTab(pathname);
  const firstName = profile?.fullName?.trim().split(/\s+/)[0] || null;
  const heading = 'title' in tab ? tab.title : tab.label;
  return (
    <div className="relative overflow-hidden bg-ink text-white">
      <div className="relative mx-auto max-w-shell px-6 pb-20 pt-9 sm:pb-24 sm:pt-12">
        {session && (
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-bright">
            {firstName ? t('Bonjour, {name}', { name: firstName }) : t('Bonjour')}
          </p>
        )}
        <h1 className="mt-2 font-display text-[32px] font-extrabold leading-tight tracking-tight sm:text-[40px]">
          {t(heading)}
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/80 sm:text-[15px]">
          {t(tab.intro)}
        </p>
        <HeroWaves />
      </div>
    </div>
  );
}

function HeroWaves() {
  return (
    <svg
      viewBox="0 0 200 80"
      fill="none"
      aria-hidden
      className="pointer-events-none absolute bottom-16 right-6 hidden w-44 sm:block lg:w-52"
    >
      <circle cx="150" cy="22" r="15" className="fill-gold-light" />
      <path
        d="M4 50c16-8 32-8 48 0s32 8 48 0 32-8 48 0 32 8 48 0"
        className="stroke-teal-bright"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M4 64c16-8 32-8 48 0s32 8 48 0 32-8 48 0 32 8 48 0"
        className="stroke-teal-bright/50"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The rail: the tabs in a white card, and a way to reach a person (sm+; a phone has the tab strip). */
export function AccountRail() {
  const t = useT();
  return (
    <div className="rounded-3xl border border-ink/10 bg-white p-2 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.5)] sm:p-2.5">
      <AccountNav />
      <div className="mt-2.5 hidden rounded-2xl bg-[#F4F6F7] p-4 sm:block">
        <p className="text-sm font-bold text-ink">{t('Need a hand?')}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
          {t('Our team can help with changes, refunds and pick-ups.')}
        </p>
        <Link
          href="/contact"
          className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-bold text-teal-dark underline underline-offset-2 hover:text-ink"
        >
          {t('Contact us')} <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

/** Account-area tabs: a vertical list on sm+; a horizontally-scrollable tab strip on mobile (the five
 *  tabs don't fit a phone row, so they'd otherwise clip). The active tab is centred in the strip on
 *  mount/route change so it's always visible. */
export function AccountNav() {
  const t = useT();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  const bookingCount = useBookingCount();
  const current = activeTab(pathname).href;

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
      aria-label={t('Your account')}
      className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-col sm:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const active = current === tab.href;
        const Icon = tab.icon;
        const count = tab.href === '/account/bookings' ? bookingCount : null;
        return (
          // Account routes have no French URL, so plain next/link is right here.
          <NextLink
            key={tab.href}
            ref={active ? activeRef : undefined}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${
              active
                ? 'bg-teal-dark text-white shadow-[0_8px_18px_-10px_rgba(11,92,99,0.8)]'
                : 'text-ink hover:bg-ink/5'
            }`}
          >
            <Icon width={18} height={18} />
            {t(tab.label)}
            {count != null && count > 0 && (
              <span
                className={`ml-auto grid h-5 min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold ${
                  active ? 'bg-white text-teal-dark' : 'bg-teal/10 text-teal-dark'
                }`}
              >
                {count}
                <span className="sr-only"> {count === 1 ? t('booking') : t('bookings')}</span>
              </span>
            )}
          </NextLink>
        );
      })}
    </nav>
  );
}
