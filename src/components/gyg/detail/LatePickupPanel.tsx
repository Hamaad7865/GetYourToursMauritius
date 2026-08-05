'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { PickupDropoffMap } from '@/components/maps/PickupDropoffMap';
import { PayProgress } from '@/components/checkout/PayProgress';
import { useResumePayment } from '@/components/checkout/ResumePaymentButton';
import {
  SESSION_COMPLETE_PERCENT,
  clearPayHandoff,
  savePayHandoff,
} from '@/lib/checkout/pay-progress';
import { saveChargeHandoff } from '@/lib/checkout/charge-handoff';

/**
 * "I'll decide later", finished.
 *
 * A booking taken with `pickup_pending` has no address and paid no transport supplement. This is the
 * self-service way to close that: pick the point on the map, see what the supplement costs, pay it,
 * and the address lands on the booking. Before this existed the guest could only phone.
 *
 * TWO THINGS THIS COMPONENT DELIBERATELY DOES NOT DO:
 *  - it never sends a price. The quote below is DISPLAY only; POST /pickup re-derives the fare from
 *    the coordinates server-side, and the card is charged the figure api_create_payment pinned.
 *  - it never writes the address itself. The server parks it until the supplement settles, which is
 *    why a paid-but-not-yet-settled state exists at all (`pendingPickup`).
 */

interface Quote {
  eligible: boolean;
  feeMinor: number;
  region?: string | null;
  band?: string | null;
  reason?: string | null;
}

/** Why a pickup point was refused, in words the guest can act on. Anything unmapped falls back to a
 *  generic line — never a bare disabled button with no explanation. */
function refusalMessage(reason: string | null | undefined, t: (k: string) => string): string {
  switch (reason) {
    case 'transport_not_applicable':
      return t('This trip doesn’t include a pickup service — message us and we’ll sort it out.');
    case 'departure_cancelled':
      return t('This departure was called off, so a pickup can’t be added.');
    case 'departed':
      return t('This trip has already departed.');
    case 'pickup_not_pending':
      return t('A pickup is already set for this booking.');
    default:
      return t('We can’t add a pickup to this booking online — please message us.');
  }
}

/** A pickup request already committed to, waiting on its supplement to settle. */
export interface PendingPickup {
  pickupLocation: string;
  dropoffLocation?: string | null;
  feeEur: number;
}

export function LatePickupPanel({
  bookingRef,
  pending,
  onChanged,
}: {
  bookingRef: string;
  /** Set while a committed pickup is waiting on payment — the panel becomes a resume affordance. */
  pending?: PendingPickup | null;
  /** Re-fetch the booking. Called when a zero-fee pickup applies instantly, and after a failed
   *  attempt — a mint that failed (checkout_pending, provider blip) has still CREATED the request, so
   *  refreshing swaps this picker for the "nearly set" card and its working resume button rather than
   *  leaving the guest looking at a form they already submitted. */
  onChanged: () => void;
}) {
  const t = useT();
  const { session } = useAuth();
  const [address, setAddress] = useState(pending?.pickupLocation ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Seeded from what was actually committed, NOT hardcoded true: re-entering the picker with the
  // box ticked hides a distinct drop-off the guest already gave, and the submit body then sends
  // dropoffLocation: null, which api_request_pickup writes over the stored one.
  const [dropoffSame, setDropoffSame] = useState(!pending?.dropoffLocation);
  const [dropoff, setDropoff] = useState(pending?.dropoffLocation ?? '');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A committed-but-unpaid pickup shows the resume card, NOT the map — but a guest who typed the wrong
  // hotel has to be able to fix it, and api_request_pickup revises an open request in place. This flips
  // the card back to the picker. (The server still refuses a RE-PRICE while that session is live, and
  // says so in words.)
  const [editing, setEditing] = useState(false);
  // Guards the async quote against an out-of-order response: the pin can move faster than the
  // round-trip, and a stale reply must never overwrite the price for where the pin actually is.
  const quoteSeq = useRef(0);
  // Resuming a committed-but-unpaid supplement is the SAME machinery as resuming a booking payment
  // (mint/reuse a session under the single-flight lease, hand the ring + pinned charge to the pay
  // page) — only the purpose differs, so reuse the hook rather than re-implementing it here.
  const resumeAddon = useResumePayment(bookingRef, 'pickup_addon');

  const authHeaders = useCallback(
    () => ({
      'content-type': 'application/json',
      authorization: `Bearer ${session?.access_token ?? ''}`,
    }),
    [session],
  );

  // Re-quote whenever the pin moves. Debounced: dragging a marker fires a stream of coordinates and
  // each one is a round-trip.
  useEffect(() => {
    if (!session || !coords) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const timer = setTimeout(() => {
      void fetch(`/api/v1/bookings/${bookingRef}/pickup/quote`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ pickupLat: coords.lat, pickupLng: coords.lng }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (seq !== quoteSeq.current) return; // a newer pin position has won
          setQuoting(false);
          if (res.ok) setQuote(res.data as Quote);
          else setQuote(null);
        })
        .catch(() => {
          if (seq !== quoteSeq.current) return;
          setQuoting(false);
          setQuote(null);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [coords, session, bookingRef, authHeaders]);

  async function submit(): Promise<void> {
    if (busy) return;
    if (!session) {
      setError(t('Please sign in to add your pickup.'));
      return;
    }
    if (!address.trim() || !coords) {
      setError(t('Add your pickup address, and drop the pin where we should collect you.'));
      return;
    }
    setBusy(true);
    setError(null);
    clearPayHandoff();
    try {
      const res = await fetch(`/api/v1/bookings/${bookingRef}/pickup`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          pickupLocation: address.trim().slice(0, 200),
          dropoffLocation: !dropoffSame && dropoff.trim() ? dropoff.trim().slice(0, 200) : null,
          pickupLat: coords.lat,
          pickupLng: coords.lng,
        }),
      }).then((r) => r.json());

      if (!res.ok) {
        throw new Error(res.error?.message ?? t('Could not save your pickup.'));
      }
      const data = res.data as {
        applied: boolean;
        payment: {
          checkoutId?: string;
          redirectUrl?: string;
          chargeAmountMinor?: number;
          chargeCurrency?: string;
        } | null;
      };

      // Nothing to pay — the address is already on the booking.
      if (data.applied) {
        setBusy(false);
        onChanged();
        return;
      }

      const link = data.payment;
      if (link?.checkoutId) {
        // Same hand-off the booking's own payment uses, so the pay page continues the progress ring
        // and discloses the exact card charge rather than restarting cold.
        savePayHandoff(SESSION_COMPLETE_PERCENT, Date.now());
        if (typeof link.chargeAmountMinor === 'number' && link.chargeCurrency) {
          saveChargeHandoff({
            ref: bookingRef,
            chargeCurrency: link.chargeCurrency,
            chargeAmountMinor: link.chargeAmountMinor,
          });
        }
        window.location.href = `/bookings/${bookingRef}/pay?cid=${encodeURIComponent(link.checkoutId)}`;
        return;
      }
      if (link?.redirectUrl) {
        window.location.href = link.redirectUrl;
        return;
      }
      throw new Error(t('Could not start payment.'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save your pickup.'));
      setBusy(false);
      clearPayHandoff();
      // The request may well exist despite the failure (api_request_pickup commits before the
      // checkout is minted), so re-read the booking: if it does, this panel re-renders as the resume
      // card instead of offering to submit the same address again.
      onChanged();
    }
  }

  // ── Committed, waiting on the supplement ───────────────────────────────────────────────────────
  if (pending && !editing) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-[13px] font-bold text-ink">{t('Your pickup is nearly set')}</p>
        <p className="mt-1 text-[13px] text-ink/80">{pending.pickupLocation}</p>
        {pending.dropoffLocation && (
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {t('Drop-off')}: {pending.dropoffLocation}
          </p>
        )}
        <p className="mt-2 text-[12.5px] text-ink-muted">
          {t(
            'We’re waiting for your transport supplement to clear. This usually takes a few seconds — refresh if it lingers.',
          )}
        </p>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void resumeAddon.resume()}
            disabled={resumeAddon.busy}
            className="inline-flex items-center justify-center rounded-full bg-teal px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {resumeAddon.busy ? t('Starting…') : t('Complete payment')}
          </button>
          {error && (
            <p role="alert" className="mb-2 text-[12.5px] font-medium text-coral">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-2 inline-flex items-center justify-center rounded-full border border-ink/20 px-4 py-2 text-[13px] font-bold text-ink hover:bg-ink/5"
          >
            {t('Change address')}
          </button>
          {resumeAddon.error && (
            <p role="alert" className="mt-2 text-[12.5px] font-medium text-coral">
              {resumeAddon.error}
            </p>
          )}
          <PayProgress stage={resumeAddon.busy && !resumeAddon.error ? 'session' : null} />
        </div>
      </div>
    );
  }

  // ── Not chosen yet ─────────────────────────────────────────────────────────────────────────────
  const feeEur = quote && quote.eligible ? quote.feeMinor / 100 : null;
  const canSubmit = Boolean(address.trim() && coords && quote?.eligible && !quoting);

  return (
    <div className="mt-3 rounded-xl border border-ink/10 p-4">
      <p className="text-[13px] font-bold text-ink">{t('Tell us where to collect you')}</p>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        {t(
          'Search for your hotel or drop the pin on the map. If your pickup is further from where the trip departs, a transport supplement applies — you’ll see it before you pay.',
        )}
      </p>

      <div className="mt-3">
        <PickupDropoffMap
          pickupValue={address}
          onPickupChange={setAddress}
          onPickupCoords={setCoords}
          showDropoff={!dropoffSame}
          dropoffValue={dropoff}
          onDropoffChange={setDropoff}
          onDropoffCoords={() => {}}
          pickupPlaceholder={t('Hotel name or address')}
          dropoffPlaceholder={t('Drop-off location')}
        />
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
          <input
            type="checkbox"
            checked={dropoffSame}
            onChange={(e) => setDropoffSame(e.target.checked)}
            className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
          />
          {t('Drop-off — same as pickup')}
        </label>
      </div>

      {/* The price, stated before the CTA — never inside it, and never a surprise at the widget. */}
      <div
        role="status"
        className="mt-3 flex items-baseline justify-between rounded-lg bg-teal/5 px-3 py-2 text-[13px]"
      >
        <span className="font-medium text-ink">{t('Transport supplement')}</span>
        <span className="font-bold text-ink">
          {!coords ? (
            t('Choose a pickup point')
          ) : quoting ? (
            t('Checking…')
          ) : feeEur == null ? (
            '—'
          ) : feeEur === 0 ? (
            t('Included')
          ) : (
            <Price eur={feeEur} />
          )}
        </span>
      </div>

      {/* Why the button is disabled. Without this the panel just sat there showing '—' and a dead CTA
          — the exact state a guest reaches on a tour that has no pickup service at all. */}
      {coords && !quoting && quote && !quote.eligible && (
        <p role="status" className="mt-2 text-[12.5px] font-medium text-ink-muted">
          {refusalMessage(quote.reason, t)}
        </p>
      )}
      {coords && !quoting && quote === null && (
        <p role="status" className="mt-2 text-[12.5px] font-medium text-ink-muted">
          {t('We couldn’t price that pickup point — try again, or move the pin slightly.')}
        </p>
      )}

      {/* A guest who opened the editor from a parked pickup must be able to get back to the payment
          button; without this the only affordance that reopens the supplement checkout was gone for
          the rest of the page session, including after a refusal. */}
      {pending && (
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className="mt-3 mr-2 inline-flex items-center justify-center rounded-full border border-ink/20 px-4 py-2.5 text-[13px] font-bold text-ink hover:bg-ink/5"
        >
          {t('Cancel')}
        </button>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !canSubmit}
        className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-teal px-4 py-2.5 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-60 sm:w-auto"
      >
        {busy
          ? t('Starting…')
          : feeEur && feeEur > 0
            ? t('Pay and confirm pickup')
            : t('Confirm pickup')}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-coral">
          {error}
        </p>
      )}
      <PayProgress stage={busy && !error ? 'session' : null} />
    </div>
  );
}
