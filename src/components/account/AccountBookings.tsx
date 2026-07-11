'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { ResumePaymentButton } from '@/components/checkout/ResumePaymentButton';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { Price } from '@/components/site/Price';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

interface BookingItem {
  price_label: string;
  quantity: number;
  /** People on board for a vehicle booking (there quantity is the vehicle count = 1); null otherwise. */
  pax: number | null;
  session_occurrences: {
    starts_at: string | null;
    activity_options: { activities: { title: string | null; slug: string | null } | null } | null;
  } | null;
}

interface BookingRow {
  ref: string;
  status: string;
  payment_state: string;
  total_minor: number;
  currency: string;
  created_at: string;
  booking_items: BookingItem[];
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-teal/10 text-teal-dark',
  completed: 'bg-teal/10 text-teal-dark',
  payment_pending: 'bg-gold-light/20 text-ink',
  held: 'bg-gold-light/20 text-ink',
  draft: 'bg-ink/10 text-ink-muted',
  cancelled: 'bg-coral/10 text-coral',
  expired: 'bg-coral/10 text-coral',
  failed: 'bg-coral/10 text-coral',
  refunded: 'bg-ink/10 text-ink-muted',
  refund_pending: 'bg-ink/10 text-ink-muted',
};

const CANCELLED = new Set(['cancelled', 'expired', 'refunded', 'refund_pending', 'failed']);

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(iso: string, locale: Locale): string {
  return formatLocaleDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Earliest trip date across a booking's items, or null if none is known. */
function tripDate(b: BookingRow): Date | null {
  const times = b.booking_items
    .map((i) => i.session_occurrences?.starts_at)
    .filter((s): s is string => !!s)
    .map((s) => new Date(s).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function tripTitle(b: BookingRow): string | null {
  for (const i of b.booking_items) {
    const t = i.session_occurrences?.activity_options?.activities?.title;
    if (t) return t;
  }
  return null;
}

function BookingCard({ b }: { b: BookingRow }) {
  const t = useT();
  const { language } = usePreferences();
  // Vehicle bookings store the headcount in pax (quantity is the vehicle count = 1); fall back to
  // quantity for per-person/per-group lines — same as the admin manifest's coalesce(pax, quantity).
  const guests = b.booking_items.reduce((sum, i) => sum + (i.pax ?? i.quantity), 0);
  const date = tripDate(b);
  const when = date ? formatDate(date.toISOString(), language) : formatDate(b.created_at, language);
  const title = tripTitle(b);
  // An unpaid booking (e.g. the customer abandoned the payment step or returned later) needs a working
  // way to pay. ResumePaymentButton mints a fresh checkout session and lands on /pay?cid=… — without it
  // the bookings list offered no pay affordance at all and the email "Complete payment" link was dead.
  const awaitingPayment = b.status === 'payment_pending' && b.payment_state !== 'paid';
  return (
    <li className="group relative flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-4 transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(10,46,54,0.45)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-ink group-hover:text-teal-dark">{title ?? b.ref}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              STATUS_STYLES[b.status] ?? 'bg-ink/10 text-ink-muted'
            }`}
          >
            {t(statusLabel(b.status))}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {title ? `${b.ref} · ` : ''}
          {when} · {guests} {guests === 1 ? t('guest') : t('guests')}
        </p>
        {awaitingPayment && (
          // Above the stretched link so Pay stays independently clickable.
          <div className="relative z-10 mt-2">
            <ResumePaymentButton bookingRef={b.ref} label={t('Pay now')} />
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold text-ink">
          <Price eur={b.total_minor / 100} />
        </div>
        <div className="text-[11px] uppercase tracking-wide text-ink-muted">{b.currency}</div>
      </div>
      {/* Whole-card link to the booking detail (breakdown + invoice download). Stretched over the card
          but BELOW the Pay button's z-10 wrapper, so both stay clickable. */}
      <Link
        href={`/bookings/${b.ref}`}
        aria-label={t('View booking {ref}', { ref: b.ref })}
        className="absolute inset-0 rounded-2xl"
      />
    </li>
  );
}

export function AccountBookings() {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data, error } = await getBrowserSupabase()
        .from('bookings')
        .select(
          'ref, status, payment_state, total_minor, currency, created_at, booking_items(price_label, quantity, pax, session_occurrences(starts_at, activity_options(activities(title, slug))))',
        )
        .order('created_at', { ascending: false })
        .returns<BookingRow[]>();
      if (!active) return;
      if (error) {
        setError(error.message);
        // Still render both sections (with empty states) rather than collapsing to a bare error.
        setBookings([]);
      } else {
        setBookings(data ?? []);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (authLoading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to see your booking history.')} />;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const upcoming: BookingRow[] = [];
  const past: BookingRow[] = [];
  for (const b of bookings ?? []) {
    // Fall back to the booking date when the trip date is unknown (e.g. a since-unpublished
    // activity whose occurrence is no longer readable), so old bookings still bucket as past.
    const date = tripDate(b) ?? new Date(b.created_at);
    const isPast = date < startOfToday;
    if (CANCELLED.has(b.status) || isPast) past.push(b);
    else upcoming.push(b);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('My bookings')}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Every trip you’ve booked with Belle Mare Tours.')}
      </p>

      {error && (
        <p role="alert" className="mt-6 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}

      {bookings === null && !error && (
        <div className="mt-6">
          <AccountSpinner />
        </div>
      )}

      {bookings !== null && (
        <>
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold text-ink">
              {t('Upcoming bookings')}
            </h2>
            {upcoming.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-ink/10 bg-white p-8 text-center">
                <p className="text-sm text-ink-muted">
                  {t('No bookings yet. Once you make a booking, you’ll find it here.')}
                </p>
                <Link
                  href="/activities"
                  className="mt-4 inline-block rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
                >
                  {t('Explore activities')}
                </Link>
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {upcoming.map((b) => (
                  <BookingCard key={b.ref} b={b} />
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="font-display text-lg font-semibold text-ink">
              {t('Past & cancelled bookings')}
            </h2>
            {past.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                {t('You don’t have any past bookings.')}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {past.map((b) => (
                  <BookingCard key={b.ref} b={b} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
