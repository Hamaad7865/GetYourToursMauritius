'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import type { TourType } from '@/lib/validation/common';
import type { TourOption } from '@/lib/validation/tours';
import { IconMinus, IconPlus } from '@/components/ui/icons';

interface Slot {
  occurrenceId: string;
  activityOptionId: string;
  optionName: string;
  startsAt: string;
  endsAt: string;
  seatsLeft: number;
  status: string;
}

function fmtSlot(s: Slot): string {
  const d = new Date(s.startsAt);
  const when = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${when}, ${time} · ${s.optionName} · ${s.seatsLeft} left`;
}

/**
 * Real booking widget: load availability → pick a slot → choose quantities per price tier
 * → create the booking → start payment → redirect to the hosted checkout (stub or Peach).
 * Booking + payment require a signed-in account (so the booking is owned and payable).
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
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/activities/${slug}/availability`)
      .then((r) => r.json())
      .then((body) => {
        if (active) setSlots(body.ok ? (body.data as Slot[]) : []);
      })
      .catch(() => active && setSlots([]));
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (user) {
      setName((n) => n || profile?.fullName || '');
      setEmail((e) => e || user.email || '');
      setPhone((p) => p || profile?.phone || '');
    }
  }, [user, profile?.fullName, profile?.phone]);

  const slot = slots?.find((s) => s.occurrenceId === occurrenceId) ?? null;
  // The price tiers for the chosen slot's option.
  const tiers = useMemo(
    () => (slot ? (options.find((o) => o.id === slot.activityOptionId)?.prices ?? []) : []),
    [slot, options],
  );

  function selectSlot(id: string) {
    setOccurrenceId(id);
    const s = slots?.find((x) => x.occurrenceId === id);
    const opt = s ? options.find((o) => o.id === s.activityOptionId) : undefined;
    // Default to one of the first tier.
    setParty(opt?.prices[0] ? { [opt.prices[0].label]: 1 } : {});
  }

  const guests = Object.values(party).reduce((a, b) => a + b, 0);
  const total = tiers.reduce((sum, t) => sum + (party[t.label] ?? 0) * t.amountEur, 0);
  const unit = type === 'transport' ? 'per vehicle' : 'per person';

  function setQty(label: string, qty: number) {
    setParty((p) => ({ ...p, [label]: Math.max(0, qty) }));
  }

  async function book() {
    if (!session) return openAuth('signin');
    if (!occurrenceId) return setError('Please choose a date.');
    if (guests <= 0) return setError('Please add at least one guest.');
    if (!name.trim() || !email.trim()) return setError('Your name and email are required.');
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
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim() || null },
          source: 'web',
        }),
      }).then((r) => r.json());
      if (!bookingRes.ok) throw new Error(bookingRes.error?.message ?? 'Could not create the booking.');
      const ref = bookingRes.data.ref as string;

      const payRes = await fetch('/api/v1/payments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bookingRef: ref }),
      }).then((r) => r.json());
      if (!payRes.ok) throw new Error(payRes.error?.message ?? 'Could not start payment.');

      window.location.href = payRes.data.redirectUrl as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_10px_30px_-18px_rgba(10,46,54,0.4)]">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-muted">From</span>
        <span className="text-2xl font-extrabold text-ink">
          {fromPriceEur != null ? `€${fromPriceEur}` : 'On request'}
        </span>
      </div>
      <p className="text-right text-[12px] text-ink-muted">{unit}</p>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">Date &amp; time</span>
          {slots === null ? (
            <span className="text-sm text-ink-muted">Loading availability…</span>
          ) : slots.length === 0 ? (
            <span className="rounded-lg bg-cream px-3 py-2.5 text-[13px] text-ink-muted">
              No dates available yet — please check back soon.
            </span>
          ) : (
            <select
              className="w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
              value={occurrenceId}
              onChange={(e) => selectSlot(e.target.value)}
            >
              <option value="">Choose a date…</option>
              {slots.map((s) => (
                <option key={s.occurrenceId} value={s.occurrenceId} disabled={s.seatsLeft <= 0}>
                  {fmtSlot(s)}
                </option>
              ))}
            </select>
          )}
        </label>

        {slot && tiers.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl border border-ink/10 p-3">
            {tiers.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{t.label}</p>
                  <p className="text-[12px] text-ink-muted">€{t.amountEur}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Fewer ${t.label}`}
                    onClick={() => setQty(t.label, (party[t.label] ?? 0) - 1)}
                    disabled={(party[t.label] ?? 0) <= 0}
                    className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
                  >
                    <IconMinus width={15} height={15} />
                  </button>
                  <span className="w-5 text-center text-sm font-bold text-ink">{party[t.label] ?? 0}</span>
                  <button
                    type="button"
                    aria-label={`More ${t.label}`}
                    onClick={() => setQty(t.label, (party[t.label] ?? 0) + 1)}
                    disabled={t.maxGuests != null && (party[t.label] ?? 0) >= t.maxGuests}
                    className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
                  >
                    <IconPlus width={15} height={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {slot && guests > 0 && (
          <div className="flex items-center justify-between border-t border-ink/10 pt-3 text-sm">
            <span className="font-bold text-ink">Total</span>
            <span className="text-lg font-extrabold text-ink">€{total.toFixed(2)}</span>
          </div>
        )}

        {user && slot && (
          <div className="flex flex-col gap-2">
            <input
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
            />
            <input
              type="email"
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
            />
            <input
              type="tel"
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-teal"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-[13px] font-medium text-coral">
            {error}
          </p>
        )}

        {!user ? (
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="w-full rounded-full bg-teal px-5 py-3 text-sm font-bold text-white hover:bg-teal-dark"
          >
            Sign in to book
          </button>
        ) : (
          <button
            type="button"
            onClick={book}
            disabled={busy || !slot || guests <= 0}
            className="w-full rounded-full bg-teal px-5 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {busy ? 'Processing…' : 'Book & pay'}
          </button>
        )}
        <p className="text-center text-[11.5px] text-ink-muted">
          You won&apos;t be charged until you confirm on the next screen.
        </p>
      </div>
    </div>
  );
}
