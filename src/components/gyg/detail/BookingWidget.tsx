'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { TourType } from '@/lib/validation/common';
import type { TourOption } from '@/lib/validation/tours';
import {
  IconBolt,
  IconCalendar,
  IconCheck,
  IconChevron,
  IconMinus,
  IconPlus,
  IconShield,
  IconUsers,
} from '@/components/ui/icons';

interface Slot {
  occurrenceId: string;
  activityOptionId: string;
  optionName: string;
  startsAt: string;
  endsAt: string;
  seatsLeft: number;
  status: string;
}

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

function fmtSlot(s: Slot): string {
  const d = new Date(s.startsAt);
  const when = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${when}, ${time} · ${s.optionName} · ${s.seatsLeft} left`;
}

/**
 * GetYourGuide-style sticky booking widget, wired to the real flow: load availability →
 * pick a slot → quantities per price tier → create booking → start payment → redirect to
 * checkout. Booking + payment use the signed-in account (owner) so there are no inline
 * customer fields; the booking carries the account name + email.
 */
export function BookingWidget({
  slug,
  type,
  fromPriceEur,
  options,
}: {
  slug: string;
  type: TourType;
  fromPriceEur: number | null;
  options: TourOption[];
}) {
  const { user, profile, session, openAuth } = useAuth();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [occurrenceId, setOccurrenceId] = useState('');
  const [party, setParty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTransport = type === 'transport';
  const cheapest = useMemo(() => {
    const tiers = options.flatMap((o) => o.prices);
    return tiers.length ? tiers.reduce((a, b) => (b.amountEur < a.amountEur ? b : a)) : null;
  }, [options]);
  const isGroup = cheapest?.maxGuests != null;
  const unitLabel = isGroup
    ? `per group up to ${cheapest!.maxGuests}`
    : isTransport
      ? 'per vehicle'
      : 'per person';

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/activities/${slug}/availability`)
      .then((r) => r.json())
      .then((body) => active && setSlots(body.ok ? (body.data as Slot[]) : []))
      .catch(() => active && setSlots([]));
    return () => {
      active = false;
    };
  }, [slug]);

  const slot = slots?.find((s) => s.occurrenceId === occurrenceId) ?? null;
  const tiers = useMemo(
    () => (slot ? (options.find((o) => o.id === slot.activityOptionId)?.prices ?? []) : []),
    [slot, options],
  );

  function selectSlot(id: string) {
    setOccurrenceId(id);
    const s = slots?.find((x) => x.occurrenceId === id);
    const opt = s ? options.find((o) => o.id === s.activityOptionId) : undefined;
    setParty(opt?.prices[0] ? { [opt.prices[0].label]: 1 } : {});
  }

  function setQty(label: string, qty: number) {
    setParty((p) => ({ ...p, [label]: Math.max(0, qty) }));
  }

  const guests = Object.values(party).reduce((a, b) => a + b, 0);
  const total = tiers.reduce((sum, t) => sum + (party[t.label] ?? 0) * t.amountEur, 0);

  async function book() {
    if (!session) return openAuth('signin');
    if (!occurrenceId) return setError('Please choose a date.');
    if (guests <= 0) return setError('Please add at least one guest.');
    setBusy(true);
    setError(null);
    try {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      };
      const partyClean = Object.fromEntries(Object.entries(party).filter(([, q]) => q > 0));
      const bookingRes = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          occurrenceId,
          party: partyClean,
          customer: {
            name: profile?.fullName || user?.email || 'Guest',
            email: user?.email,
            phone: profile?.phone || null,
          },
          source: 'web',
        }),
      }).then((r) => r.json());
      if (!bookingRes.ok) throw new Error(bookingRes.error?.message ?? 'Could not create the booking.');

      const payRes = await fetch('/api/v1/payments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bookingRef: bookingRes.data.ref }),
      }).then((r) => r.json());
      if (!payRes.ok) throw new Error(payRes.error?.message ?? 'Could not start payment.');

      window.location.href = payRes.data.redirectUrl as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]">
      <div
        className={`flex items-center gap-2 px-5 py-2.5 text-[12.5px] font-bold text-white ${
          isTransport ? 'bg-teal' : 'bg-gradient-to-r from-coral to-[#e8584a]'
        }`}
      >
        {isTransport ? (
          <>
            <IconShield width={15} height={15} /> Free cancellation up to 24h
          </>
        ) : (
          <>
            <IconBolt width={15} height={15} /> Likely to sell out
          </>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-ink-muted">From</span>
          <span className="text-[30px] font-extrabold tracking-tight text-ink">
            {fromPriceEur != null ? eur(fromPriceEur) : 'On request'}
          </span>
        </div>
        <div className="text-[13px] text-ink-muted">{unitLabel}</div>

        <div className="mt-4 flex flex-col gap-2.5">
          {/* Date & time */}
          <div className="flex items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3 focus-within:border-teal">
            <IconCalendar width={18} height={18} className="shrink-0 text-teal" />
            {slots === null ? (
              <span className="flex-1 text-[14px] text-ink-muted">Loading availability…</span>
            ) : slots.length === 0 ? (
              <span className="flex-1 text-[14px] text-ink-muted">No dates available yet</span>
            ) : (
              <select
                value={occurrenceId}
                onChange={(e) => selectSlot(e.target.value)}
                aria-label="Choose a date"
                className="flex-1 cursor-pointer bg-transparent text-[14px] font-semibold text-ink outline-none"
              >
                <option value="">Select a date</option>
                {slots.map((s) => (
                  <option key={s.occurrenceId} value={s.occurrenceId} disabled={s.seatsLeft <= 0}>
                    {fmtSlot(s)}
                  </option>
                ))}
              </select>
            )}
            <IconChevron width={16} height={16} className="shrink-0 text-ink-muted" />
          </div>

          {/* Quantities per price tier */}
          {slot &&
            tiers.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-2.5"
              >
                <IconUsers width={18} height={18} className="shrink-0 text-teal" />
                <span className="flex-1 text-[14px] font-semibold text-ink">
                  {t.label} <span className="text-ink-muted">{eur(t.amountEur)}</span>
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={`Fewer ${t.label}`}
                    onClick={() => setQty(t.label, (party[t.label] ?? 0) - 1)}
                    disabled={(party[t.label] ?? 0) <= 0}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconMinus width={15} height={15} />
                  </button>
                  <span className="w-5 text-center font-bold tabular-nums text-ink">{party[t.label] ?? 0}</span>
                  <button
                    type="button"
                    aria-label={`More ${t.label}`}
                    onClick={() => setQty(t.label, (party[t.label] ?? 0) + 1)}
                    disabled={t.maxGuests != null && (party[t.label] ?? 0) >= t.maxGuests}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconPlus width={15} height={15} />
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink/[0.08] pt-3.5">
          <span className="text-[13px] font-bold text-ink/80">Total</span>
          <span className="text-xl font-extrabold tracking-tight text-ink">
            {slot && guests > 0 ? eur(total) : '—'}
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
            {error}
          </p>
        )}

        {!user ? (
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="mt-3.5 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark"
          >
            Sign in to book
          </button>
        ) : (
          <button
            type="button"
            onClick={book}
            disabled={busy || !slot || guests <= 0}
            className="mt-3.5 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark disabled:opacity-50"
          >
            {busy ? 'Processing…' : 'Book & pay'}
          </button>
        )}
        <p className="mt-2 text-center text-[11.5px] text-ink-muted">
          You won&apos;t be charged until you confirm on the next screen.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" /> Free cancellation up to 24 hours
            before
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" /> Instant confirmation
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2.5 border-t border-ink/[0.08] bg-cream px-5 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink/80">
          <IconShield width={15} height={15} className="text-teal" /> Secure payment by Peach
        </span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-teal">
          <IconBolt width={15} height={15} /> Instant confirmation
        </span>
      </div>
    </div>
  );
}
