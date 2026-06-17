'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/site/Logo';
import { useDialog } from '@/lib/a11y/useDialog';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  usePreferences,
  LANGUAGE_LABELS,
  CURRENCY_LABELS,
} from '@/components/site/PreferencesProvider';
import {
  IconArrowRight,
  IconBolt,
  IconBookings,
  IconCart,
  IconChevronRight,
  IconGlobe,
  IconHeart,
  IconInfo,
  IconLogOut,
  IconMail,
  IconMenu,
  IconPin,
  IconStar,
  IconUser,
  IconWallet,
  IconX,
} from '@/components/ui/icons';

const NAV_LINKS = [
  { label: 'About us', href: '/about', icon: IconInfo },
  { label: 'Activities', href: '/activities', icon: IconStar },
  { label: 'Rent a car or scooter', href: '/rent', icon: IconWallet },
  { label: 'Airport transfer', href: '/airport-transfer', icon: IconBolt },
  { label: 'Taxi', href: '/taxi', icon: IconPin },
  { label: 'Contact us', href: '/contact', icon: IconMail },
];

/** A tappable row in the slide-over: leading icon, label, optional trailing value + chevron. */
function MenuRow({
  icon,
  label,
  value,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal/[0.08] text-teal">
        {icon}
      </span>
      <span className="flex-1 text-[15.5px] font-semibold text-ink">{label}</span>
      {value && <span className="text-[14px] font-medium text-ink-muted">{value}</span>}
      <IconChevronRight width={18} height={18} className="text-ink-muted" />
    </>
  );
  const cls =
    'flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left active:bg-cream';
  return href ? (
    <Link href={href} onClick={onClick} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Section({ title }: { title: string }) {
  return (
    <h2 className="px-2 pb-1 pt-5 font-display text-[15px] font-semibold tracking-tight text-ink">
      {title}
    </h2>
  );
}

/**
 * Mobile slide-over menu (the header hamburger on phones). Carries the primary nav, the profile
 * actions, and the currency/language pickers — everything the desktop navbar shows but that has no
 * room on a phone. The ink header echoes the lagoon hero.
 */
export function MobileMenu({ light = false }: { light?: boolean }) {
  const [open, setOpen] = useState(false);
  const { user, profile, openAuth, signOut } = useAuth();
  const { language, currency, openPrefs } = usePreferences();

  const close = () => setOpen(false);
  // Scroll-lock, Escape, focus move-in/return, and a Tab focus trap (APG modal dialog).
  const dialogRef = useDialog(open, close);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className={`grid h-11 w-11 place-items-center rounded-xl sm:hidden ${light ? 'text-white' : 'text-ink'}`}
      >
        <IconMenu width={24} height={24} />
      </button>

      {/* Overlay + panel. Mounted only while open; the panel slides from the right. */}
      {open && (
        <div ref={dialogRef} className="fixed inset-0 z-[70] sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          {/* Non-focusable scrim — click to dismiss; the X button + Escape handle keyboard. */}
          <div aria-hidden onClick={close} className="absolute inset-0 bg-ink/40" />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm animate-slide-in flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-ink px-5 py-3.5">
              <Logo tone="dark" />
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className="grid h-11 w-11 place-items-center rounded-full text-white/90 hover:bg-white/10"
              >
                <IconX width={22} height={22} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 pb-8 pt-2">
              <Section title="Explore" />
              {NAV_LINKS.map((l) => (
                <MenuRow
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  label={l.label}
                  icon={<l.icon width={18} height={18} />}
                />
              ))}

              <div className="my-2 h-px bg-ink/10" />
              <Section title="Profile" />
              {user ? (
                <>
                  <div className="px-2 pb-1">
                    <p className="truncate text-[15px] font-bold text-ink">
                      {profile?.fullName ?? 'Traveller'}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-muted">{user.email}</p>
                  </div>
                  <MenuRow href="/account" onClick={close} label="My profile" icon={<IconUser width={18} height={18} />} />
                  <MenuRow href="/account/bookings" onClick={close} label="My bookings" icon={<IconBookings width={18} height={18} />} />
                  <MenuRow
                    label="Log out"
                    icon={<IconLogOut width={18} height={18} />}
                    onClick={() => {
                      close();
                      void signOut();
                    }}
                  />
                </>
              ) : (
                <MenuRow
                  label="Log in or sign up"
                  icon={<IconArrowRight width={18} height={18} />}
                  onClick={() => {
                    close();
                    openAuth('signin');
                  }}
                />
              )}

              <div className="my-2 h-px bg-ink/10" />
              <Section title="Settings" />
              <MenuRow
                label="Currency"
                value={`${CURRENCY_LABELS[currency].label} ${CURRENCY_LABELS[currency].symbol}`}
                icon={<IconWallet width={18} height={18} />}
                onClick={() => {
                  close();
                  openPrefs('currency');
                }}
              />
              <MenuRow
                label="Language"
                value={LANGUAGE_LABELS[language]}
                icon={<IconGlobe width={18} height={18} />}
                onClick={() => {
                  close();
                  openPrefs('language');
                }}
              />

              <div className="my-2 h-px bg-ink/10" />
              <MenuRow href="/wishlist" onClick={close} label="Wishlist" icon={<IconHeart width={18} height={18} />} />
              <MenuRow href="/cart" onClick={close} label="Cart" icon={<IconCart width={18} height={18} />} />
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
