'use client';

import { useEffect, useState } from 'react';
import type { TourType } from '@/lib/validation/common';
import type { TourOption } from '@/lib/validation/tours';
import { lineTotalEur } from '@/lib/catalogue/detail';
import { whatsappUrl } from '@/lib/seo/site';
import {
  IconBolt,
  IconCalendar,
  IconChat,
  IconCheck,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconShield,
} from '@/components/ui/icons';

const MAX_PARTICIPANTS = 12;

function optionFrom(option: TourOption): number | null {
  const prices = option.prices.map((p) => p.amountEur);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function eur(amount: number): string {
  return Number.isInteger(amount) ? `€${amount}` : `€${amount.toFixed(2)}`;
}

export interface BookingPanelProps {
  type: TourType;
  title: string;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
}

/**
 * Sticky booking panel. Builds a live quote (participants / vehicle × unit price) and,
 * until the Peach hosted checkout lands in Phase 4, routes the guest to an interim
 * WhatsApp reservation pre-filled with their selection.
 */
export function BookingPanel({ type, title, fromPriceEur, options, languages }: BookingPanelProps) {
  const isTransport = type === 'transport';
  const [participants, setParticipants] = useState(2);
  const [optionIdx, setOptionIdx] = useState(0);
  const [date, setDate] = useState('');
  const [minDate, setMinDate] = useState('');

  // Set the calendar floor after mount to avoid a server/client time mismatch.
  useEffect(() => {
    setMinDate(new Date().toISOString().slice(0, 10));
  }, []);

  const selectedOption = options[optionIdx];
  const unit = isTransport
    ? (selectedOption ? optionFrom(selectedOption) : null) ?? fromPriceEur
    : fromPriceEur;

  const quantity = isTransport ? 1 : participants;
  const total = unit != null ? lineTotalEur(unit, quantity) : null;

  const dateText = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : 'Add a date';

  const message =
    `Hi Belle Mare Tours! I'd like to reserve "${title}"` +
    (isTransport && selectedOption ? ` — ${selectedOption.name}` : '') +
    (date ? ` on ${dateText}` : '') +
    (isTransport ? '' : ` for ${participants} ${participants === 1 ? 'guest' : 'guests'}`) +
    (total != null ? ` (approx ${eur(total)}).` : '.') +
    ' Is it available?';

  return (
    <div className="overflow-hidden rounded-[20px] border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]">
      <div
        className={`flex items-center gap-2 px-[18px] py-2.5 text-[12.5px] font-bold text-white ${
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
          <span className="text-[32px] font-extrabold tracking-tight text-ink">
            {fromPriceEur != null ? eur(fromPriceEur) : 'On request'}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-ink-muted">
          {isTransport ? 'per vehicle, one way' : 'per person'}
        </div>

        <div className="mt-[18px] flex flex-col gap-3">
          {isTransport ? (
            options.length > 0 && (
              <label className="block rounded-[13px] border border-ink/15 px-3.5 py-3">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-teal">
                  Vehicle
                </span>
                <select
                  value={optionIdx}
                  onChange={(e) => setOptionIdx(Number(e.target.value))}
                  className="w-full cursor-pointer bg-transparent text-[13.5px] font-semibold text-ink outline-none"
                >
                  {options.map((option, i) => (
                    <option key={option.id} value={i}>
                      {option.name}
                      {optionFrom(option) != null ? ` — from ${eur(optionFrom(option)!)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : (
            <div className="flex items-center justify-between rounded-[13px] border border-ink/15 px-3.5 py-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-teal">
                  Participants
                </div>
                <div className="mt-0.5 text-[13.5px] text-ink/80">Guests</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setParticipants((n) => Math.max(1, n - 1))}
                  disabled={participants <= 1}
                  aria-label="Remove a guest"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                >
                  <IconMinus width={16} height={16} />
                </button>
                <span className="w-5 text-center text-base font-bold tabular-nums text-ink">
                  {participants}
                </span>
                <button
                  type="button"
                  onClick={() => setParticipants((n) => Math.min(MAX_PARTICIPANTS, n + 1))}
                  disabled={participants >= MAX_PARTICIPANTS}
                  aria-label="Add a guest"
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                >
                  <IconPlus width={16} height={16} />
                </button>
              </div>
            </div>
          )}

          <label className="relative flex cursor-pointer items-center gap-3 rounded-[13px] border border-ink/15 px-3.5 py-3 focus-within:border-teal">
            <IconCalendar width={18} height={18} className="text-teal" />
            <span className="flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-teal">
                {isTransport ? 'Arrival date' : 'Date'}
              </span>
              <span className="block text-[13.5px] font-semibold text-ink">{dateText}</span>
            </span>
            <input
              type="date"
              value={date}
              min={minDate || undefined}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Choose a date"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>

          {!isTransport && languages.length > 0 && (
            <div className="flex items-center gap-3 rounded-[13px] border border-ink/15 px-3.5 py-3">
              <IconGlobe width={18} height={18} className="text-teal" />
              <span className="flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-teal">
                  Live guide
                </span>
                <span className="block text-[13.5px] font-semibold text-ink">
                  {languages.join(', ')}
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-ink/[0.08] pt-3.5">
          <span className="text-[13px] font-bold text-ink/80">Total</span>
          <span className="text-xl font-extrabold tracking-tight text-ink">
            {total != null ? eur(total) : '—'}
          </span>
        </div>

        <a
          href={whatsappUrl(message)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-[13px] bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark"
        >
          <IconChat width={18} height={18} /> Reserve on WhatsApp
        </a>
        <p className="mt-2 text-center text-[11.5px] text-ink-muted">
          Secure online checkout is launching soon.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" /> Free cancellation up to 24
            hours before
          </div>
          <div className="flex items-center gap-2.5 text-[13px] text-ink/80">
            <IconCheck width={16} height={16} className="text-teal" />
            {isTransport ? 'Meet & greet — fuel & tolls included' : 'Instant confirmation & e-voucher'}
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
