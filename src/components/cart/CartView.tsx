'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart, itemTotal, lineCap, CART_TTL_MS, type CartItem } from '@/lib/cart/useCart';
import { IconCart, IconCalendar, IconGlobe, IconMinus, IconPlus, IconX, IconClock } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

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
    // price at checkout. (holdId/idem/from=widget are intentionally absent — a cart line was never
    // held and must not inherit another visit's route.)
    ...(i.suv ? { suv: '1' } : {}),
  });
  return `/checkout?${q.toString()}`;
}

function EmptyCart() {
  return (
    <div className="grid min-h-[55vh] place-items-center py-12 text-center">
      <div>
        <div aria-hidden className="relative mx-auto grid h-40 w-40 place-items-center">
          <span className="absolute inset-0 rounded-full bg-teal/[0.07]" />
          <span className="absolute inset-5 rounded-full border-2 border-dashed border-teal/25" />
          <svg viewBox="0 0 120 40" className="absolute -bottom-1 left-1/2 h-6 w-28 -translate-x-1/2">
            <path
              d="M2 20 Q17 6 32 20 T62 20 T92 20 T118 20"
              fill="none"
              className="stroke-teal/35"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <IconCart width={54} height={54} className="relative text-teal-dark" />
        </div>
        <h1 className="mt-8 font-display text-[26px] font-semibold text-ink">
          No activities in your cart
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-muted">
          Activities you add to your cart stay here for up to 30 minutes.
        </p>
        <Link
          href="/activities"
          className="mt-6 inline-block rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
        >
          Find things to do
        </Link>
      </div>
    </div>
  );
}

/** mm:ss until the soonest item expires (drops out of the cart). */
function HoldTimer({ items }: { items: CartItem[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const soonest = Math.min(...items.map((i) => i.addedAt + CART_TTL_MS));
  const left = Math.max(0, Math.floor((soonest - now) / 1000));
  // When the soonest item hits zero, nudge the store to prune it immediately (instead of
  // waiting for the next 15s sync) so the countdown and the list agree.
  useEffect(() => {
    if (left === 0) window.dispatchEvent(new Event('gytm:cart'));
  }, [left]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-coral/10 px-3 py-1.5 text-[13px] font-semibold text-coral">
      <IconClock width={14} height={14} /> Held for {mm}:{ss}
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
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-1.5 py-1">
      <button
        type="button"
        aria-label={`Fewer ${noun}`}
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-40"
      >
        <IconMinus width={15} height={15} />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold text-ink">{value}</span>
      <button
        type="button"
        aria-label={`More ${noun}`}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-40"
      >
        <IconPlus width={15} height={15} />
      </button>
    </div>
  );
}

export function CartView() {
  const { items, remove, setGuests, subtotal } = useCart();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="min-h-[55vh]" />;
  if (items.length === 0) return <EmptyCart />;

  return (
    <div className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold text-ink">Your cart</h1>
        <HoldTimer items={items} />
      </div>

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
                <Link href={`/activities/${i.slug}`} className="font-bold leading-snug text-ink hover:text-teal">
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
                <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                  <div>
                    {i.pricingMode === 'vehicle' ? (
                      // The vehicle (and its flat price) is fixed at the size chosen on the activity
                      // page — changing it would change the vehicle, so it's not editable here.
                      <div className="text-sm font-bold text-ink">{i.guests} passengers</div>
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
                    <div className="text-[17px] font-extrabold text-ink">€{itemTotal(i).toFixed(2)}</div>
                    <button
                      type="button"
                      onClick={() => remove(i.id)}
                      className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted hover:text-coral"
                    >
                      <IconX width={12} height={12} /> Remove
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)]">
          <h2 className="font-display text-lg font-semibold text-ink">Order summary</h2>
          <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
            <span className="font-bold text-ink">{items.length > 1 ? 'Estimated total' : 'Total'}</span>
            <span className="text-lg font-extrabold text-ink">€{subtotal.toFixed(2)}</span>
          </div>
          {items.length === 1 ? (
            <Link
              href={checkoutHref(items[0]!)}
              className="mt-4 flex justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
            >
              Proceed to checkout
            </Link>
          ) : (
            <>
              <p className="mt-4 rounded-lg bg-teal/5 px-3 py-2 text-[12px] leading-snug text-ink-muted">
                Each activity is booked and paid separately. Check them out one at a time below.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {items.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={checkoutHref(i)}
                      className="flex items-center justify-between gap-2 rounded-full border border-teal/40 px-4 py-2 text-[13px] font-bold text-teal-dark transition hover:bg-teal/5"
                    >
                      <span className="truncate">{i.title}</span>
                      <span className="shrink-0">€{itemTotal(i).toFixed(2)} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-[12px] text-ink-muted">
            Free cancellation up to 24 hours before most activities.
          </p>
        </aside>
      </div>
    </div>
  );
}
