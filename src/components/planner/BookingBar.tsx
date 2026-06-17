'use client';

import type { PlannerQuote } from '@/lib/planner/pricing';

/**
 * The live-price + book bar. The price comes from the same flat per-vehicle logic as the server
 * (`plannerQuote` mirrors the `vehicle_custom` branch), so what the visitor sees is what they pay.
 * "Book this day" hands off to the real checkout (hold → /checkout); disabled until the day has stops.
 */
export function BookingBar({
  party,
  setParty,
  suv,
  setSuv,
  quote,
  quoteError,
  maxParty,
  date,
  setDate,
  minDate,
  booking,
  bookError,
  canBook,
  onBook,
}: {
  party: number;
  setParty: (n: number) => void;
  suv: boolean;
  setSuv: (v: boolean) => void;
  quote: PlannerQuote | null;
  quoteError: string | null;
  maxParty: number;
  date: string;
  setDate: (d: string) => void;
  minDate: string;
  booking: boolean;
  bookError: string | null;
  canBook: boolean;
  onBook: () => void;
}) {
  return (
    <section className="rounded-card border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* Party */}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Travellers</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setParty(Math.max(1, party - 1))}
              disabled={party <= 1}
              aria-label="One fewer traveller"
              className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 text-lg text-ink disabled:opacity-30"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-semibold text-ink">{party}</span>
            <button
              type="button"
              onClick={() => setParty(Math.min(maxParty, party + 1))}
              disabled={party >= maxParty}
              aria-label="One more traveller"
              className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 text-lg text-ink disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>

        {/* SUV (only meaningful for 1–4) */}
        {party <= 4 && (
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={suv}
              onChange={(e) => setSuv(e.target.checked)}
              className="h-4 w-4 accent-teal"
            />
            SUV upgrade
          </label>
        )}

        {/* Date */}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-muted">Date</label>
          <input
            type="date"
            value={date}
            min={minDate}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-full border border-ink/15 px-4 py-2 text-sm text-ink outline-none focus:border-teal"
          />
        </div>

        {/* Price */}
        <div className="ml-auto text-right">
          {quote ? (
            <>
              <p className="text-xs text-ink-muted">{quote.vehicle} · all-in</p>
              <p className="font-display text-2xl leading-none text-ink">€{quote.totalEur}</p>
            </>
          ) : (
            <p className="max-w-[14rem] text-sm text-ink-muted">{quoteError}</p>
          )}
        </div>
      </div>

      {bookError && <p className="mt-3 text-sm text-coral">{bookError}</p>}

      <button
        type="button"
        onClick={onBook}
        disabled={!canBook || !quote || booking}
        className="mt-4 w-full rounded-full bg-coral py-3 text-base font-semibold text-white transition hover:brightness-105 disabled:opacity-40"
      >
        {booking ? 'Starting your booking…' : canBook ? 'Book this day' : 'Add a stop to book'}
      </button>
      <p className="mt-2 text-center text-xs text-ink-muted">
        One flat price per vehicle · instant confirmation · free cancellation
      </p>
    </section>
  );
}
