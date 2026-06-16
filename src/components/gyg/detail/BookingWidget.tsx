'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TourType } from '@/lib/validation/common';
import type { TourOption } from '@/lib/validation/tours';
import { useCart } from '@/lib/cart/useCart';
import { useToast } from '@/components/site/ToastProvider';
import {
  IconBolt,
  IconCalendar,
  IconCart,
  IconCheck,
  IconChevron,
  IconChevronLeft,
  IconChevronRight,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconShield,
  IconUsers,
} from '@/components/ui/icons';

interface Slot {
  occurrenceId: string;
  activityOptionId: string;
  startsAt: string;
  seatsLeft: number;
}
interface DayInfo {
  occurrenceId: string;
  seatsLeft: number;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function monthCells(year: number, month: number): Array<Date | null> {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  return cells;
}

/**
 * GetYourGuide-style booking widget: Participants · Date · Language. Availability is a
 * daily capacity, so the visitor picks a date from a calendar that greys out past/today
 * and fully-booked days, sets the party size, then books → pays. Uses the signed-in account.
 */
export function BookingWidget({
  slug,
  type,
  fromPriceEur,
  options,
  languages,
  title,
  groupPricing = false,
  image = null,
}: {
  slug: string;
  type: TourType;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
  title: string;
  /** Island-tour style: bill per group (ceil(people / maxGuests) × price), no hard cap. */
  groupPricing?: boolean;
  /** Hero image URL for the cart line item. */
  image?: string | null;
}) {
  const router = useRouter();
  const { add: addToCart } = useCart();
  const { showToast } = useToast();
  const [days, setDays] = useState<Map<string, DayInfo> | null>(null);
  const [date, setDate] = useState('');
  const [participants, setParticipants] = useState(2);
  const [lang, setLang] = useState(languages[0] ?? 'English');
  const [open, setOpen] = useState<'parts' | 'date' | 'lang' | null>(null);
  const [view, setView] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Cheapest price tier drives the headline price + the bookable option.
  const cheapest = useMemo(() => {
    let best: { optionId: string; label: string; amountEur: number; maxGuests: number | null } | null = null;
    for (const o of options) {
      for (const p of o.prices) {
        if (!best || p.amountEur < best.amountEur) {
          best = { optionId: o.id, label: p.label, amountEur: p.amountEur, maxGuests: p.maxGuests };
        }
      }
    }
    return best;
  }, [options]);
  const isTransport = type === 'transport';
  // Per-group pricing only applies when the activity opts in (e.g. island tours).
  const isGroup = groupPricing && cheapest?.maxGuests != null;
  const unitLabel = isGroup
    ? `per group up to ${cheapest!.maxGuests}`
    : isTransport
      ? 'per vehicle'
      : 'per person';

  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 180);

  useEffect(() => {
    if (!cheapest) {
      setDays(new Map());
      return;
    }
    let active = true;
    fetch(`/api/v1/activities/${slug}/availability?from=${dateKey(today)}&to=${dateKey(horizon)}`)
      .then((r) => r.json())
      .then((body) => {
        if (!active) return;
        const map = new Map<string, DayInfo>();
        if (body.ok) {
          for (const s of body.data as Slot[]) {
            if (s.activityOptionId !== cheapest.optionId) continue;
            map.set(dateKey(new Date(s.startsAt)), { occurrenceId: s.occurrenceId, seatsLeft: s.seatsLeft });
          }
        }
        setDays(map);
      })
      .catch(() => active && setDays(new Map()));
    return () => {
      active = false;
    };
    // today/horizon derive from "now"; slug + cheapest option are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, cheapest?.optionId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = date ? days?.get(date) : undefined;
  const seatsLeft = selected?.seatsLeft ?? 0;
  const maxParticipants = Math.max(1, Math.min(16, date ? seatsLeft : 16));

  // Group tiers are billed per group: total = ceil(people / group size) x price.
  const groups =
    isGroup && cheapest?.maxGuests ? Math.ceil(participants / cheapest.maxGuests) : participants;
  const total =
    cheapest == null ? null : isGroup ? cheapest.amountEur * groups : cheapest.amountEur * participants;
  const dateText = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Select a date';
  const noAvailability = days !== null && days.size === 0;

  function isDisabled(cell: Date): boolean {
    if (cell < tomorrow) return true; // past + today greyed
    const info = days?.get(dateKey(cell));
    return !info || info.seatsLeft <= 0; // no day, or full (capacity reached)
  }

  function pickDate(cell: Date) {
    const key = dateKey(cell);
    setDate(key);
    setOpen(null);
    setError(null);
    const left = days?.get(key)?.seatsLeft ?? 0;
    setParticipants((p) => Math.max(1, Math.min(p, Math.max(1, Math.min(16, left)))));
  }

  function goToCheckout() {
    if (!selected || !cheapest) return setError('Please choose a date.');
    if (participants <= 0) return setError('Please add at least one guest.');
    if (participants > seatsLeft) return setError('Not enough space left on that date.');
    const q = new URLSearchParams({
      occ: selected.occurrenceId,
      label: cheapest.label,
      qty: String(participants),
      slug,
      title,
      lang,
      total: total != null ? String(total) : '',
      when: dateText,
      guests: String(participants),
      unit: unitLabel,
    });
    router.push(`/checkout?${q.toString()}`);
  }

  function handleAddToCart() {
    if (!selected || !cheapest) return setError('Please choose a date first.');
    if (participants <= 0) return setError('Please add at least one guest.');
    if (participants > seatsLeft) return setError('Not enough space left on that date.');
    addToCart({
      id: `${selected.occurrenceId}:${cheapest.label}`,
      slug,
      title,
      image,
      occurrenceId: selected.occurrenceId,
      dateLabel: dateText,
      lang,
      priceLabel: cheapest.label,
      guests: participants,
      unitEur: cheapest.amountEur,
      groupPricing: isGroup,
      maxGuests: cheapest.maxGuests,
      unit: unitLabel,
    });
    setError(null);
    showToast({ title: 'Added to cart', description: `${title} — ${dateText}.` });
  }

  const canBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const canFwd = view < new Date(horizon.getFullYear(), horizon.getMonth(), 1);
  const rowClass =
    'flex w-full items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3 text-left hover:border-teal';

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]"
    >
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
          {/* Participants */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => (o === 'parts' ? null : 'parts'))}
              className={rowClass}
            >
              <IconUsers width={18} height={18} className="text-teal" />
              <span className="flex-1 text-[14px] font-semibold text-ink">
                Participants <span className="text-ink-muted">× {participants}</span>
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'parts' && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 flex items-center justify-between rounded-xl border border-ink/12 bg-white px-4 py-3 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                <span className="text-sm font-semibold text-ink">{isGroup ? 'Group size' : 'Guests'}</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="Remove participant"
                    onClick={() => setParticipants((n) => Math.max(1, n - 1))}
                    disabled={participants <= 1}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconMinus width={15} height={15} />
                  </button>
                  <span className="w-5 text-center font-bold tabular-nums text-ink">{participants}</span>
                  <button
                    type="button"
                    aria-label="Add participant"
                    onClick={() => setParticipants((n) => Math.min(maxParticipants, n + 1))}
                    disabled={participants >= maxParticipants}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconPlus width={15} height={15} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Date */}
          <div className="relative">
            <button
              type="button"
              disabled={noAvailability}
              onClick={() => setOpen((o) => (o === 'date' ? null : 'date'))}
              className={`${rowClass} disabled:opacity-60`}
            >
              <IconCalendar width={18} height={18} className="text-teal" />
              <span className={`flex-1 text-[14px] font-semibold ${date ? 'text-ink' : 'text-ink-muted'}`}>
                {noAvailability ? 'No dates available yet' : dateText}
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'date' && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-2xl border border-ink/12 bg-white p-4 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="Previous month"
                    disabled={!canBack}
                    onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                    className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
                  >
                    <IconChevronLeft width={16} height={16} />
                  </button>
                  <span className="text-[14px] font-bold text-ink">
                    {view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    type="button"
                    aria-label="Next month"
                    disabled={!canFwd}
                    onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                    className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
                  >
                    <IconChevronRight width={16} height={16} />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="py-1 text-[11px] font-semibold text-ink-muted">
                      {w}
                    </span>
                  ))}
                  {monthCells(view.getFullYear(), view.getMonth()).map((cell, i) => {
                    if (!cell) return <span key={`e${i}`} />;
                    const disabled = isDisabled(cell);
                    const isSel = date === dateKey(cell);
                    return (
                      <button
                        key={cell.toISOString()}
                        type="button"
                        disabled={disabled}
                        onClick={() => pickDate(cell)}
                        className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-[13px] font-medium ${
                          isSel
                            ? 'bg-teal text-white'
                            : disabled
                              ? 'cursor-default text-ink/25'
                              : 'text-ink hover:bg-teal/10'
                        }`}
                      >
                        {cell.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Language */}
          {languages.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === 'lang' ? null : 'lang'))}
                aria-label="Guide language"
                aria-expanded={open === 'lang'}
                className={rowClass}
              >
                <IconGlobe width={18} height={18} className="text-teal" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-teal">Guide</span>
                <span className="flex-1 text-right text-[14px] font-semibold text-ink">{lang}</span>
                <IconChevron
                  width={16}
                  height={16}
                  className={`text-ink-muted transition-transform ${open === 'lang' ? 'rotate-180' : ''}`}
                />
              </button>
              {open === 'lang' && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                  {languages.map((l) => {
                    const active = l === lang;
                    return (
                      <button
                        key={l}
                        type="button"
                        onClick={() => {
                          setLang(l);
                          setOpen(null);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink hover:bg-cream"
                      >
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                            active ? 'border-teal' : 'border-ink/30'
                          }`}
                        >
                          {active && <span className="h-2.5 w-2.5 rounded-full bg-teal" />}
                        </span>
                        {l}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink/[0.08] pt-3.5">
          <span className="text-[13px] font-bold text-ink/80">Total</span>
          <span className="text-xl font-extrabold tracking-tight text-ink">
            {date && total != null ? eur(total) : '—'}
          </span>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={goToCheckout}
          disabled={!date}
          className="mt-3.5 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark disabled:opacity-50"
        >
          Book now
        </button>
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!date}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-teal px-4 py-3 text-[15px] font-bold text-teal-dark transition-colors hover:bg-teal/5 disabled:opacity-50"
        >
          <IconCart width={17} height={17} /> Add to cart
        </button>
        <p className="mt-2 text-center text-[11.5px] text-ink-muted">
          You won&apos;t be charged until you confirm on the next screen.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" /> Free cancellation up to 24 hours
            before
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" /> Reserve now &amp; pay later
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
