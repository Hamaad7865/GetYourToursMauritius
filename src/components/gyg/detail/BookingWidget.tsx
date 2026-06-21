'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useBooking } from './BookingProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
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
  onPick,
}: {
  month: Date;
  selectedKey: string;
  tomorrow: Date;
  available: (cell: Date) => boolean;
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
        return (
          <button
            key={cell.toISOString()}
            type="button"
            disabled={!ok}
            onClick={() => onPick(cell)}
            className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-[13px] font-medium ${
              isSel
                ? 'bg-teal text-white'
                : ok
                  ? 'text-ink hover:bg-teal/10'
                  : `cursor-default text-ink/30 ${past ? 'line-through' : ''}`
            }`}
          >
            {cell.getDate()}
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
  const b = useBooking();
  const {
    activity,
    participants,
    setParticipants,
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

  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 180);

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

  const dateText = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : t('Select a date');
  const noAvailability = days !== null && days.size === 0;

  function isDisabled(cell: Date): boolean {
    if (cell < tomorrow) return true;
    const info = days?.get(nominalDayKey(cell));
    return !info || info.seatsLeft <= 0;
  }
  function pickDate(cell: Date) {
    setDate(nominalDayKey(cell));
    setOpen(null);
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

  return (
    <div
      ref={rootRef}
      className="rounded-2xl border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]"
    >
      <div
        className={`flex items-center gap-2 rounded-t-2xl px-5 py-2.5 text-[12.5px] font-bold text-white ${
          isTransport ? 'bg-teal' : 'bg-gradient-to-r from-coral to-[#e8584a]'
        }`}
      >
        {isTransport ? (
          <>
            <IconShield width={15} height={15} /> {t('Free cancellation up to 24h')}
          </>
        ) : (
          <>
            <IconBolt width={15} height={15} /> {t('Likely to sell out')}
          </>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-ink-muted">{t('From')}</span>
          <span className="text-[30px] font-extrabold tracking-tight text-ink">
            {activity.fromPriceEur != null ? <Price eur={activity.fromPriceEur} /> : t('On request')}
          </span>
        </div>
        <div className="text-[13px] text-ink-muted">{unitLabelText}</div>

        <div className="mt-4 flex flex-col gap-2.5">
          {/* Participants */}
          <div className="relative">
            <button type="button" onClick={() => setOpen((o) => (o === 'parts' ? null : 'parts'))} className={rowClass}>
              <IconUsers width={18} height={18} className="text-teal" />
              <span className="flex-1 text-[14px] font-semibold text-ink">
                {t('Participants')} <span className="text-ink-muted">× {participants}</span>
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'parts' && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-xl border border-ink/12 bg-white p-4 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
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
                      className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 text-teal hover:border-teal disabled:opacity-40"
                    >
                      <IconMinus width={15} height={15} />
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
                      className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 text-teal hover:border-teal disabled:opacity-40"
                    >
                      <IconPlus width={15} height={15} />
                    </button>
                  </div>
                </div>
                {participants >= MAX_PARTY && (
                  <p className="mt-3 text-[12.5px] text-ink-muted">
                    {t('Travelling with more than {n}?', { n: MAX_PARTY })}{' '}
                    <Link href="/contact" className="font-bold text-teal underline underline-offset-2">
                      {t('Contact us')}
                    </Link>{' '}
                    {t('for a quote.')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="mt-4 w-full rounded-full bg-teal px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
                >
                  {t('Continue')}
                </button>
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
                {noAvailability ? t('No dates available yet') : dateText}
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {open === 'date' && (
              // Floats above the page (the card no longer clips it) — anchored right, it extends left
              // over the gallery. Two months on sm+, one on mobile, like the GYG-style picker.
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[min(92vw,21rem)] rounded-2xl border border-ink/12 bg-white p-4 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)] sm:w-[40rem]">
                {/* Nav: prev far-left, month name(s) centred, next far-right. */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-label={t('Previous month')}
                    disabled={!canBack}
                    onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
                  >
                    <IconChevronLeft width={16} height={16} />
                  </button>
                  <div className="flex flex-1 justify-around text-[14px] font-bold text-ink">
                    <span>{view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                    <span className="hidden sm:inline">
                      {new Date(view.getFullYear(), view.getMonth() + 1, 1).toLocaleDateString('en-GB', {
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
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
                  >
                    <IconChevronRight width={16} height={16} />
                  </button>
                </div>
                <div className="flex gap-6">
                  <div className="flex-1">
                    <MonthGrid month={view} selectedKey={date} tomorrow={tomorrow} available={(c) => !isDisabled(c)} onPick={pickDate} />
                  </div>
                  <div className="hidden flex-1 sm:block">
                    <MonthGrid
                      month={new Date(view.getFullYear(), view.getMonth() + 1, 1)}
                      selectedKey={date}
                      tomorrow={tomorrow}
                      available={(c) => !isDisabled(c)}
                      onPick={pickDate}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Language */}
          {activity.languages.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === 'lang' ? null : 'lang'))}
                aria-label={t('Guide language')}
                aria-expanded={open === 'lang'}
                className={rowClass}
              >
                <IconGlobe width={18} height={18} className="text-teal" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-teal">{t('Guide')}</span>
                <span className="flex-1 text-right text-[14px] font-semibold text-ink">{lang}</span>
                <IconChevron
                  width={16}
                  height={16}
                  className={`text-ink-muted transition-transform ${open === 'lang' ? 'rotate-180' : ''}`}
                />
              </button>
              {open === 'lang' && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                  {activity.languages.map((l) => {
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

        <button
          type="button"
          disabled={!date || seatsForDate <= 0 || (!isVehicle && seatsForDate < participants)}
          onClick={checkAvailability}
          className="mt-4 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark disabled:opacity-50"
        >
          {t('Check availability')}
        </button>
        {date && !isVehicle && seatsForDate > 0 && seatsForDate < participants && (
          <p className="mt-2 text-center text-[12px] font-medium text-coral">
            {t('Only {n} {noun} left on this date.', {
              n: seatsForDate,
              noun: seatsForDate === 1 ? t('spot') : t('spots'),
            })}
          </p>
        )}
        <p className="mt-2 text-center text-[11.5px] text-ink-muted">
          {t('You won’t be charged until you confirm.')}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2.5 rounded-b-2xl border-t border-ink/[0.08] bg-cream px-5 py-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink/80">
          <IconShield width={15} height={15} className="text-teal" /> {t('Secure payment by Peach')}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-bold text-teal">
          <IconBolt width={15} height={15} /> {t('Instant confirmation')}
        </span>
      </div>
    </div>
  );
}
