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
import { whatsappUrl } from '@/lib/seo/site';
import { transferLegs } from '@/lib/transfers/leg-times';
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
  // Airport-transfer run-sheet — present only for transfer bookings (a truthy tripDirection marks one).
  // These already arrive on the wire DTO; the block below renders them and unlocks the e-voucher download.
  tripDirection?: string | null;
  flightNumber?: string | null;
  arrivalTime?: string | null;
  returnDate?: string | null;
  returnTime?: string | null;
  departureFlightNumber?: string | null;
  roomOrCabin?: string | null;
  luggageDetails?: string | null;
  childSeatAge?: number | null;
  travellerCountry?: string | null;
  travellerCompany?: string | null;
  travellerGender?: string | null;
  specialNotes?: string | null;
  /** True when the customer may self-cancel for a refund (confirmed + paid + the trip is >24h away). */
  cancellable?: boolean | null;
  /** The booking's occurrence date (ISO) — the transfer's arrival/service date, for the run-sheet. */
  serviceDate?: string | null;
}

/** VAT is included in the booking total at this rate (matches the invoice/receipt). */
const VAT_RATE = 0.15;

const STATUS_COPY: Record<string, { title: string; tone: string }> = {
  confirmed: { title: 'Booking confirmed 🎉', tone: 'text-teal-dark' },
  completed: { title: 'Trip completed', tone: 'text-teal-dark' },
  payment_pending: { title: 'Almost there — complete your payment', tone: 'text-ink' },
  cancelled: { title: 'Booking cancelled', tone: 'text-coral' },
  refund_pending: { title: 'Cancelled — refund on its way', tone: 'text-ink' },
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
    try {
      const res = await fetch(`/api/v1/bookings/${bookingRef}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      }).then((r) => r.json());
      if (res.ok) {
        const next = res.data as Booking;
        setBooking(next);
        setError(null); // clear any prior transient error once a fetch succeeds
        setLoading(false);
        return next;
      }
      setError(res.error?.message ?? t('Could not load your booking.'));
      setLoading(false);
      return null;
    } catch {
      // A network failure / non-JSON body used to reject unhandled, leaving `loading` true forever
      // (a perpetual "Loading your booking…" spinner). Surface a retryable error instead.
      setError(t('Could not load your booking. Please check your connection and try again.'));
      setLoading(false);
      return null;
    }
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
      if (
        !shouldKeepPolling({
          status,
          elapsedMs: Date.now() - startedAt,
          maxMs: CONFIRM_POLL_MAX_MS,
        })
      ) {
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

  // Retry the INITIAL load after a network failure (the `error && !booking` dead-end below). Re-shows
  // the spinner and re-fetches, so a transient blip on first paint isn't a permanent error screen.
  const retryLoad = useCallback(() => {
    setError(null);
    setLoading(true);
    void fetchBooking();
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
      setError(
        err instanceof Error ? err.message : t('Could not download the invoice. Please try again.'),
      );
    } finally {
      setDownloading(false);
    }
  }, [bookingRef, session, t]);

  // Download the airport-transfer e-voucher PDF (driver run-sheet + QR). Same owner-scoped fetch pattern
  // as the invoice; only shown for transfer bookings.
  const [downloadingVoucher, setDownloadingVoucher] = useState(false);
  const downloadVoucher = useCallback(async () => {
    if (!session) return;
    setDownloadingVoucher(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bookings/${bookingRef}/voucher`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        let msg = t('Could not download the e-voucher. Please try again.');
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
      a.download = `voucher-${bookingRef}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('Could not download the e-voucher. Please try again.'),
      );
    } finally {
      setDownloadingVoucher(false);
    }
  }, [bookingRef, session, t]);

  // Customer self-service cancel → refund. POSTs the cancel; on success re-fetches so the status flips to
  // refund_pending and the card switches to the "refund on its way" state. The server enforces the window.
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancelBookingAction = useCallback(async () => {
    if (!session) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bookings/${bookingRef}/cancel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        let msg = t('Could not cancel the booking. Please try again.');
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body?.error?.message) msg = body.error.message;
        } catch {
          /* non-JSON — keep the generic message */
        }
        throw new Error(msg);
      }
      setConfirmingCancel(false);
      await fetchBooking(); // status is now refund_pending
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not cancel the booking. Please try again.'),
      );
    } finally {
      setCancelling(false);
    }
  }, [bookingRef, session, t, fetchBooking]);

  async function completeStubPayment() {
    setPaying(true);
    setError(null);
    try {
      // Simulates the payment provider's webhook (a real provider calls this server-to-server).
      const res = await fetch('/api/v1/webhooks/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          bookingRef,
          outcome: 'paid',
          providerReference: `stub_ref_${bookingRef}`,
        }),
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
        <p className="text-sm text-ink-muted">
          {t('Sign in to view booking {ref}.', { ref: bookingRef })}
        </p>
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
    return (
      <div className="py-16 text-center">
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
        <button
          type="button"
          onClick={retryLoad}
          className="mt-4 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          {t('Try again')}
        </button>
      </div>
    );
  }
  if (!booking) return null;

  const paid = booking.paymentState === 'paid';
  const copy = STATUS_COPY[booking.status] ?? {
    title: t('Status: {status}', { status: booking.status }),
    tone: 'text-ink',
  };
  const awaitingPayment = !paid && booking.status === 'payment_pending';
  const isRefundFlow = booking.status === 'refund_pending' || booking.status === 'refunded';
  // The genuinely celebratory states — a success seal + the confetti fire only here, never on a
  // cancellation, refund, or a still-pending payment (those stay calm by design).
  const celebrating = paid && (booking.status === 'confirmed' || booking.status === 'completed');

  return (
    <div className="mx-auto max-w-xl py-10">
      {celebrating && <Confetti />}
      <div className="rounded-2xl border border-ink/10 bg-white p-6 sm:p-8">
        {celebrating && (
          // A success seal stamps in: the badge pops, the tick draws itself, and a soft ring echoes
          // out — the focal anchor the confetti bursts from. Reuses the sign-in success motions;
          // frozen (tick left visible) under reduced motion.
          <span className="relative mb-4 grid h-14 w-14 place-items-center">
            <span
              aria-hidden
              className="animate-ring-echo absolute h-12 w-12 rounded-full bg-teal/25"
            />
            <span className="animate-pop grid h-14 w-14 place-items-center rounded-full bg-teal text-white shadow-[0_16px_34px_-12px_rgba(14,140,146,0.75)]">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  className="animate-draw-check"
                  d="M5 12.8l4.2 4.2L19 7.2"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        )}
        <h1
          className={`font-display text-2xl font-semibold ${copy.tone} ${celebrating ? 'animate-float-in' : ''}`}
        >
          {t(copy.title)}
        </h1>
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
              <Price
                eur={Math.round((booking.totalEur - booking.totalEur / (1 + VAT_RATE)) * 100) / 100}
              />
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

        {/* Airport-transfer run-sheet — flight, room, luggage etc. Labels are translated; the values are
            DB/free-text content shown verbatim, never passed through t(). */}
        {booking.tripDirection && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <div className="text-[13px] font-bold text-ink">{t('Your transfer')}</div>
            <dl className="mt-2 flex flex-col gap-1.5 text-[13px]">
              {(() => {
                const dir =
                  booking.tripDirection === 'departure'
                    ? t('Departure (hotel to airport)')
                    : booking.tripDirection === 'return'
                      ? t('Return (both directions)')
                      : t('Arrival (airport to hotel)');
                const rows: Array<{ label: string; value: string }> = [
                  { label: t('Direction'), value: dir },
                ];
                if (booking.roomOrCabin)
                  rows.push({ label: t('Room or cabin'), value: booking.roomOrCabin });
                // Each leg: pickup date·time (with the flight no.) + an APPROX drop-off (pickup + the ~60-min
                // drive). The hotel drop-off time isn't booked, so it's always shown with a "~" and "approx".
                const fmtDate = (ymd: string) =>
                  new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  });
                const legs = transferLegs({
                  direction: booking.tripDirection,
                  serviceDateIso: booking.serviceDate,
                  arrivalTime: booking.arrivalTime,
                  returnDate: booking.returnDate,
                  returnTime: booking.returnTime,
                });
                if (legs.length) {
                  for (const leg of legs) {
                    const flight =
                      leg.kind === 'arrival' ? booking.flightNumber : booking.departureFlightNumber;
                    rows.push({
                      label: leg.kind === 'arrival' ? t('Arrival') : t('Departure'),
                      value: [
                        `${fmtDate(leg.pickupYmd)} · ${leg.pickupTime}`,
                        flight ? `${t('flight')} ${flight}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    });
                    if (leg.dropoffYmd && leg.dropoffTime) {
                      rows.push({
                        label: t('Drop-off (approx.)'),
                        value: `${fmtDate(leg.dropoffYmd)} · ~${leg.dropoffTime}`,
                      });
                    }
                  }
                } else {
                  // No service date (older booking) — fall back to the flight numbers + times only.
                  const arr = [booking.flightNumber, booking.arrivalTime]
                    .filter(Boolean)
                    .join(' · ');
                  if (arr) rows.push({ label: t('Arrival flight'), value: arr });
                  const dep = [
                    booking.departureFlightNumber,
                    [booking.returnDate, booking.returnTime].filter(Boolean).join(' '),
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  if (dep) rows.push({ label: t('Return flight'), value: dep });
                }
                if (booking.luggageDetails)
                  rows.push({ label: t('Luggage'), value: booking.luggageDetails });
                if (booking.childSeatAge != null)
                  rows.push({ label: t('Child seat age'), value: String(booking.childSeatAge) });
                if (booking.travellerCountry)
                  rows.push({ label: t('Country'), value: booking.travellerCountry });
                if (booking.specialNotes)
                  rows.push({ label: t('Special requests'), value: booking.specialNotes });
                return rows.map((r) => (
                  <div key={r.label} className="flex justify-between gap-4">
                    <dt className="text-ink-muted">{r.label}</dt>
                    <dd className="text-right font-medium text-ink">{r.value}</dd>
                  </div>
                ));
              })()}
            </dl>
            {paid && (
              <p className="mt-2 text-[12px] text-ink-muted">
                {t(
                  'Your e-voucher with the meeting-point details and a QR is attached to your confirmation email.',
                )}
              </p>
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

        {isRefundFlow ? (
          <div
            role="status"
            className="mt-6 rounded-xl bg-teal/10 px-4 py-3 text-sm text-teal-dark"
          >
            {booking.status === 'refunded'
              ? t(
                  'Your refund has been processed. Please allow a few days for it to appear on your statement.',
                )
              : t(
                  'Your cancellation is confirmed and your refund is being processed. We’ll email you once it’s done.',
                )}
          </div>
        ) : paid ? (
          <div className="mt-6">
            <p className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal-dark">
              {t(
                'Payment received — we’ve emailed your confirmation. See it any time in your bookings.',
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void downloadInvoice()}
                disabled={downloading}
                aria-busy={downloading}
                className="inline-flex items-center gap-2 rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal hover:bg-teal/5 disabled:opacity-60"
              >
                <IconDownload width={15} height={15} />
                {downloading ? t('Preparing…') : t('Download invoice (PDF)')}
              </button>
              {booking.tripDirection && (
                <button
                  type="button"
                  onClick={() => void downloadVoucher()}
                  disabled={downloadingVoucher}
                  aria-busy={downloadingVoucher}
                  className="inline-flex items-center gap-2 rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal hover:bg-teal/5 disabled:opacity-60"
                >
                  <IconDownload width={15} height={15} />
                  {downloadingVoucher ? t('Preparing…') : t('Download e-voucher (PDF)')}
                </button>
              )}
            </div>
            {booking.cancellable ? (
              confirmingCancel ? (
                <div
                  role="group"
                  aria-label={t('Confirm cancellation')}
                  className="mt-4 rounded-xl border border-coral/30 bg-coral/[0.06] p-4"
                >
                  <p className="text-[13px] text-ink">
                    {t(
                      'Cancel this booking and claim a refund? Your refund is processed back to your card within a few business days.',
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void cancelBookingAction()}
                      disabled={cancelling}
                      aria-busy={cancelling}
                      className="rounded-full bg-coral px-4 py-2 text-[13px] font-bold text-white hover:bg-coral/90 disabled:opacity-60"
                    >
                      {cancelling ? t('Cancelling…') : t('Yes, cancel & claim refund')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(false)}
                      disabled={cancelling}
                      className="rounded-full border border-ink/20 px-4 py-2 text-[13px] font-bold text-ink hover:bg-ink/5 disabled:opacity-60"
                    >
                      {t('Keep my booking')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-coral/50 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/5"
                >
                  {t('Cancel activity & claim refund')}
                </button>
              )
            ) : booking.status === 'confirmed' ? (
              <p className="mt-4 text-[13px] text-ink-muted">
                {t('Free cancellation has passed.')}{' '}
                <a
                  href={whatsappUrl(
                    t('Hi Belle Mare Tours! I need to cancel my booking {ref}.', {
                      ref: booking.ref,
                    }),
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-teal hover:text-teal-dark"
                >
                  {t('Message us to cancel')}
                </a>
              </p>
            ) : null}
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
                ? t(
                    'We haven’t received confirmation of your payment yet. It can take a little longer to settle.',
                  )
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
