'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

interface BookingRow {
  ref: string;
  status: string;
  payment_state: string;
  total_minor: number;
  currency: string;
  created_at: string;
  booking_items: Array<{ price_label: string; quantity: number }>;
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

function label(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
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
        .select('ref, status, payment_state, total_minor, currency, created_at, booking_items(price_label, quantity)')
        .order('created_at', { ascending: false })
        .returns<BookingRow[]>();
      if (!active) return;
      if (error) setError(error.message);
      else setBookings(data ?? []);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  if (authLoading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message="Sign in to see your booking history." />;

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-ink">My bookings</h1>
      <p className="mt-1 text-sm text-ink-muted">Every trip you&apos;ve booked with Belle Mare Tours.</p>

      {error && (
        <p role="alert" className="mt-6 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}

      {bookings === null && !error && <div className="mt-6"><AccountSpinner /></div>}

      {bookings !== null && bookings.length === 0 && (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-10 text-center">
          <p className="text-sm text-ink-muted">You haven&apos;t booked anything yet.</p>
          <Link
            href="/activities"
            className="mt-4 inline-block rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
          >
            Explore activities
          </Link>
        </div>
      )}

      {bookings !== null && bookings.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {bookings.map((b) => {
            const guests = b.booking_items.reduce((sum, i) => sum + i.quantity, 0);
            const when = new Date(b.created_at).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            });
            return (
              <li
                key={b.ref}
                className="flex items-center justify-between gap-4 rounded-2xl border border-ink/10 bg-white px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-ink">{b.ref}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        STATUS_STYLES[b.status] ?? 'bg-ink/10 text-ink-muted'
                      }`}
                    >
                      {label(b.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {when} · {guests} {guests === 1 ? 'guest' : 'guests'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-bold text-ink">
                    €{(b.total_minor / 100).toFixed(2)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-ink-muted">{b.currency}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
