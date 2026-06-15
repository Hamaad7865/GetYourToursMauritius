'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/site/Logo';
import { useAuth } from '@/components/auth/AuthProvider';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { CATEGORIES } from '@/lib/seo/site';
import {
  IconArrowRight,
  IconBookings,
  IconCart,
  IconChevron,
  IconGlobe,
  IconHeart,
  IconLogOut,
  IconSearch,
  IconUser,
} from '@/components/ui/icons';

/** Shared icon-over-label styling for the navbar actions. */
function navItemClass(light: boolean, extra = ''): string {
  return `flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${
    light ? 'text-white hover:text-white/80' : 'text-ink hover:text-teal'
  } ${extra}`;
}

/** Profile navbar item — opens a dropdown. Signed out it offers sign-in; signed in it
 *  shows the account links (bookings only appear here, never before sign-in). */
function ProfileMenu({ overHero }: { overHero: boolean }) {
  const { user, profile, loading, openAuth, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile"
        aria-expanded={open}
        className={navItemClass(overHero)}
      >
        <IconUser width={20} height={20} />
        <span className="hidden lg:block">Profile</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-ink/10 bg-white p-2 text-ink shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
          {loading ? (
            <div className="px-3 py-3 text-sm text-ink-muted">Loading…</div>
          ) : user ? (
            <>
              <div className="px-3 pb-1 pt-2">
                <p className="truncate text-sm font-bold text-ink">{profile?.fullName ?? 'Traveller'}</p>
                <p className="truncate text-[12px] text-ink-muted">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-ink/10" />
              <Link
                href="/account"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-cream hover:text-teal"
              >
                <IconUser width={18} height={18} /> My profile
              </Link>
              <Link
                href="/account/bookings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-cream hover:text-teal"
              >
                <IconBookings width={18} height={18} /> My bookings
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
                <IconLogOut width={18} height={18} /> Log out
              </button>
            </>
          ) : (
            <>
              <div className="px-3 pb-1 pt-2 text-[15px] font-bold text-ink">Profile</div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openAuth('signin');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold hover:bg-cream hover:text-teal"
              >
                <IconArrowRight width={18} height={18} /> Log in or sign up
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Language + currency navbar item — opens the picker modal. */
function PrefsButton({ overHero }: { overHero: boolean }) {
  const { language, openPrefs } = usePreferences();
  return (
    <button type="button" onClick={() => openPrefs('language')} className={navItemClass(overHero)} aria-label="Language and currency">
      <IconGlobe width={20} height={20} />
      <span className="hidden lg:block">{language.toUpperCase()}/EUR €</span>
    </button>
  );
}

/** Compact search field that docks into the navbar on scroll. */
function DockedSearch({ shown }: { shown: boolean }) {
  return (
    <Link
      href="/activities"
      aria-label="Search activities"
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/15 bg-white py-2 pl-4 pr-2 shadow-sm transition-all duration-300 ${
        shown ? 'max-w-[460px] opacity-100' : 'pointer-events-none max-w-0 border-transparent opacity-0'
      }`}
    >
      <IconSearch width={18} height={18} className="shrink-0 text-teal" />
      <span className="flex-1 truncate text-left text-sm font-medium text-ink-muted">
        Find places and things to do
      </span>
      <span className="shrink-0 rounded-full bg-teal px-4 py-1.5 text-[13px] font-bold text-white">
        Search
      </span>
    </Link>
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
  // Non-hero pages render the solid bar immediately; hero starts transparent.
  const [solid, setSolid] = useState(!heroMode);
  const [searchDocked, setSearchDocked] = useState(false);

  useEffect(() => {
    if (!heroMode) return;
    const onScroll = () => {
      setSolid(window.scrollY > 40);
      setSearchDocked(window.scrollY > 280);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [heroMode]);

  const overHero = heroMode && !solid;
  const showNav = !heroMode || !solid;
  const searchShown = heroMode ? searchDocked : showSearch;
  const position = heroMode ? 'fixed inset-x-0 top-0' : sticky ? 'sticky top-0' : 'relative';
  const bg = overHero ? 'bg-transparent' : 'bg-white shadow-[0_1px_8px_-2px_rgba(10,46,54,0.12)]';

  return (
    <header className={`${position} z-50 ${bg} transition-colors duration-300`}>
      <div className={overHero ? '' : 'border-b border-ink/[0.08]'}>
        <div className="mx-auto flex max-w-shell items-center gap-4 px-6 py-2.5">
          <Logo tone={overHero ? 'dark' : 'light'} />
          <div className="hidden min-w-0 flex-1 justify-center px-2 sm:flex">
            <DockedSearch shown={searchShown} />
          </div>
          <nav className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
            <HeaderAction label="Wishlist" light={overHero} icon={<IconHeart width={20} height={20} />} />
            <HeaderAction
              label="Cart"
              light={overHero}
              className="hidden sm:flex"
              icon={<IconCart width={20} height={20} />}
            />
            <PrefsButton overHero={overHero} />
            <ProfileMenu overHero={overHero} />
          </nav>
        </div>
      </div>

      {showNav && (
        <div className={overHero ? '' : 'border-b border-ink/[0.06]'}>
          <div className="mx-auto flex max-w-shell items-center gap-1 px-6">
            <div className="group relative">
              <button
                className={`flex items-center gap-1.5 py-3 pr-3 text-sm font-bold ${
                  overHero ? 'text-white' : 'text-ink'
                }`}
              >
                Things to do{' '}
                <IconChevron
                  width={15}
                  height={15}
                  className={overHero ? 'text-white/70' : 'text-ink-muted'}
                />
              </button>
              <div className="invisible absolute left-0 top-full z-50 w-64 -translate-y-1 rounded-2xl border border-ink/10 bg-white p-2 opacity-0 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)] transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                {CATEGORIES.map((category) => (
                  <Link
                    key={category}
                    href={`/activities?category=${encodeURIComponent(category)}`}
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-cream hover:text-teal"
                  >
                    {category}
                  </Link>
                ))}
              </div>
            </div>
            {CATEGORIES.slice(0, 5).map((category) => (
              <Link
                key={category}
                href={`/activities?category=${encodeURIComponent(category)}`}
                className={`hidden whitespace-nowrap rounded-lg px-3 py-3 text-sm font-medium lg:block ${
                  overHero ? 'text-white/90 hover:text-white' : 'text-ink-muted hover:text-teal'
                }`}
              >
                {category}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
