'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

interface BookingItem {
  price_label: string;
  quantity: number;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
  const guests = b.booking_items.reduce((sum, i) => sum + i.quantity, 0);
  const date = tripDate(b);
  const when = date ? formatDate(date.toISOString()) : formatDate(b.created_at);
  const title = tripTitle(b);
  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-ink">{title ?? b.ref}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              STATUS_STYLES[b.status] ?? 'bg-ink/10 text-ink-muted'
            }`}
          >
            {statusLabel(b.status)}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">
          {title ? `${b.ref} · ` : ''}
          {when} · {guests} {guests === 1 ? 'guest' : 'guests'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-bold text-ink">€{(b.total_minor / 100).toFixed(2)}</div>
        <div className="text-[11px] uppercase tracking-wide text-ink-muted">{b.currency}</div>
      </div>
    </li>
  );
}

export function AccountBookings() {
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
          'ref, status, payment_state, total_minor, currency, created_at, booking_items(price_label, quantity, session_occurrences(starts_at, activity_options(activities(title, slug))))',
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
  if (!user) return <SignedOutPrompt message="Sign in to see your booking history." />;

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
      <h1 className="font-display text-2xl font-semibold text-ink">My bookings</h1>
      <p className="mt-1 text-sm text-ink-muted">Every trip you&apos;ve booked with Belle Mare Tours.</p>

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
            <h2 className="font-display text-lg font-semibold text-ink">Upcoming bookings</h2>
            {upcoming.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-ink/10 bg-white p-8 text-center">
                <p className="text-sm text-ink-muted">
                  No bookings yet. Once you make a booking, you&apos;ll find it here.
                </p>
                <Link
                  href="/activities"
                  className="mt-4 inline-block rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
                >
                  Explore activities
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
            <h2 className="font-display text-lg font-semibold text-ink">Past &amp; cancelled bookings</h2>
            {past.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">You don&apos;t have any past bookings.</p>
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
