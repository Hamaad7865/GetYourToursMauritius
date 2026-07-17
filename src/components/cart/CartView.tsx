'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart, itemTotal, lineCap, type CartItem } from '@/lib/cart/useCart';
import { encodeParty } from '@/lib/services/party';
import { createHoldsForLines, type PendingBooking } from '@/lib/cart/holdClient';
import { ResumePaymentButton } from '@/components/checkout/ResumePaymentButton';
import { pushNotification } from '@/lib/notifications/inbox';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';
import {
  IconCart,
  IconCalendar,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconX,
  IconClock,
} from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

function Spinner() {
  return (
    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
  );
}

function checkoutHref(i: CartItem): string {
  const q = new URLSearchParams({
    occ: i.occurrenceId,
    label: i.priceLabel,
    qty: String(i.guests),
    slug: i.slug,
    title: i.title,
    lang: i.lang,
    total: String(itemTotal(i)),
    when: i.dateLabel,
    guests: String(i.guests),
    unit: i.unit,
    // Carry the SUV upgrade so a cart line added as an SUV isn't silently downgraded to the Sedan
    // price at checkout. (holdId/idem are intentionally absent from the URL — the hold reserved in
    // proceed() is handed to checkout via sessionStorage so its tokens don't leak via Referer/history.)
    ...(i.suv ? { suv: '1' } : {}),
    ...(i.childSeats ? { childSeats: String(i.childSeats) } : {}),
    // Age-banded line: carry the per-band map so the server prices each band (Adult/Child/Infant).
    ...(i.party ? { party: encodeParty(i.party) } : {}),
    // Signal checkout this is a CART line: read this line's captured route AND reuse the hold proceed()
    // reserved for this occurrence (both staged to sessionStorage by occurrence). Always present — NOT
    // `from=widget` (a distinct stash + price hints) — so the cart hold is reused instead of re-minted.
    from: 'cart',
  });
  return `/checkout?${q.toString()}`;
}

function EmptyCart() {
  const t = useT();
  return (
    <div className="grid min-h-[55vh] place-items-center py-12 text-center">
      <div>
        <div aria-hidden className="relative mx-auto grid h-40 w-40 place-items-center">
          <span className="absolute inset-0 rounded-full bg-teal/[0.07]" />
          {/* Dashed ring drifts slowly (rotates the dashes around the circle). */}
          <span className="gyt-idle-ring absolute inset-5 rounded-full border-2 border-dashed border-teal/25" />
          {/* Waterline sways side to side. `-ml-14` centres the w-28 svg without a transform, so the
              sway animation has the element's transform to itself. */}
          <svg
            viewBox="0 0 120 40"
            className="gyt-idle-wave absolute -bottom-1 left-1/2 -ml-14 h-6 w-28"
          >
            <path
              d="M2 20 Q17 6 32 20 T62 20 T92 20 T118 20"
              fill="none"
              className="stroke-teal/35"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          {/* The cart bobs like a little boat on the lagoon. */}
          <IconCart width={54} height={54} className="gyt-cart-bob relative text-teal-dark" />
        </div>
        <h1 className="mt-8 font-display text-[26px] font-semibold text-ink">
          {t('No activities in your cart')}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-muted">
          {t('Activities you add to your cart stay here for up to 30 minutes.')}
        </p>
        <Link
          href="/activities"
          className="mt-6 inline-block rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
        >
          {t('Find things to do')}
        </Link>
      </div>
    </div>
  );
}

/** mm:ss countdown for a single held line, driven by its server `expiresAt`. Renders nothing if the
 *  line has no expiry (shouldn't happen for a held line). When it reaches zero it nudges the store to
 *  prune the line immediately (instead of waiting for the next 15s reconcile) so timer and list agree. */
function HoldTimer({ item }: { item: CartItem }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expiresAtMs = item.expiresAt ? new Date(item.expiresAt).getTime() : NaN;
  const left = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - now) / 1000))
    : 0;
  useEffect(() => {
    if (Number.isFinite(expiresAtMs) && left === 0) window.dispatchEvent(new Event('gytm:cart'));
  }, [left, expiresAtMs]);
  if (!item.expiresAt) return null;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-coral/10 px-3 py-1.5 text-[13px] font-semibold text-coral">
      <IconClock width={14} height={14} /> {t('Held — {time} left', { time: `${mm}:${ss}` })}
    </span>
  );
}

function Stepper({
  value,
  max,
  noun = 'guests',
  onChange,
}: {
  value: number;
  max: number;
  noun?: string;
  onChange: (n: number) => void;
}) {
  const t = useT();
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-1.5 py-1">
      <button
        type="button"
        aria-label={t('Fewer {noun}', { noun: t(noun) })}
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-40"
      >
        <IconMinus width={15} height={15} />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold text-ink">{value}</span>
      <button
        type="button"
        aria-label={t('More {noun}', { noun: t(noun) })}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-40"
      >
        <IconPlus width={15} height={15} />
      </button>
    </div>
  );
}

/** A booked-but-unpaid reservation (server) shown in the cart's "Awaiting payment" section. Its own
 *  mm:ss countdown ticks off the real hold expiry; at zero it shows "expired — rebook" and the row drops
 *  on the next pending-bookings fetch (or the 5-min maintenance sweep flips it to expired server-side). */
function PendingRow({ pb }: { pb: PendingBooking }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const expMs = pb.holdExpiresAt ? new Date(pb.holdExpiresAt).getTime() : NaN;
  const left = Number.isFinite(expMs) ? Math.max(0, Math.floor((expMs - now) / 1000)) : 0;
  const expired = Number.isFinite(expMs) && left === 0;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const date = pb.startsAt
    ? new Date(pb.startsAt).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-coral/30 bg-coral/[0.03] p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link
          href={`/bookings/${pb.ref}`}
          className="font-bold leading-snug text-ink hover:text-teal"
        >
          {pb.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
          {date && (
            <span className="inline-flex items-center gap-1">
              <IconCalendar width={13} height={13} className="text-teal" /> {date}
            </span>
          )}
          <span className="font-mono">{pb.ref}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[16px] font-extrabold text-ink">
            <Price eur={pb.totalMinor / 100} />
          </div>
          {expired ? (
            <span className="text-[12px] font-semibold text-coral">
              {t('Reservation expired — rebook')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-coral">
              <IconClock width={12} height={12} /> {t('Pay within {time}', { time: `${mm}:${ss}` })}
            </span>
          )}
        </div>
        {!expired && <ResumePaymentButton bookingRef={pb.ref} />}
      </div>
    </li>
  );
}

export function CartView() {
  const t = useT();
  const { items, pendingBookings, removeHeld, setGuests, subtotal, markHeld, markUnavailable } =
    useCart({ withPending: true });
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMounted(true), []);

  // Checkout handoff: create a server hold per saved line, flip each line to held (with its countdown)
  // or unavailable (sold out), notify, then hand off to the EXISTING per-line checkout exactly as the
  // cart does today (navigate to the clicked line's checkoutHref). Multi-step checkout is a separate
  // future effort — we only add hold-creation + sold-out handling before the existing navigation.
  async function proceed(line: CartItem) {
    if (busy) return;
    setBusy(true);
    try {
      const saved = items.filter((i) => i.status !== 'unavailable');
      const outcomes = await createHoldsForLines(saved);
      let anyHeld = false;
      let anySoldOut = false;
      let anyNetwork = false;
      for (const o of outcomes) {
        if (o.ok && o.holdId && o.expiresAt) {
          markHeld(o.id, { holdId: o.holdId, expiresAt: o.expiresAt });
          anyHeld = true;
          // Hand this line's REAL hold to checkout via sessionStorage keyed by occurrence — mirrors the
          // widget's continueToCheckout stash exactly: { holdId, expiresAt, idem }. The idem MUST be the
          // value the hold was created under (the line's idemKey, posted by createHoldsForLines), so the
          // booking POST reuses the hold AND api_book's reuse branch matches — no second hold is minted.
          // Tokens stay OUT of the URL (Referer/history leak); from=cart in checkoutHref reads this stash.
          const held = saved.find((i) => i.id === o.id);
          if (held) {
            try {
              window.sessionStorage.setItem(
                `gytm:hold:${held.occurrenceId}`,
                JSON.stringify({ holdId: o.holdId, expiresAt: o.expiresAt, idem: held.idemKey }),
              );
            } catch {
              /* sessionStorage unavailable — checkout falls back to minting its own hold at pay */
            }
          }
        } else if (o.reason === 'unavailable') {
          markUnavailable(o.id);
          anySoldOut = true;
        } else {
          // Transient failure (offline / server error): leave the line untouched so a flaky connection
          // never drops a valid basket line — the customer just retries.
          anyNetwork = true;
        }
      }
      if (anySoldOut) pushNotification('unavailable', t('Some spots sold out and were skipped.'));
      if (anyNetwork)
        pushNotification(
          'error',
          t(
            "Couldn't reach the server — your cart is safe. Please check your connection and try again.",
          ),
        );
      if (anyHeld) {
        pushNotification('secured', t('Spots secured — pay within 30 minutes.'));
        // The clicked line is sold out — don't navigate into a checkout for a spot we couldn't hold.
        const clicked = outcomes.find((o) => o.id === line.id);
        if (clicked?.ok) window.location.href = checkoutHref(line);
        else setBusy(false);
      } else {
        // Nothing could be held (all sold out and/or a network failure) — stay on the cart so the
        // sold-out pills and the retry notice are visible.
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }

  // Stage each line's customised route by occurrence so its checkout link can post it (the array is
  // too big for the URL). Keyed by occ — slug-scoped would collide across lines / stale widget visits.
  useEffect(() => {
    for (const i of items) {
      const key = `gytm:itinerary:occ:${i.occurrenceId}`;
      try {
        if (i.itinerary && i.itinerary.length) {
          window.sessionStorage.setItem(key, JSON.stringify(i.itinerary));
        } else {
          window.sessionStorage.removeItem(key);
        }
      } catch {
        /* sessionStorage unavailable — the route falls back to default at checkout */
      }
    }
  }, [items]);

  if (!mounted) return <div className="min-h-[55vh]" />;
  if (items.length === 0 && pendingBookings.length === 0) return <EmptyCart />;

  return (
    <div className="pb-28 pt-10 lg:pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold text-ink">{t('Your cart')}</h1>
      </div>

      {pendingBookings.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[20px] font-semibold text-ink">
            {t('Awaiting payment')}
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {t(
              'Finish paying before the timer runs out, or your seats are released and you’ll need to book again.',
            )}
          </p>
          <ul className="mt-4 flex flex-col gap-4">
            {pendingBookings.map((pb) => (
              <PendingRow key={pb.ref} pb={pb} />
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <ul className="flex flex-col gap-4">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex gap-4 rounded-2xl border border-ink/10 bg-white p-3.5 shadow-[0_1px_3px_rgba(10,46,54,0.06)]"
              >
                <div className="h-24 w-28 shrink-0 overflow-hidden rounded-xl bg-teal/10">
                  {i.image ? (
                    <img src={i.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-[linear-gradient(152deg,#13a0a6,#0E8C92_46%,#0B5C63)]" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link
                    href={`/activities/${i.slug}`}
                    className="font-bold leading-snug text-ink hover:text-teal"
                  >
                    {i.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
                    <span className="flex items-center gap-1">
                      <IconCalendar width={13} height={13} className="text-teal" /> {i.dateLabel}
                    </span>
                    <span className="flex items-center gap-1">
                      <IconGlobe width={13} height={13} className="text-teal" /> {i.lang}
                    </span>
                  </div>
                  {i.status === 'held' && (
                    <div className="mt-1.5">
                      <HoldTimer item={i} />
                    </div>
                  )}
                  {i.status === 'unavailable' && (
                    <span className="mt-1.5 inline-flex w-fit items-center rounded-lg bg-ink/5 px-2.5 py-1 text-[12px] font-semibold text-ink-muted">
                      {t('No longer available')}
                    </span>
                  )}
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                    <div>
                      {i.pricingMode === 'vehicle' || i.party ? (
                        // Vehicle (flat price) OR an age-banded party — both are fixed at what was chosen on
                        // the activity page (changing the mix re-prices per band), so they're not editable here.
                        <div className="text-sm font-bold text-ink">
                          {t('{n} passengers', { n: i.guests })}
                        </div>
                      ) : (
                        <Stepper
                          value={i.guests}
                          max={lineCap(i)}
                          noun={i.pricingMode === 'per_group' ? 'people' : 'guests'}
                          onChange={(n) => setGuests(i.id, n)}
                        />
                      )}
                      <div className="mt-1 text-[11px] text-ink-muted">{i.unit}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[17px] font-extrabold text-ink">
                        <Price eur={itemTotal(i)} />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeHeld(i.id)}
                        className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted hover:text-coral"
                      >
                        <IconX width={12} height={12} /> {t('Remove')}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <aside
            id="cart-summary"
            className={`h-fit rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)] ${
              items.length === 1 ? 'hidden lg:block' : ''
            }`}
          >
            <h2 className="font-display text-lg font-semibold text-ink">{t('Order summary')}</h2>
            <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
              <span className="font-bold text-ink">
                {items.length > 1 ? t('Estimated total') : t('Total')}
              </span>
              <span className="text-lg font-extrabold text-ink">
                <Price eur={subtotal} />
              </span>
            </div>
            {items.length === 1 ? (
              <button
                type="button"
                onClick={() => proceed(items[0]!)}
                disabled={busy || items[0]!.status === 'unavailable'}
                className="mt-4 flex w-full items-center justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark disabled:opacity-80"
              >
                {busy ? <Spinner /> : t('Proceed to checkout')}
              </button>
            ) : (
              <>
                <p className="mt-4 rounded-lg bg-teal/5 px-3 py-2 text-[12px] leading-snug text-ink-muted">
                  {t(
                    'Each activity is booked and paid separately. Check them out one at a time below.',
                  )}
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {items.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => proceed(i)}
                        disabled={busy || i.status === 'unavailable'}
                        className="flex w-full items-center justify-between gap-2 rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal-dark transition hover:bg-teal/5 disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <span className="truncate">{i.title}</span>
                        <span className="shrink-0">
                          {i.status === 'unavailable' ? (
                            t('No longer available')
                          ) : (
                            <>
                              <Price eur={itemTotal(i)} /> →
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-[12px] text-ink-muted">
              {t('Free cancellation up to 24 hours before most activities.')}
            </p>
          </aside>
        </div>
      )}

      {/* Mobile sticky checkout bar. Single item → straight to checkout; multiple → jump to the
          per-item list (each books separately). Only for saved/held cart lines — pending bookings pay
          from their own row above. */}
      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-ink/10 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-16px_rgba(10,46,54,0.45)] lg:hidden">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-ink-muted">
              {items.length > 1 ? t('Estimated total') : t('Total')}
            </div>
            <div className="text-[19px] font-extrabold tracking-tight text-ink">
              <Price eur={subtotal} />
            </div>
          </div>
          {items.length === 1 ? (
            <button
              type="button"
              onClick={() => proceed(items[0]!)}
              disabled={busy || items[0]!.status === 'unavailable'}
              className="flex shrink-0 items-center justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
            >
              {busy ? <Spinner /> : t('Proceed to checkout')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById('cart-summary')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className="shrink-0 rounded-full bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark"
            >
              {t('Check out ({n})', { n: items.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
