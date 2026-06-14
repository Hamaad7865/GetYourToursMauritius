'use client';

import { useEffect, useState } from 'react';
import type { TourType } from '@/lib/validation/common';
import type { TourOption } from '@/lib/validation/tours';
import { whatsappUrl } from '@/lib/seo/site';
import {
  IconBolt,
  IconCalendar,
  IconChat,
  IconCheck,
  IconChevron,
  IconGlobe,
  IconMinus,
  IconPlus,
  IconShield,
  IconUsers,
} from '@/components/ui/icons';

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

interface Cheapest {
  amountEur: number;
  maxGuests: number | null;
}

function cheapestTier(options: TourOption[]): Cheapest | null {
  const tiers = options.flatMap((o) => o.prices);
  if (tiers.length === 0) return null;
  return tiers.reduce((a, b) => (b.amountEur < a.amountEur ? b : a));
}

export interface BookingCardProps {
  type: TourType;
  title: string;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
}

/** GetYourGuide-style sticky booking widget. Builds a live quote and (until the Phase 4
 *  Peach checkout) routes to an interim WhatsApp reservation. */
export function BookingCard({ type, title, fromPriceEur, options, languages }: BookingCardProps) {
  const isTransport = type === 'transport';
  const cheapest = cheapestTier(options);
  const isGroup = cheapest?.maxGuests != null;
  const maxParticipants = isGroup ? cheapest!.maxGuests! : 12;

  const [participants, setParticipants] = useState(isGroup ? Math.min(2, maxParticipants) : 2);
  const [partsOpen, setPartsOpen] = useState(false);
  const [date, setDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [lang, setLang] = useState(languages[0] ?? 'English');

  useEffect(() => {
    setMinDate(new Date().toISOString().slice(0, 10));
  }, []);

  const unitLabel = isGroup
    ? `per group up to ${cheapest!.maxGuests}`
    : isTransport
      ? 'per vehicle'
      : 'per person';

  const base = cheapest?.amountEur ?? fromPriceEur;
  const total = base == null ? null : isGroup ? base : Math.round(base * participants * 100) / 100;

  const dateText = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : 'Select a date';

  const message =
    `Hi Belle Mare Tours! I'd like to reserve "${title}"` +
    (date ? ` on ${dateText}` : '') +
    ` for ${participants} ${participants === 1 ? 'guest' : 'guests'}` +
    (total != null ? ` (approx ${eur(total)}).` : '.') +
    ' Is it available?';

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
            {base != null ? eur(base) : 'On request'}
          </span>
        </div>
        <div className="text-[13px] text-ink-muted">{unitLabel}</div>

        <div className="mt-4 flex flex-col gap-2.5">
          {/* Participants */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPartsOpen((o) => !o)}
              className="flex w-full items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3 text-left hover:border-teal"
            >
              <IconUsers width={18} height={18} className="text-teal" />
              <span className="flex-1 text-[14px] font-semibold text-ink">
                Participants <span className="text-ink-muted">× {participants}</span>
              </span>
              <IconChevron width={16} height={16} className="text-ink-muted" />
            </button>
            {partsOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 flex items-center justify-between rounded-xl border border-ink/12 bg-white px-4 py-3 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                <span className="text-sm font-semibold text-ink">
                  {isGroup ? 'Group size' : 'Guests'}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setParticipants((n) => Math.max(1, n - 1))}
                    disabled={participants <= 1}
                    aria-label="Remove participant"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconMinus width={15} height={15} />
                  </button>
                  <span className="w-5 text-center font-bold tabular-nums text-ink">
                    {participants}
                  </span>
                  <button
                    type="button"
                    onClick={() => setParticipants((n) => Math.min(maxParticipants, n + 1))}
                    disabled={participants >= maxParticipants}
                    aria-label="Add participant"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal hover:text-teal disabled:opacity-40"
                  >
                    <IconPlus width={15} height={15} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Date */}
          <label className="relative flex cursor-pointer items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3 focus-within:border-teal">
            <IconCalendar width={18} height={18} className="text-teal" />
            <span className="flex-1 text-[14px] font-semibold text-ink">{dateText}</span>
            <IconChevron width={16} height={16} className="text-ink-muted" />
            <input
              type="date"
              value={date}
              min={minDate || undefined}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Select a date"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>

          {/* Language */}
          {languages.length > 0 && (
            <label className="flex items-center gap-3 rounded-xl border border-ink/15 px-3.5 py-3">
              <IconGlobe width={18} height={18} className="text-teal" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-teal">Guide</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="flex-1 cursor-pointer bg-transparent text-right text-[14px] font-semibold text-ink outline-none"
              >
                {languages.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
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
          className="mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark"
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
            <IconCheck width={16} height={16} className="text-teal" /> Reserve now &amp; pay later
            available
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
