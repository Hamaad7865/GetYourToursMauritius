'use client';

import type { PlannerPlace } from '@/lib/validation/planner';
import type { PlannerRouteCalc } from '@/lib/planner/route';
import type { PlannerQuote } from '@/lib/planner/pricing';
import { CHILD_SEAT_EUR, childSeatsCost } from '@/lib/services/pricing';
import { useDialog } from '@/lib/a11y/useDialog';
import { fmtDur } from './planner-constants';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';

const inputCls =
  'w-full rounded-[11px] border border-[#E3EEEC] bg-white px-[13px] py-[11px] text-[14.5px] text-ink outline-none focus:border-teal';
const labelCls = 'mb-1.5 block text-xs font-bold text-ink-muted';

/**
 * Quote → real booking. Collects the day-specific bits the checkout can't (date, pick-up time, party,
 * SUV, baby/child seats), then hands off to the live availability → hold → /checkout flow (where name
 * + payment happen). A centred pop-up modal; the conversion is the app's real booking path.
 */
export function QuoteModal({
  open,
  onClose,
  stops,
  route,
  quote,
  quoteError,
  maxParty,
  date,
  setDate,
  minDate,
  time,
  setTime,
  party,
  setParty,
  suv,
  setSuv,
  childSeats,
  setChildSeats,
  booking,
  bookError,
  onBook,
}: {
  open: boolean;
  onClose: () => void;
  stops: PlannerPlace[];
  route: PlannerRouteCalc;
  quote: PlannerQuote | null;
  quoteError: string | null;
  maxParty: number;
  date: string;
  setDate: (d: string) => void;
  minDate: string;
  time: string;
  setTime: (t: string) => void;
  party: number;
  setParty: (n: number) => void;
  suv: boolean;
  setSuv: (v: boolean) => void;
  childSeats: number;
  setChildSeats: (n: number) => void;
  booking: boolean;
  bookError: string | null;
  onBook: () => void;
}) {
  const t = useT();
  const money = useMoney();
  // APG modal behaviour: scroll-lock, Escape to close, focus trap, and focus restore on close.
  const dialogRef = useDialog(open, onClose);
  if (!open) return null;
  // Seats are capped at the party; the first is free, then €6 each. Show the running add-on.
  const seats = Math.min(childSeats, party);
  const seatExtra = childSeatsCost(seats);
  const estimate = quote ? quote.totalEur + seatExtra : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Get your quote')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-[4px]"
    >
      <div ref={dialogRef} className="max-h-[90vh] w-full max-w-[460px] animate-pop overflow-y-auto rounded-[22px] bg-white shadow-[0_24px_60px_rgba(10,46,54,.34)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onBook();
          }}
          className="pb-[22px] pt-5"
        >
          <div className="px-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="m-0 font-display text-[23px] font-semibold text-ink">{t('Get my quote')}</h3>
              <button type="button" onClick={onClose} aria-label={t('Close')} className="grid h-8 w-8 cursor-pointer place-items-center rounded-[10px] bg-[#F1F6F5]">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="#51666B" strokeWidth={2} strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="mb-4 mt-0.5 text-[13.5px] text-ink-muted">
              {t('{n} stops · {dur} driving · est.', { n: stops.length, dur: fmtDur(route.totalMinutes) })}{' '}
              <strong className="text-gold">{estimate != null ? <Price eur={estimate} /> : quoteError}</strong>
            </p>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="q-date" className={labelCls}>{t('Date')}</label>
                <input id="q-date" required type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="q-time" className={labelCls}>{t('Pick-up time')}</label>
                <input id="q-time" required type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="mb-3">
              <span className={labelCls}>{t('Party size')}</span>
              <div className="flex w-fit items-center gap-3 rounded-[11px] border border-[#E6EFEE] bg-[#F4F8F7] px-3 py-[7px]">
                <button type="button" onClick={() => setParty(Math.max(1, party - 1))} aria-label={t('Fewer travellers')} className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] bg-white text-lg font-bold text-teal-dark">
                  −
                </button>
                <span className="min-w-[60px] text-center text-[15px] font-bold tabular-nums">
                  {party > 1 ? t('{n} people', { n: party }) : t('{n} person', { n: party })}
                </span>
                <button type="button" onClick={() => setParty(Math.min(maxParty, party + 1))} aria-label={t('More travellers')} className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] bg-white text-lg font-bold text-teal-dark">
                  +
                </button>
              </div>
            </div>

            {party <= 4 && (
              <label className="mb-3 flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
                <input type="checkbox" checked={suv} onChange={(e) => setSuv(e.target.checked)} className="h-4 w-4 accent-teal" />
                {t('SUV upgrade')}
              </label>
            )}

            {/* Baby & child seats — first free, €6 each extra, capped at the party. */}
            <div className="mb-4 flex items-center justify-between gap-3 rounded-[11px] border border-[#E6EFEE] bg-[#F4F8F7] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-ink">{t('Baby & child seats')}</div>
                <div className="text-[12px] text-ink-muted">
                  {t('First seat free · {price} each extra', { price: money(CHILD_SEAT_EUR) })}
                  {seatExtra > 0 && <span className="font-semibold text-teal-dark"> · +{money(seatExtra)}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setChildSeats(Math.max(0, seats - 1))}
                  disabled={seats <= 0}
                  aria-label={t('Fewer child seats')}
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] bg-white text-lg font-bold text-teal-dark disabled:opacity-40"
                >
                  −
                </button>
                <span className="min-w-[20px] text-center text-[15px] font-bold tabular-nums">{seats}</span>
                <button
                  type="button"
                  onClick={() => setChildSeats(Math.min(party, seats + 1))}
                  disabled={seats >= party}
                  aria-label={t('More child seats')}
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-[9px] bg-white text-lg font-bold text-teal-dark disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>

            {bookError && <p className="mb-3 text-sm font-medium text-coral">{bookError}</p>}

            <button
              type="submit"
              disabled={booking || !quote}
              className="w-full cursor-pointer rounded-[13px] py-3.5 text-[15.5px] font-extrabold text-white shadow-[0_10px_24px_rgba(14,140,146,.3)] disabled:opacity-50"
              style={{ background: booking ? '#0B5C63' : 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
            >
              {booking ? t('Starting your booking…') : t('Continue to checkout →')}
            </button>
            <p className="m-0 mt-[11px] text-center text-xs text-ink-muted">
              {t('✓ No payment now · confirm your details and a verified local driver on the next step')}
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
