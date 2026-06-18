'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Price } from '@/components/site/Price';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { childSeatsCost } from '@/lib/services/pricing';

interface BookingItem {
  priceLabel: string;
  quantity: number;
  pax?: number | null;
  subtotalEur: number;
}
interface Booking {
  ref: string;
  status: string;
  paymentState: string;
  customerName: string;
  totalEur: number;
  currency: string;
  items: BookingItem[];
  customItinerary?: Array<{ title: string; area?: string | null }> | null;
  pickupLocation?: string | null;
  childSeats?: number | null;
}

const STATUS_COPY: Record<string, { title: string; tone: string }> = {
  confirmed: { title: 'Booking confirmed 🎉', tone: 'text-teal-dark' },
  completed: { title: 'Trip completed', tone: 'text-teal-dark' },
  payment_pending: { title: 'Almost there — complete your payment', tone: 'text-ink' },
  cancelled: { title: 'Booking cancelled', tone: 'text-coral' },
  refunded: { title: 'Booking refunded', tone: 'text-ink-muted' },
};

export function BookingConfirmation({ bookingRef }: { bookingRef: string }) {
  const t = useT();
  const money = useMoney();
  const { user, session, loading: authLoading, openAuth } = useAuth();
  const params = useSearchParams();
  const isStubReturn = params.get('stub_session') != null;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const fetchBooking = useCallback(async () => {
    if (!session) return;
    const res = await fetch(`/api/v1/bookings/${bookingRef}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json());
    if (res.ok) setBooking(res.data as Booking);
    else setError(res.error?.message ?? t('Could not load your booking.'));
    setLoading(false);
  }, [bookingRef, session, t]);

  useEffect(() => {
    if (session) void fetchBooking();
    else if (!authLoading) setLoading(false);
  }, [session, authLoading, fetchBooking]);

  async function completeStubPayment() {
    setPaying(true);
    setError(null);
    try {
      // Simulates the payment provider's webhook (a real provider calls this server-to-server).
      const res = await fetch('/api/v1/webhooks/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingRef, outcome: 'paid', providerReference: `stub_ref_${bookingRef}` }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error?.message ?? t('Payment could not be completed.'));
      await fetchBooking();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Payment failed.'));
    } finally {
      setPaying(false);
    }
  }

  if (authLoading || loading) {
    return <p className="py-16 text-center text-sm text-ink-muted">{t('Loading your booking…')}</p>;
  }

  if (!user) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-ink-muted">{t('Sign in to view booking {ref}.', { ref: bookingRef })}</p>
        <button
          type="button"
          onClick={() => openAuth('signin')}
          className="mt-4 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          {t('Sign in')}
        </button>
      </div>
    );
  }

  if (error && !booking) {
    return <p className="py-16 text-center text-sm text-coral">{error}</p>;
  }
  if (!booking) return null;

  const paid = booking.paymentState === 'paid';
  const copy = STATUS_COPY[booking.status] ?? {
    title: t('Status: {status}', { status: booking.status }),
    tone: 'text-ink',
  };
  const awaitingPayment = !paid && booking.status === 'payment_pending';

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
        <h1 className={`font-display text-2xl font-semibold ${copy.tone}`}>{t(copy.title)}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {t('Reference')} <span className="font-bold text-ink">{booking.ref}</span>
        </p>

        <dl className="mt-6 flex flex-col gap-2 border-t border-ink/10 pt-4 text-sm">
          {booking.items.map((it, i) => (
            <div key={i} className="flex justify-between">
              <dt className="text-ink-muted">
                {it.pax != null
                  ? `${it.priceLabel} · ${it.pax} ${it.pax === 1 ? t('passenger') : t('passengers')}`
                  : `${it.quantity} × ${it.priceLabel}`}
              </dt>
              <dd className="font-medium text-ink">
                <Price eur={it.subtotalEur} />
              </dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-ink/10 pt-2">
            <dt className="font-bold text-ink">{t('Total')}</dt>
            <dd className="text-lg font-extrabold text-ink">
              <Price eur={booking.totalEur} />
            </dd>
          </div>
        </dl>

        {booking.pickupLocation && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Pickup location')}</div>
            <p className="mt-1 text-[13px] text-ink/80">{booking.pickupLocation}</p>
          </div>
        )}

        {booking.childSeats != null && booking.childSeats > 0 && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Baby & child seats')}</div>
            <p className="mt-1 text-[13px] text-ink/80">
              {booking.childSeats} {booking.childSeats === 1 ? t('seat') : t('seats')}
              {childSeatsCost(booking.childSeats) > 0
                ? ` — ${t('first free, {price} extra', { price: money(childSeatsCost(booking.childSeats)) })}`
                : ` — ${t('free')}`}
            </p>
          </div>
        )}

        {booking.customItinerary && booking.customItinerary.length > 0 && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Your route')}</div>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink/80">
              {booking.customItinerary.map((s, i) => (
                <li key={i}>
                  {s.title}
                  {s.area ? ` — ${s.area}` : ''}
                </li>
              ))}
            </ol>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-coral">
            {error}
          </p>
        )}

        {paid ? (
          <p className="mt-6 rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal-dark">
            {t('Payment received — we’ve emailed your confirmation. See it any time in your bookings.')}
          </p>
        ) : awaitingPayment && isStubReturn ? (
          <button
            type="button"
            onClick={completeStubPayment}
            disabled={paying}
            className="mt-6 w-full rounded-full bg-teal px-5 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {paying ? t('Completing…') : t('Complete payment (test)')}
          </button>
        ) : (
          <p className="mt-6 rounded-xl bg-gold-light/20 px-4 py-3 text-sm text-ink">
            {t('This booking is awaiting payment.')}
          </p>
        )}

        <div className="mt-5 flex justify-between text-sm font-bold">
          <Link href="/account/bookings" className="text-teal hover:text-teal-dark">
            {t('My bookings')}
          </Link>
          <Link href="/activities" className="text-ink-muted hover:text-ink">
            {t('Browse more')}
          </Link>
        </div>
      </div>
    </div>
  );
}
