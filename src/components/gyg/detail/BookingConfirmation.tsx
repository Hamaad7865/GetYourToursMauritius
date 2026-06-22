'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { ResumePaymentButton } from '@/components/checkout/ResumePaymentButton';
import { Price } from '@/components/site/Price';
import { Confetti } from '@/components/site/Confetti';
import { IconDownload } from '@/components/ui/icons';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { childSeatsCost } from '@/lib/services/pricing';
import {
  CONFIRM_POLL_INTERVAL_MS,
  CONFIRM_POLL_MAX_MS,
  isConfirmedStatus,
  shouldKeepPolling,
} from '@/lib/checkout/confirm-poll';

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
  dropoffLocation?: string | null;
  pickupPending?: boolean;
  childSeats?: number | null;
  /** Region-based transport add-on (EUR), already inside totalEur — shown as its own breakdown line. */
  transportEur?: number | null;
}

/** VAT is included in the booking total at this rate (matches the invoice/receipt). */
const VAT_RATE = 0.15;

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
  const justPaid = params.get('just_paid') != null;
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  // `confirming` drives the interim "Confirming your payment…" state while we poll a just-paid,
  // still-pending booking. `pollExhausted` flips when the window elapses without a flip to confirmed,
  // so we show a Refresh affordance instead of a cold dead-end.
  const [confirming, setConfirming] = useState(justPaid);
  const [pollExhausted, setPollExhausted] = useState(false);

  // Fetch the booking and return it so callers (the poll loop) can decide whether to keep going.
  const fetchBooking = useCallback(async (): Promise<Booking | null> => {
    if (!session) return null;
    const res = await fetch(`/api/v1/bookings/${bookingRef}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    }).then((r) => r.json());
    if (res.ok) {
      const next = res.data as Booking;
      setBooking(next);
      setLoading(false);
      return next;
    }
    setError(res.error?.message ?? t('Could not load your booking.'));
    setLoading(false);
    return null;
  }, [bookingRef, session, t]);

  useEffect(() => {
    if (session) void fetchBooking();
    else if (!authLoading) setLoading(false);
  }, [session, authLoading, fetchBooking]);

  // Poll a just-paid booking that is still `payment_pending`. The webhook may be absent at launch and
  // the provider settlement can land a beat after the redirect, so we re-fetch every few seconds for
  // up to CONFIRM_POLL_MAX_MS. Stops the instant the status flips to confirmed, or when the window
  // elapses (then we surface a manual Refresh affordance instead of a cold dead-end).
  useEffect(() => {
    if (!session) return;
    if (!booking || booking.status !== 'payment_pending') {
      // Nothing to confirm (already terminal) — clear any interim state.
      if (confirming) setConfirming(false);
      return;
    }
    if (!justPaid && !confirming) return;

    setConfirming(true);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const startedAt = Date.now();

    // Note: we deliberately don't re-trigger /api/v1/payments/sync from here — that endpoint keys off
    // the provider `checkoutId` (which this page doesn't hold). The embedded checkout already retries
    // sync before redirecting; here we just poll the authoritative booking status until it flips.
    const tick = async () => {
      if (stopped) return;
      const next = await fetchBooking();
      if (stopped) return;
      const status = next?.status ?? 'payment_pending';
      if (isConfirmedStatus(status)) {
        setConfirming(false);
        return;
      }
      if (!shouldKeepPolling({ status, elapsedMs: Date.now() - startedAt, maxMs: CONFIRM_POLL_MAX_MS })) {
        setConfirming(false);
        setPollExhausted(true);
        return;
      }
      timer = setTimeout(() => void tick(), CONFIRM_POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), CONFIRM_POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // We intentionally key this on the booking *status* (not the whole object) so a status flip
    // restarts/stops the loop, but a benign re-fetch of the same pending booking doesn't. `confirming`
    // is read but intentionally omitted so toggling it doesn't restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, booking?.status, justPaid, fetchBooking]);

  // Manual "Refresh status" — re-fetch on demand after the auto-poll window has elapsed.
  const [refreshing, setRefreshing] = useState(false);
  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await fetchBooking();
      if (next && next.status === 'payment_pending') {
        // Still pending — keep the exhausted state so the Refresh button remains visible.
        setPollExhausted(true);
      } else {
        setPollExhausted(false);
      }
    } finally {
      setRefreshing(false);
    }
  }, [fetchBooking]);

  // Download the invoice/receipt PDF. The endpoint is owner-scoped (bearer), so fetch it with the
  // token, then trigger a client-side download of the blob (a plain <a href> can't send the header).
  const [downloading, setDownloading] = useState(false);
  const downloadInvoice = useCallback(async () => {
    if (!session) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bookings/${bookingRef}/invoice`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        let msg = t('Could not download the invoice. Please try again.');
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body?.error?.message) msg = body.error.message;
        } catch {
          /* non-JSON (e.g. a gateway error) — keep the generic message */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${bookingRef}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not download the invoice. Please try again.'));
    } finally {
      setDownloading(false);
    }
  }, [bookingRef, session, t]);

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
      {paid && <Confetti />}
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
          {booking.transportEur != null && booking.transportEur > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-muted">{t('Door-to-door transport')}</dt>
              <dd className="font-medium text-ink">
                <Price eur={booking.transportEur} />
              </dd>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-ink/10 pt-2">
            <dt className="font-bold text-ink">{t('Total')}</dt>
            <dd className="text-lg font-extrabold text-ink">
              <Price eur={booking.totalEur} />
            </dd>
          </div>
          <div className="flex justify-between text-[12px] text-ink-muted">
            <dt>{t('Includes VAT ({pct}%)', { pct: 15 })}</dt>
            <dd>
              <Price eur={Math.round((booking.totalEur - booking.totalEur / (1 + VAT_RATE)) * 100) / 100} />
            </dd>
          </div>
        </dl>

        {(booking.pickupLocation || booking.pickupPending) && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Pickup location')}</div>
            {booking.pickupLocation ? (
              // Place names / addresses are DB content — shown verbatim, never translated.
              <p className="mt-1 text-[13px] text-ink/80">{booking.pickupLocation}</p>
            ) : (
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {t('Pickup to be arranged')}
              </span>
            )}
          </div>
        )}

        {/* Drop-off: a distinct address shows verbatim; a null drop-off WITH a pickup reads as
            "Same as pickup" (not "no drop-off"). Nothing shows when there's no pickup at all. */}
        {(booking.dropoffLocation || booking.pickupLocation || booking.pickupPending) && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Drop-off')}</div>
            {booking.dropoffLocation ? (
              // Place names / addresses are DB content — shown verbatim, never translated.
              <p className="mt-1 text-[13px] text-ink/80">{booking.dropoffLocation}</p>
            ) : (
              <p className="mt-1 text-[13px] text-ink/80">{t('Same as pickup')}</p>
            )}
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
          <div className="mt-6">
            <p className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal-dark">
              {t('Payment received — we’ve emailed your confirmation. See it any time in your bookings.')}
            </p>
            <button
              type="button"
              onClick={() => void downloadInvoice()}
              disabled={downloading}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal hover:bg-teal/5 disabled:opacity-60"
            >
              <IconDownload width={15} height={15} />
              {downloading ? t('Preparing…') : t('Download invoice (PDF)')}
            </button>
          </div>
        ) : awaitingPayment && confirming ? (
          // Interim state: payment just completed and we're polling for confirmation. Never a cold
          // dead-end — a spinner + reassuring copy while the provider/webhook settles.
          <div
            role="status"
            aria-live="polite"
            className="mt-6 flex items-center gap-3 rounded-xl bg-gold-light/20 px-4 py-3 text-sm text-ink"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal/30 border-t-teal"
            />
            <span>
              <span className="font-medium">{t('Confirming your payment…')}</span>{' '}
              {t('This usually takes a few seconds. You can keep this page open.')}
            </span>
          </div>
        ) : awaitingPayment && isStubReturn ? (
          <button
            type="button"
            onClick={completeStubPayment}
            disabled={paying}
            className="mt-6 w-full rounded-full bg-teal px-5 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {paying ? t('Completing…') : t('Complete payment (test)')}
          </button>
        ) : awaitingPayment ? (
          // Post-window (or never-confirming) fallback: a clear status with a manual Refresh and a
          // way to complete payment — explicitly NOT a silent dead-end.
          <div className="mt-6 rounded-xl bg-gold-light/20 px-4 py-3 text-sm text-ink">
            <p>
              {pollExhausted
                ? t('We haven’t received confirmation of your payment yet. It can take a little longer to settle.')
                : t('This booking is awaiting payment.')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshStatus()}
                disabled={refreshing}
                className="rounded-full bg-teal px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-60"
              >
                {refreshing ? t('Checking…') : t('Refresh status')}
              </button>
              {/* Mints a FRESH checkout session and lands on /pay?cid=… — the bare /pay link had no
                  cid, so the pay page could never start the payment for a returning customer. */}
              <ResumePaymentButton
                bookingRef={booking.ref}
                label={t('Complete payment')}
                className="rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal hover:bg-teal/5 disabled:opacity-60"
              />
              {/* Starting…/error/already-paid copy renders inside ResumePaymentButton. */}
            </div>
          </div>
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
