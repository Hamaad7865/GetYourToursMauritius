'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/site/Logo';
import { useAuth } from '@/components/auth/AuthProvider';
import { usePreferences, CURRENCY_LABELS, useT } from '@/components/site/PreferencesProvider';
import { useCart } from '@/lib/cart/useCart';
import { useInbox } from '@/lib/notifications/inbox';
import { SearchBar } from './SearchBar';
import { MainNav } from './MainNav';
import { MobileMenu } from './MobileMenu';
import { MobileSearch } from './MobileSearch';
import { NotificationsList } from '@/components/site/NotificationsList';
import {
  IconArrowRight,
  IconBell,
  IconBookings,
  IconCart,
  IconChevronLeft,
  IconChevronRight,
  IconGlobe,
  IconHeart,
  IconLogOut,
  IconSettings,
  IconUser,
} from '@/components/ui/icons';

/** Shared icon-over-label styling for the navbar actions. The `group relative` lets each
 *  action carry the centre-out coral underline (see <Underline/>). */
function navItemClass(light: boolean, extra = ''): string {
  return `group relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${
    light ? 'text-white' : 'text-ink'
  } ${extra}`;
}

/** Underline that grows from the centre outward on hover. White over the photo hero,
 *  teal on the solid bar (a white line would be invisible there). */
function Underline({ light = false }: { light?: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -bottom-0.5 left-1/2 h-[2px] w-0 -translate-x-1/2 rounded-full transition-[width] duration-300 ease-out group-hover:w-full ${
        light ? 'bg-white' : 'bg-teal'
      }`}
    />
  );
}

/** Profile navbar item — opens a dropdown. Signed out it offers sign-in; signed in it shows the
 *  account links plus an inline "Updates" inbox (the old standalone bell folded in here) and a
 *  Settings entry. The button carries the unread badge so notifications are still visible at a glance. */
function ProfileMenu({ overHero }: { overHero: boolean }) {
  const { user, profile, loading, openAuth, signOut } = useAuth();
  const { notes, unread, markAllRead } = useInbox();
  const t = useT();
  const [open, setOpen] = useState(false);
  // Master/detail inside the popover: the account menu, or the notifications inbox.
  const [view, setView] = useState<'menu' | 'updates'>('menu');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      // Always reopen on the menu, never stuck on the updates pane.
      setView('menu');
      return;
    }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const firstName = profile?.fullName?.trim().split(/\s+/)[0];
  const label = user && firstName ? firstName : t('Profile');
  const showBadge = !!user && unread > 0;
  const openUpdates = () => {
    markAllRead();
    setView('updates');
  };

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-cream hover:text-teal';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('Profile')}
        aria-expanded={open}
        className={navItemClass(overHero)}
      >
        <span className="relative">
          <IconUser width={20} height={20} />
          {showBadge && (
            <span
              aria-hidden
              className="absolute -right-2 -top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold leading-none text-ink"
            >
              {unread}
            </span>
          )}
        </span>
        <span className="hidden max-w-[6rem] truncate lg:block">{label}</span>
        <Underline light={overHero} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-ink/10 bg-white p-2 text-ink shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
          {loading ? (
            <div className="px-3 py-3 text-sm text-ink-muted">{t('Loading…')}</div>
          ) : view === 'updates' ? (
            <>
              <button
                type="button"
                onClick={() => setView('menu')}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-ink hover:bg-cream"
              >
                <IconChevronLeft width={18} height={18} /> {t('Updates')}
              </button>
              <div className="my-1 h-px bg-ink/10" />
              <NotificationsList notes={notes} />
            </>
          ) : user ? (
            <>
              <div className="px-3 pb-1 pt-2">
                <p className="truncate text-sm font-bold text-ink">
                  {profile?.fullName ?? t('Traveller')}
                </p>
                <p className="truncate text-[12px] text-ink-muted">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-ink/10" />
              <button type="button" onClick={openUpdates} className={itemClass}>
                <IconBell width={18} height={18} />
                <span className="flex-1 text-left">{t('Updates')}</span>
                {unread > 0 && (
                  <span className="grid h-4 min-w-[1rem] place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold leading-none text-ink">
                    {unread}
                  </span>
                )}
                <IconChevronRight width={16} height={16} className="text-ink-muted" />
              </button>
              <Link href="/account/bookings" onClick={() => setOpen(false)} className={itemClass}>
                <IconBookings width={18} height={18} /> {t('My bookings')}
              </Link>
              <Link href="/account" onClick={() => setOpen(false)} className={itemClass}>
                <IconSettings width={18} height={18} />
                <span className="flex-1 text-left">{t('Settings')}</span>
                <IconChevronRight width={16} height={16} className="text-ink-muted" />
              </Link>
              <div className="my-1 h-px bg-ink/10" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-cream hover:text-coral"
              >
                <IconLogOut width={18} height={18} /> {t('Log out')}
              </button>
            </>
          ) : (
            <>
              <div className="px-3 pb-1 pt-2 text-[15px] font-bold text-ink">{t('Profile')}</div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openAuth('signin');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-cream hover:text-teal"
              >
                <IconArrowRight width={18} height={18} /> {t('Log in or sign up')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Cart navbar item with a live count badge when items are in the cart. */
function CartAction({ overHero }: { overHero: boolean }) {
  const { count } = useCart();
  const t = useT();
  // Pop the icon when an item is ADDED (count rises) — but never on the initial load settle, where
  // the badge count flips 0 → N as the cart hydrates from localStorage. `primed` gates that: it turns
  // true a beat after mount, by which point hydration has settled, so only a genuine later add bumps
  // it. Each pop remounts the icon (via `popKey`) so the one-shot animation replays.
  const prevCount = useRef(count);
  const primed = useRef(false);
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => {
      primed.current = true;
    }, 600);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (primed.current && count > prevCount.current) setPopKey((k) => k + 1);
    prevCount.current = count;
  }, [count]);
  return (
    <Link
      href="/cart"
      aria-label={
        count > 0
          ? count === 1
            ? t('Cart, {n} item', { n: count })
            : t('Cart, {n} items', { n: count })
          : t('Cart')
      }
      className={navItemClass(overHero, 'relative flex')}
    >
      <span key={popKey} className={`relative ${popKey ? 'gyt-cart-add' : ''}`}>
        <IconCart width={20} height={20} />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-2 -top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold leading-none text-ink"
          >
            {count}
          </span>
        )}
      </span>
      <span className="hidden lg:block">{t('Cart')}</span>
      <Underline light={overHero} />
    </Link>
  );
}

/** Bookings navbar item — only appears once signed in, mirroring GetYourGuide. */
function BookingsAction({ overHero }: { overHero: boolean }) {
  const { user } = useAuth();
  const t = useT();
  if (!user) return null;
  return (
    <HeaderAction
      label={t('Bookings')}
      href="/account/bookings"
      light={overHero}
      icon={<IconBookings width={20} height={20} />}
    />
  );
}

/** Language + currency navbar item — opens the picker modal. */
function PrefsButton({ overHero }: { overHero: boolean }) {
  const { language, currency, openPrefs } = usePreferences();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => openPrefs('language')}
      className={navItemClass(overHero)}
      aria-label={t('Language and currency')}
    >
      <IconGlobe width={20} height={20} />
      <span className="hidden lg:block">
        {language.toUpperCase()}/{currency} {CURRENCY_LABELS[currency].symbol}
      </span>
      <Underline light={overHero} />
    </button>
  );
}

function HeaderAction({
  icon,
  label,
  href = '/account',
  className = '',
  light = false,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  className?: string;
  light?: boolean;
}) {
  return (
    <Link href={href} className={navItemClass(light, className)}>
      {icon}
      <span className="hidden lg:block">{label}</span>
      <Underline light={light} />
    </Link>
  );
}

/**
 * GetYourGuide-style sticky header. On the home page (`heroMode`) it overlays the
 * hero transparently at the top, then on scroll becomes a solid white bar with the
 * secondary nav row hidden and the search docked in. Elsewhere it's a plain white bar.
 *
 * Navbar actions mirror GetYourGuide: Wishlist · Cart · language/currency · Profile.
 */
export function GygHeader({
  heroMode = false,
  sticky = true,
  showSearch = true,
}: {
  heroMode?: boolean;
  /** Stick to the top on scroll. Detail pages pass false. */
  sticky?: boolean;
  /** Show the docked search field in the navbar (non-hero pages). */
  showSearch?: boolean;
}) {
  const t = useT();
  // Non-hero pages render the solid bar immediately; hero starts transparent.
  const [solid, setSolid] = useState(!heroMode);

  useEffect(() => {
    if (!heroMode) return;
    const onScroll = () => setSolid(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [heroMode]);

  const overHero = heroMode && !solid;
  const showNav = !heroMode || !solid;
  // The search lives in the navbar always (the hero body no longer carries it).
  const searchShown = heroMode ? true : showSearch;
  const position = heroMode ? 'fixed inset-x-0 top-0' : sticky ? 'sticky top-0' : 'relative';
  const bg = overHero ? 'bg-transparent' : 'bg-white shadow-[0_1px_8px_-2px_rgba(10,46,54,0.12)]';

  return (
    <header className={`${position} z-50 ${bg} transition-colors duration-300`}>
      <div className={overHero ? '' : 'border-b border-ink/[0.08]'}>
        <div className="mx-auto flex max-w-shell items-center gap-4 px-6 py-2.5">
          <Logo tone={overHero ? 'dark' : 'light'} />
          <div className="hidden min-w-0 flex-1 justify-center px-2 sm:flex">
            {searchShown && (
              <div className="w-full max-w-[560px]">
                <SearchBar variant="compact" />
              </div>
            )}
          </div>
          <nav className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
            <HeaderAction
              label={t('Wishlist')}
              href="/wishlist"
              light={overHero}
              icon={<IconHeart width={20} height={20} />}
            />
            <CartAction overHero={overHero} />
            {/* Bookings/currency/profile have no room on a phone — they live in the hamburger menu.
                Notifications used to be a standalone bell here; they now live inside the profile menu
                ("Updates"), with the unread badge surfaced on the profile button. */}
            <div className="hidden items-center gap-1 sm:flex">
              <BookingsAction overHero={overHero} />
              <PrefsButton overHero={overHero} />
              <ProfileMenu overHero={overHero} />
            </div>
            <MobileMenu light={overHero} />
          </nav>
        </div>

        {/* Phones: a sticky search bar pinned under the logo row (opens the full-screen search sheet). */}
        {searchShown && (
          <div className="mx-auto max-w-shell px-6 pb-3 sm:hidden">
            <MobileSearch />
          </div>
        )}
      </div>

      {showNav && (
        <div className={`hidden md:block ${overHero ? '' : 'border-b border-ink/[0.06]'}`}>
          <MainNav light={overHero} />
        </div>
      )}
    </header>
  );
}
