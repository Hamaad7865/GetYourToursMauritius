'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useBooking } from './BookingProvider';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/config';
import { Price } from '@/components/site/Price';
import { ageBandLabel } from '@/lib/services/pricing';
import { activityFromPriceEur } from '@/lib/catalogue/options';
import {
  IconBolt,
  IconCalendar,
  IconChevron,
  IconChevronLeft,
  IconChevronRight,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconShield,
  IconUsers,
} from '@/components/ui/icons';
import { nominalDayKey } from '@/lib/services/day-key';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Hard cap on the party picker — above this the customer is sent to "contact us for a quote". */
const MAX_PARTY = 25;

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

/** One month's grid: weekday row + day cells. Past days are struck through; days with no availability
 *  are muted and disabled. Used twice (this month + next) in the two-month date picker. */
function MonthGrid({
  month,
  selectedKey,
  tomorrow,
  available,
  locale,
  onPick,
}: {
  month: Date;
  selectedKey: string;
  tomorrow: Date;
  available: (cell: Date) => boolean;
  locale: Locale;
  onPick: (cell: Date) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-7 gap-0.5 text-center">
      {WEEKDAYS.map((w) => (
        <span key={w} className="py-1 text-[11px] font-semibold text-ink-muted">
          {t(w)}
        </span>
      ))}
      {monthCells(month.getFullYear(), month.getMonth()).map((cell, i) => {
        if (!cell) return <span key={`e${i}`} />;
        const past = cell < tomorrow;
        const ok = available(cell);
        const isSel = selectedKey === nominalDayKey(cell);
        // Full localized date so a screen reader announces "Saturday, 9 August 2026" instead of "9".
        // Unavailable days get the localized ", unavailable" suffix so the visual (muted + strike)
        // cue is also conveyed to assistive tech.
        const fullDate = formatLocaleDate(cell, locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        const label = ok ? fullDate : t('{date}, unavailable', { date: fullDate });
        return (
          // Outer button is the ≥44px tap target; the inner span keeps the 36px visual glyph.
          <button
            key={cell.toISOString()}
            type="button"
            disabled={!ok}
            aria-label={label}
            aria-pressed={isSel}
            onClick={() => onPick(cell)}
            className="mx-auto grid min-h-[44px] min-w-[44px] place-items-center"
          >
            <span
              className={`grid h-9 w-9 place-items-center rounded-full text-[13px] font-medium ${
                isSel
                  ? 'bg-teal text-white'
                  : ok
                    ? 'text-ink hover:bg-teal/10'
                    : `cursor-default text-ink/55 ${past ? 'line-through' : ''}`
              }`}
            >
              {cell.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * GetYourGuide booking widget (step 1): Participants · Date · Language + a single "Check availability"
 * button. All selection state lives in BookingProvider; pressing the button reveals the option card
 * (BookingOptionCard) in the page body. The vehicle (Sedan/SUV) + price + Continue live in that card.
 */
export function BookingWidget() {
  const t = useT();
  const { language } = usePreferences();
  const b = useBooking();
  const {
    activity,
    participants,
    setParticipants,
    isAgeBanded,
    bandTiers,
    bandCounts,
    setBand,
    totalGuests,
    date,
    setDate,
    lang,
    setLang,
    days,
    maxParticipants,
    unitLabel,
    checkAvailability,
    touch,
  } = b;
  const isTransport = activity.type === 'transport';
  const isVehicle = activity.pricingMode === 'vehicle';
  const isGroup = b.groupSize != null;
  // "From" headline: falls back to a private option's base when the activity has no tier prices
  // (private-only), so it reads "From €X per private trip" instead of "On request".
  const headlineFrom = activityFromPriceEur(activity);
  // The full-price (adult) age band — kept ≥1 so a party is never all-free / infant-only.
  const primaryBandLabel = bandTiers.length
    ? bandTiers.reduce((a, t2) => (t2.amountEur > a.amountEur ? t2 : a)).label
    : null;
  // `unitLabel` stays English in the provider (cart/checkout post it verbatim). Translate for display:
  // the per-group form carries a number, so interpolate it; the rest are static keys.
  const unitLabelText = b.groupSize != null
    ? t('per group up to {n}', { n: b.groupSize })
    : t(unitLabel);

  const [open, setOpen] = useState<'parts' | 'date' | 'lang' | null>(null);
  const [view, setView] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const partsTriggerRef = useRef<HTMLButtonElement>(null);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);

  /** Close a popover and return focus to the trigger that opened it (disclosure focus-restore). */
  function closePopover(which?: 'parts' | 'date' | 'lang') {
    const target = which ?? open;
    setOpen(null);
    const ref =
      target === 'parts' ? partsTriggerRef : target === 'date' ? dateTriggerRef : target === 'lang' ? langTriggerRef : null;
    ref?.current?.focus();
  }

  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 180);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      // Outside pointer-click closes without yanking focus back — the user is already elsewhere.
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    // Escape returns focus to the trigger that opened the popover (well-behaved disclosure).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover(open);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dateText = date
    ? formatLocaleDate(`${date}T00:00:00`, language, { day: 'numeric', month: 'short', year: 'numeric' })
    : t('Select a date');
  const noAvailability = days !== null && days.size === 0;

  function isDisabled(cell: Date): boolean {
    if (cell < tomorrow) return true;
    const info = days?.get(nominalDayKey(cell));
    return !info || info.seatsLeft <= 0;
  }
  function pickDate(cell: Date) {
    setDate(nominalDayKey(cell));
    closePopover('date'); // close + return focus to the date trigger
    touch(); // keep the option card open + show it updating to the new date
    setParticipants(Math.max(1, Math.min(participants, maxParticipants)));
  }

  const canBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const canFwd = view < new Date(horizon.getFullYear(), horizon.getMonth(), 1);
  // The party picker stops at 25; above that we point the customer to a custom quote.
  const partyCap = Math.min(maxParticipants, MAX_PARTY);
  const rowClass =
    'flex w-full items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3 text-left hover:border-teal';
  const seatsForDate = date ? (days?.get(date)?.seatsLeft ?? 0) : 0;

  // "Likely to sell out" is an honest scarcity nudge — show it only when the next bookable date is
  // genuinely low (≤ 5 seats/vehicles left), not on every activity. Use the selected date when one is
  // picked, otherwise the soonest available day (day keys are 'YYYY-MM-DD', so the lexicographic min
  // is the earliest day).
  const scarceSeats = useMemo(() => {
    if (!days || days.size === 0) return null;
    if (date && days.has(date)) return days.get(date)!.seatsLeft;
    let soonest: string | null = null;
    for (const [key, info] of days) {
      if (info.seatsLeft > 0 && (soonest === null || key < soonest)) soonest = key;
    }
    return soonest ? (days.get(soonest)?.seatsLeft ?? null) : null;
  }, [days, date]);
  // A private option's pool counts TRIPS (often 1/day) — "1 left" is its NORMAL state, so the scarcity
  // banner would be permanent false urgency there. The calendar hiding full days is the honest signal.
  const showSellOut =
    !isTransport && !b.privateCfg && scarceSeats != null && scarceSeats > 0 && scarceSeats <= 5;
  // Private sightseeing (vehicle) tours and transfers always offer free cancellation up to 24h (the
  // cancel-&-refund flow), even when the activity record carries no cancellationPolicy text — so the
  // non-scarce strip reassures rather than repeating the footer's "Instant confirmation".
  const freeCancellation = Boolean(activity.cancellationPolicy) || isVehicle;

  return (
    <div
      ref={rootRef}
      className="rounded-2xl border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]"
    >
      <div
        className={`flex items-center gap-2 rounded-t-2xl px-5 py-2.5 text-[12.5px] font-bold text-white ${
          showSellOut ? 'bg-gradient-to-r from-coral to-[#e8584a]' : 'bg-teal'
        }`}
      >
        {showSellOut ? (
          <>
            <IconBolt width={15} height={15} /> {t('Likely to sell out')}
          </>
        ) : freeCancellation || isTransport ? (
          <>
            <IconShield width={15} height={15} /> {t('Free cancellation up to 24h')}
          </>
        ) : (
          <>
            <IconBolt width={15} height={15} /> {t('Instant confirmation')}
          </>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-ink-muted">{t('From')}</span>
          <span className="text-[30px] font-extrabold tracking-tight text-ink">
            {headlineFrom != null ? <Price eur={headlineFrom} /> : t('On request')}
          </span>
        </div>
        <div className="text-[13px] text-ink-muted">
          {unitLabelText}
          {b.privateCfg != null && <> · {t('up to {n} people', { n: b.privateCfg.included })}</>}
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {/* Participants */}
          <div className="relative">
            <button
              ref={partsTriggerRef}
              type="button"
              onClick={() => setOpen((o) => (o === 'parts' ? null : 'parts'))}
              aria-haspopup="dialog"
              aria-expanded={open === 'parts'}
              className={rowClass}
            >
              <IconUsers width={18} height={18} className="text-teal" />
              <span className="flex-1 text-[14px] font-semibold text-ink">
                {isAgeBanded ? t('Guests') : t('Participants')}{' '}
                <span className="text-ink-muted">× {totalGuests}</span>
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'parts' && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-xl border border-ink/12 bg-white p-4 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                {isAgeBanded ? (
                  <div className="flex flex-col divide-y divide-ink/[0.08]">
                    {bandTiers.map((tier) => {
                      const count = bandCounts[tier.label] ?? 0;
                      const range = ageBandLabel(tier.minAge, tier.maxAge);
                      const atCap =
                        totalGuests >= partyCap || (tier.maxGuests != null && count >= tier.maxGuests);
                      // The full-price (adult) band always keeps ≥1 — no €0 / infant-only bookings.
                      const isPrimary = tier.label === primaryBandLabel;
                      return (
                        <div key={tier.id} className="flex items-center justify-between gap-3 py-2">
                          <div>
                            <p className="text-sm font-bold text-ink">{tier.label}</p>
                            <p className="text-[12px] text-ink-muted">
                              {range && <span>{range} · </span>}
                              {tier.amountEur > 0 ? (
                                <Price eur={tier.amountEur} />
                              ) : (
                                <span className="font-bold text-teal-dark">{t('Free')}</span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              aria-label={`${t('Remove')} ${tier.label}`}
                              onClick={() => setBand(tier.label, count - 1)}
                              disabled={isPrimary ? count <= 1 : count <= 0}
                              className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
                            >
                              <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                                <IconMinus width={15} height={15} />
                              </span>
                            </button>
                            <span className="w-6 text-center text-[15px] font-bold tabular-nums text-ink">{count}</span>
                            <button
                              type="button"
                              aria-label={`${t('Add')} ${tier.label}`}
                              onClick={() => setBand(tier.label, count + 1)}
                              disabled={atCap}
                              className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
                            >
                              <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                                <IconPlus width={15} height={15} />
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-ink">
                      {activity.pricingMode === 'vehicle' ? t('Passengers') : isGroup ? t('Group size') : t('Participants')}
                    </p>
                    <p className="text-[12px] text-ink-muted">{t('All ages welcome')}</p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      aria-label={t('Remove participant')}
                      onClick={() => {
                        setParticipants(Math.max(1, participants - 1));
                        touch();
                      }}
                      disabled={participants <= 1}
                      className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                        <IconMinus width={15} height={15} />
                      </span>
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={partyCap}
                      value={participants}
                      aria-label={t('Number of participants')}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (!Number.isNaN(n)) setParticipants(Math.max(1, Math.min(partyCap, n)));
                        touch();
                      }}
                      className="h-9 w-14 rounded-lg border border-ink/15 text-center text-[15px] font-bold tabular-nums text-ink outline-none focus:border-teal [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      aria-label={t('Add participant')}
                      onClick={() => {
                        setParticipants(Math.min(partyCap, participants + 1));
                        touch();
                      }}
                      disabled={participants >= partyCap}
                      className="grid h-11 w-11 place-items-center text-teal disabled:opacity-40"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 hover:border-teal">
                        <IconPlus width={15} height={15} />
                      </span>
                    </button>
                  </div>
                  </div>
                )}
                {isAgeBanded && b.total != null && (
                  <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
                    <span className="text-[13px] text-ink-muted">{t('Total')}</span>
                    <span className="text-[17px] font-extrabold text-ink">
                      <Price eur={b.total} />
                    </span>
                  </div>
                )}
                {/* aria-live so a screen reader hears the over-cap note appear/clear as the count crosses MAX_PARTY. */}
                <div aria-live="polite">
                  {(isAgeBanded ? totalGuests : participants) >= MAX_PARTY && (
                    <p className="mt-3 text-[12.5px] text-ink-muted">
                      {t('Travelling with more than {n}?', { n: MAX_PARTY })}{' '}
                      <Link href="/contact" className="font-bold text-teal-dark underline underline-offset-2">
                        {t('Contact us')}
                      </Link>{' '}
                      {t('for a quote.')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => closePopover('parts')}
                  className="mt-4 w-full rounded-full bg-teal-dark px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-dark/90"
                >
                  {t('Continue')}
                </button>
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            {/* The inner wrapper is the calendar popover's offset parent — it holds ONLY the trigger + the
                calendar. The lead-time notice is kept OUTSIDE it, because a notice in normal flow inside
                this box inflated its height, so the popover's `top: 100%` resolved to below the notice and
                the calendar rendered detached far down the page, overlapping the content beside it. */}
            <div className="relative">
            <button
              ref={dateTriggerRef}
              type="button"
              disabled={noAvailability}
              onClick={() => setOpen((o) => (o === 'date' ? null : 'date'))}
              aria-haspopup="dialog"
              aria-expanded={open === 'date'}
              className={`${rowClass} disabled:opacity-60`}
            >
              <IconCalendar width={18} height={18} className="text-teal" />
              <span className={`flex-1 text-[14px] font-semibold ${date ? 'text-ink' : 'text-ink-muted'}`}>
                {noAvailability ? t('No dates available yet') : dateText}
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'date' && (
              // Floats above the page (the card no longer clips it) — anchored right, it extends left
              // over the gallery. Two months on sm+, one on mobile, like the GYG-style picker.
              <div
                role="dialog"
                aria-label={t('Choose a date')}
                className="absolute right-0 top-[calc(100%+6px)] z-30 w-[min(92vw,21rem)] rounded-2xl border border-ink/12 bg-white p-4 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)] sm:w-[40rem]"
              >
                {/* Nav: prev far-left, month name(s) centred, next far-right. */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-label={t('Previous month')}
                    disabled={!canBack}
                    onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                    className="grid h-11 w-11 shrink-0 place-items-center text-ink disabled:opacity-30"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full hover:bg-cream">
                      <IconChevronLeft width={16} height={16} />
                    </span>
                  </button>
                  <div className="flex flex-1 justify-around text-[14px] font-bold text-ink">
                    <span>{formatLocaleDate(view, language, { month: 'long', year: 'numeric' })}</span>
                    <span className="hidden sm:inline">
                      {formatLocaleDate(new Date(view.getFullYear(), view.getMonth() + 1, 1), language, {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={t('Next month')}
                    disabled={!canFwd}
                    onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                    className="grid h-11 w-11 shrink-0 place-items-center text-ink disabled:opacity-30"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full hover:bg-cream">
                      <IconChevronRight width={16} height={16} />
                    </span>
                  </button>
                </div>
                <div className="flex gap-6">
                  <div className="flex-1">
                    <MonthGrid
                      month={view}
                      selectedKey={date}
                      tomorrow={tomorrow}
                      available={(c) => !isDisabled(c)}
                      locale={language}
                      onPick={pickDate}
                    />
                  </div>
                  <div className="hidden flex-1 sm:block">
                    <MonthGrid
                      month={new Date(view.getFullYear(), view.getMonth() + 1, 1)}
                      selectedKey={date}
                      tomorrow={tomorrow}
                      available={(c) => !isDisabled(c)}
                      locale={language}
                      onPick={pickDate}
                    />
                  </div>
                </div>
              </div>
            )}
            </div>
            {/* Lead-time notice: explains why the nearest days aren't selectable for planning-heavy trips.
                Sits OUTSIDE the popover's offset parent (see note above) so it can't push the calendar down. */}
            {activity.minAdvanceDays > 1 && (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-ink-muted">
                <IconCalendar width={13} height={13} className="mt-px shrink-0 text-teal" />
                {t('Please book at least {n} days in advance — this experience needs planning.', {
                  n: activity.minAdvanceDays,
                })}
              </p>
            )}
          </div>

          {/* Language */}
          {activity.languages.length > 0 && (
            <div className="relative">
              <button
                ref={langTriggerRef}
                type="button"
                onClick={() => setOpen((o) => (o === 'lang' ? null : 'lang'))}
                aria-label={t('Guide language')}
                aria-haspopup="listbox"
                aria-expanded={open === 'lang'}
                className={rowClass}
              >
                <IconGlobe width={18} height={18} className="text-teal" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-teal-dark">{t('Guide')}</span>
                <span className="flex-1 text-right text-[14px] font-semibold text-ink">{lang}</span>
                <IconChevron
                  width={16}
                  height={16}
                  className={`text-ink-muted transition-transform ${open === 'lang' ? 'rotate-180' : ''}`}
                />
              </button>
              {open === 'lang' && (
                <div
                  role="listbox"
                  aria-label={t('Guide language')}
                  className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]"
                >
                  {activity.languages.map((l) => {
                    const active = l === lang;
                    return (
                      <button
                        key={l}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setLang(l);
                          closePopover('lang');
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

        <button
          type="button"
          // seatsLeft counts PEOPLE for per-person options but whole UNITS for vehicle/private (one
          // booking = one vehicle/trip) — so a 1-left day must still accept a party of 6 there.
          disabled={!date || seatsForDate <= 0 || (!isVehicle && !b.privateCfg && seatsForDate < participants)}
          onClick={checkAvailability}
          className="gyt-press mt-4 flex w-full items-center justify-center rounded-xl bg-teal-dark px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(11,92,99,0.7)] hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
        >
          {t('Check availability')}
        </button>
        {/* aria-live so a screen reader hears the low-availability warning when it appears/updates. */}
        <div aria-live="polite">
          {date && !isVehicle && !b.privateCfg && seatsForDate > 0 && seatsForDate < participants && (
            <p className="mt-2 text-center text-[12px] font-medium text-coral-dark">
              {t('Only {n} {noun} left on this date.', {
                n: seatsForDate,
                noun: seatsForDate === 1 ? t('spot') : t('spots'),
              })}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2.5 rounded-b-2xl border-t border-ink/[0.08] bg-cream px-5 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink/80">
          <IconShield width={15} height={15} className="text-teal" /> {t('Secure payment by Peach')}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-teal-dark">
          <IconBolt width={15} height={15} /> {t('Instant confirmation')}
        </span>
      </div>
    </div>
  );
}
