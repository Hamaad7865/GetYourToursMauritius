'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBooking } from '@/components/gyg/detail/BookingProvider';
import { usePreferences, useT, useMoney } from '@/components/site/PreferencesProvider';
import { formatLocaleDate } from '@/lib/i18n/format';
import { Price } from '@/components/site/Price';
import {
  PHOTOGRAPHY_DEPOSIT_PERCENT,
  photographyHm,
  photographySlotMinutes,
  photographySunTimes,
  type PhotographyGroup,
  type PhotographySlotDef,
} from '@/lib/catalogue/photography';
import { monthCells } from '@/lib/calendar/month';
import { nominalDayKey } from '@/lib/services/day-key';
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconMinus,
  IconPlus,
} from '@/components/ui/icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The v3 sticky booking card (design: "Photography Services v3", Package screen aside). It lives
 * inside the page's BookingProvider and drives the REAL booking machinery: days come from the
 * provider's availability map, the people stepper binds to its participants, the total is the
 * provider's server-mirrored quote, and Continue calls its continueToCheckout. Only the light-slot
 * pick is local — occurrences are day-granular, so a slot is a preference ("Golden hour · 17:10"),
 * registered into the provider so checkoutParams carry it as `slot`.
 */
export function PhotoBookingCard({
  slots,
  group,
  bestSeller,
}: {
  slots: PhotographySlotDef[];
  group: PhotographyGroup;
  bestSeller: boolean;
}) {
  const b = useBooking();
  const t = useT();
  const money = useMoney();
  const { language } = usePreferences();
  const weddings = group === 'weddings';
  const [slotId, setSlotId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const tomorrow = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }, [today]);
  const horizon = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 180);
    return d;
  }, [today]);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const {
    activity,
    date,
    setDate,
    days,
    availabilityError,
    reloadAvailability,
    participants,
    setParticipants,
    maxParticipants,
    privateCfg,
    total,
    busy,
    updating,
    touch,
    setPhotoSlot,
  } = b;

  const dayDate = useMemo(() => (date ? new Date(`${date}T00:00:00`) : null), [date]);
  const sun = dayDate ? photographySunTimes(dayDate) : null;

  // Register the pick into the provider so checkoutParams (and the stashed cart line) carry it.
  // Times shift with the picked day, so the registered string recomputes on either change. The
  // format is "id|Label · HH:MM" — the id lets checkout match the slot's light for the coast tip;
  // checkout parses it tolerantly (a legacy "Label · HH:MM" without the id still renders).
  const slotDef = slots.find((s) => s.id === slotId) ?? null;
  useEffect(() => {
    setPhotoSlot(
      slotDef && dayDate
        ? `${slotDef.id}|${slotDef.label} · ${photographyHm(photographySlotMinutes(slotDef.id, dayDate))}`
        : null,
    );
  }, [slotDef, dayDate, setPhotoSlot]);

  // ?booking=1 (the checkout "Date & extras" back-link) used to open a separate booking view; it now
  // lands on this same page and just scrolls to the card.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('booking') !== '1') return;
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      /* SSR safety — no-op */
    }
  }, []);

  const canBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const canFwd = view < new Date(horizon.getFullYear(), horizon.getMonth(), 1);
  const noAvailability = days !== null && days.size === 0 && !availabilityError;
  const loading = days === null;

  /** Calendar day state: past / sold-out (no occurrence or 0 seats) / low (≤ 2 seats) / open. */
  function dayState(cell: Date): 'past' | 'full' | 'low' | 'open' {
    if (cell < tomorrow) return 'past';
    const info = days?.get(nominalDayKey(cell));
    if (!info || info.seatsLeft <= 0) return 'full';
    return info.seatsLeft <= 2 ? 'low' : 'open';
  }

  function pickDay(cell: Date) {
    setDate(nominalDayKey(cell));
    touch(); // keep any open option card in sync, exactly like BookingWidget's date pick
    setParticipants(Math.max(1, Math.min(participants, maxParticipants)));
  }

  const ready =
    Boolean(date && slotId && total != null) && !busy && !updating && !availabilityError;

  return (
    <aside
      ref={rootRef}
      id="book"
      className="sticky top-[92px] mx-auto flex min-w-[300px] max-w-[480px] flex-[1_1_360px] scroll-mt-6 flex-col gap-5 overflow-hidden rounded-2xl border border-ink/10 bg-white p-6 shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]"
    >
      {bestSeller && (
        <div className="-mx-6 -mt-6 bg-gradient-to-r from-coral to-[#E8584A] px-5 py-2.5 text-[12.5px] font-bold text-white">
          {t('Likely to sell out')}
        </div>
      )}
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] text-ink-muted">{t('From')}</span>
          <span className="text-3xl font-bold tracking-[-0.02em] text-ink">
            {activity.fromPriceEur != null ? (
              <Price eur={activity.fromPriceEur} />
            ) : (
              t('On request')
            )}
          </span>
        </div>
        {privateCfg && (
          <span className="text-[13px] text-ink-muted">
            {t('up to {n} people', { n: privateCfg.included })}
          </span>
        )}
      </div>

      {/* 1. date */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold text-ink">{t('1. Choose a date')}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('Previous month')}
              disabled={!canBack}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="grid h-8 w-8 place-items-center rounded-full border border-ink/10 bg-white text-ink disabled:opacity-35"
            >
              <IconChevronLeft width={16} height={16} />
            </button>
            <span className="min-w-[118px] text-center text-sm font-bold text-ink">
              {formatLocaleDate(view, language, { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              aria-label={t('Next month')}
              disabled={!canFwd}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="grid h-8 w-8 place-items-center rounded-full border border-ink/10 bg-white text-ink disabled:opacity-35"
            >
              <IconChevronRight width={16} height={16} />
            </button>
          </div>
        </div>
        {availabilityError ? (
          <button
            type="button"
            onClick={reloadAvailability}
            className="rounded-xl bg-coral/10 px-3.5 py-3 text-sm font-semibold text-coral-dark"
          >
            {t("Couldn't load dates — tap to retry")}
          </button>
        ) : noAvailability ? (
          <span className="rounded-xl bg-[#F5F7F7] px-3.5 py-3 text-sm text-ink-muted">
            {t('No dates available yet')}
          </span>
        ) : (
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-[11px] font-bold text-ink-muted/70">
                {t(w)}
              </span>
            ))}
            {monthCells(view.getFullYear(), view.getMonth()).map((cell, i) => {
              if (!cell) return <span key={`e${i}`} />;
              const state = loading ? 'full' : dayState(cell);
              const disabled = state === 'past' || state === 'full';
              const isSel = date === nominalDayKey(cell);
              const fullDate = formatLocaleDate(cell, language, {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              });
              return (
                <button
                  key={cell.toISOString()}
                  type="button"
                  disabled={disabled}
                  aria-label={disabled ? t('{date}, unavailable', { date: fullDate }) : fullDate}
                  aria-pressed={isSel}
                  onClick={() => pickDay(cell)}
                  className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[10px] text-sm transition ${
                    isSel
                      ? 'bg-ink font-bold text-white'
                      : disabled
                        ? 'cursor-default text-ink/35 line-through'
                        : 'bg-[#F5F7F7] font-semibold text-ink hover:bg-teal-tint'
                  }`}
                >
                  <span>{cell.getDate()}</span>
                  <span
                    aria-hidden
                    className={`h-1 w-1 rounded-full ${
                      disabled
                        ? 'bg-transparent'
                        : isSel
                          ? 'bg-[#A6E0E2]'
                          : state === 'low'
                            ? 'bg-coral'
                            : 'bg-teal'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-3.5 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" />
            {t('Available')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-coral" />
            {t('Last spots')}
          </span>
          <span className="font-semibold text-ink-muted/70 line-through">14 {t('Full')}</span>
        </div>
        {activity.minAdvanceDays > 1 && (
          <p className="m-0 flex items-start gap-1.5 text-[12px] font-medium text-ink-muted">
            <IconCalendar width={13} height={13} className="mt-px shrink-0 text-teal" />
            {t('Please book at least {n} days in advance — this experience needs planning.', {
              n: activity.minAdvanceDays,
            })}
          </p>
        )}
      </div>

      {/* 2. light slot — a preference, not an availability concept (occurrences are day-granular) */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-bold text-ink">
            {weddings ? t('2. Ceremony time') : t('2. Pick the light')}
          </span>
          <span className="text-xs text-ink-muted">
            {sun
              ? t('Sunrise {rise} · Sunset {set}', {
                  rise: photographyHm(sun.rise),
                  set: photographyHm(sun.set),
                })
              : ''}
          </span>
        </div>
        {!dayDate && (
          <span className="rounded-xl bg-[#F5F7F7] px-3.5 py-3 text-sm text-ink-muted">
            {t('Choose a date to see times for that day.')}
          </span>
        )}
        {dayDate && (
          <div className="flex flex-col gap-2">
            {slots.map((s) => {
              const on = slotId === s.id;
              const note =
                s.light === 'sunset' && sun
                  ? `${s.note} · ${t('sunset at {time}', { time: photographyHm(sun.set) })}`
                  : s.note;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSlotId(on ? null : s.id)}
                  className={`flex items-center justify-between gap-2.5 rounded-xl border-[1.5px] px-3.5 py-3 text-left transition ${
                    on
                      ? 'border-ink bg-ink text-white'
                      : 'border-ink/10 bg-white text-ink hover:border-ink/30'
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-bold">
                      {s.label} · {photographyHm(photographySlotMinutes(s.id, dayDate))}
                    </span>
                    <span className={`text-xs ${on ? 'text-white/75' : 'text-ink-muted'}`}>
                      {note}
                    </span>
                  </span>
                  {on && <span className="text-sm font-bold text-[#A6E0E2]">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. people (weddings price by coverage, not heads — no stepper, matching the v3 design) */}
      {!weddings && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold text-ink">{t('3. People')}</span>
            {privateCfg && privateCfg.extraEur > 0 && (
              <span className="text-xs text-ink-muted">
                {t('{n} included · {price} per extra person', {
                  n: privateCfg.included,
                  price: money(privateCfg.extraEur),
                })}
              </span>
            )}
          </div>
          <div className="flex items-center rounded-full border-[1.5px] border-ink/10">
            <button
              type="button"
              aria-label={t('Fewer people')}
              disabled={participants <= 1}
              onClick={() => {
                setParticipants(participants - 1);
                touch();
              }}
              className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                <IconMinus width={15} height={15} />
              </span>
            </button>
            <span className="w-6 text-center text-[15px] font-bold tabular-nums text-ink">
              {participants}
            </span>
            <button
              type="button"
              aria-label={t('More people')}
              disabled={participants >= maxParticipants}
              onClick={() => {
                setParticipants(participants + 1);
                touch();
              }}
              className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                <IconPlus width={15} height={15} />
              </span>
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5 border-t border-ink/10 pt-4">
        <div className="flex justify-between text-[15px]">
          <span className="text-ink-muted">{t('Total')}</span>
          <span className="font-bold text-ink">{total != null ? <Price eur={total} /> : '—'}</span>
        </div>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void b.continueToCheckout()}
          className={`rounded-full py-[17px] text-base font-bold transition ${
            ready
              ? 'bg-teal text-white hover:bg-teal-dark'
              : 'cursor-not-allowed bg-[#DAE0E1] text-ink-muted'
          }`}
        >
          {busy
            ? t('Loading')
            : !date
              ? t('Choose a date')
              : !slotId
                ? weddings
                  ? t('Choose a ceremony time')
                  : t('Choose a time')
                : `${t('Continue')} · ${money(total ?? 0)}`}
        </button>
        <span className="text-center text-xs text-ink-muted">
          {/* PHOTOGRAPHY_DEPOSIT_PERCENT is pinned to 50 by the deposit trigger — see
              src/lib/catalogue/photography.ts. Replaces the generic "You won't be charged yet". */}
          {t('Pay {pct}% to book your date. The balance is due when your photos are delivered.', {
            pct: PHOTOGRAPHY_DEPOSIT_PERCENT,
          })}
        </span>
      </div>
    </aside>
  );
}
