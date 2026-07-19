'use client';

import { useRef, useState } from 'react';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { PlannerRouteCalc } from '@/lib/planner/route';
import type { PlannerQuote } from '@/lib/planner/pricing';
import type { BmtActivity } from '@/lib/planner/our-activities';
import { PICKUPS, fmtDur, type PlannerPoint } from './planner-constants';
import { PickupSearch } from './PickupSearch';
import { Thumb } from './Thumb';
import { ActivityCard } from './ActivityCard';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';

function DriveChip({ minutes, km }: { minutes: number; km: number }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-tint px-2.5 py-[3px] text-[11.5px] font-bold text-teal-dark">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 16l1.4-4A2 2 0 0 1 8.3 11h7.4a2 2 0 0 1 1.9 1l1.4 4M5 16v2.5a.5.5 0 0 0 .5.5H7a.5.5 0 0 0 .5-.5V16M5 16h14m0 0v2.5a.5.5 0 0 1-.5.5H17a.5.5 0 0 1-.5-.5V16"
          stroke="#0B5C63"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t('{minutes} min · {km} km', { minutes, km })}
    </span>
  );
}

/** "Your day" — pickup + drop-off search, drag-reorderable stops with live drive chips, totals + quote
 *  CTA. In trip mode it also carries the day's date, an anchored Belle Mare Tours activity card, and
 *  the evening's dinner suggestion. */
export function ItineraryPanel({
  stops,
  pickup,
  onPickup,
  dropoff,
  onDropoff,
  wantsDropoff,
  onWantsDropoff,
  route,
  quote,
  onAddPlaces,
  dayFull,
  onRemove,
  onMove,
  onQuote,
  onShare,
  shared,
  dayLabel,
  activity,
  onRemoveActivity,
  dinner,
  onRemoveDinner,
  onUseMyLocation,
  locating,
  locateError,
}: {
  stops: PlannerPlace[];
  pickup: PlannerPoint;
  onPickup: (point: PlannerPoint) => void;
  /** Drop-off point, or null when it's the same as the pickup (a round trip). */
  dropoff: PlannerPoint | null;
  onDropoff: (point: PlannerPoint | null) => void;
  /** Whether the "Different" drop-off mode is on (parent-owned so it survives remounts/clears). */
  wantsDropoff: boolean;
  onWantsDropoff: (v: boolean) => void;
  route: PlannerRouteCalc;
  quote: PlannerQuote | null;
  onAddPlaces: () => void;
  /** True when the day is at the 6-stop cap — disables "Add places". */
  dayFull: boolean;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onQuote: () => void;
  onShare: () => void;
  shared: boolean;
  /** Trip mode: "Day 2 — Tue 2 Sep" heading (null/undefined = the classic "Your day"). */
  dayLabel?: string | null;
  /** Trip mode: the Belle Mare Tours activity anchored to this day, when the AI recommended one. */
  activity?: { activity: BmtActivity; date: string; seatsLeft?: number } | null;
  onRemoveActivity?: () => void;
  /** Trip mode: the evening's dinner suggestion (not part of the drive). */
  dinner?: PlannerPlace | null;
  onRemoveDinner?: () => void;
  /** Offers "Use my current location" on the PICK-UP field only (never the drop-off). Undefined for
   *  visitors outside Mauritius, who never see it. */
  onUseMyLocation?: () => void;
  locating?: boolean;
  locateError?: string | null;
}) {
  const t = useT();
  const dragFrom = useRef<number | null>(null);
  // Keyboard reorder (the drag-drop below is mouse-only): the per-stop ▲/▼ buttons move a stop one slot
  // and announce it, so a keyboard / screen-reader user can reorder the day too.
  const [announce, setAnnounce] = useState('');
  const moveStop = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= stops.length) return;
    onMove(i, to);
    setAnnounce(
      t('Moved {name} to position {n} of {total}.', {
        name: stops[i]!.name,
        n: to + 1,
        total: stops.length,
      }),
    );
  };
  const segs = route.segs; // pickup→s1, s1→s2, …, sN→(drop-off or pickup)
  // A distinct drop-off only turns the route one-way once a place is actually chosen; `wantsDropoff`
  // just reveals the search.
  const dropoffDiffers = !!dropoff && dropoff.id !== pickup.id;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* header */}
      <div className="flex items-center justify-between px-[15px] pt-3.5">
        <div>
          <div className="font-display text-[18px] font-semibold text-ink">
            {dayLabel ?? t('Your day')}
          </div>
          <div className="mt-px text-xs text-ink-muted">
            {stops.length ? t('{n} stops planned', { n: stops.length }) : t('No stops yet')}
          </div>
        </div>
        <button
          type="button"
          onClick={onAddPlaces}
          disabled={dayFull}
          aria-label={dayFull ? t('Your day is full') : undefined}
          className={`rounded-[10px] border px-3 py-2 text-[12.5px] font-bold ${
            dayFull
              ? 'cursor-default border-[#EEF1F0] bg-[#F4F8F7] text-ink-muted'
              : 'cursor-pointer border-[#E3EEEC] bg-teal-tint text-teal-dark'
          }`}
        >
          {dayFull ? t('Day full') : t('+ Add places')}
        </button>
      </div>

      {/* pickup + drop-off */}
      <div className="border-b border-[#EEF4F3] px-[15px] py-3.5">
        <div className="mb-[7px] block text-[11px] font-bold uppercase tracking-[0.04em] text-ink-muted">
          {t('Pick-up')}
        </div>
        <PickupSearch
          value={pickup}
          onChange={onPickup}
          presets={PICKUPS}
          dotClassName="bg-ink"
          onUseMyLocation={onUseMyLocation}
          locating={locating}
          locateError={locateError}
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-ink-muted">
            {t('Drop-off')}
          </span>
          <div className="flex rounded-full bg-[#EEF4F3] p-0.5 text-[11.5px] font-bold">
            <button
              type="button"
              onClick={() => {
                onWantsDropoff(false);
                onDropoff(null);
              }}
              className={`rounded-full px-2.5 py-1 transition ${!wantsDropoff ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              {t('Same as pick-up')}
            </button>
            <button
              type="button"
              onClick={() => onWantsDropoff(true)}
              className={`rounded-full px-2.5 py-1 transition ${wantsDropoff ? 'bg-white text-ink shadow-sm' : 'text-ink-muted'}`}
            >
              {t('Different')}
            </button>
          </div>
        </div>
        {wantsDropoff && (
          <div className="mt-2">
            <PickupSearch
              value={dropoff}
              onChange={onDropoff}
              presets={PICKUPS}
              placeholder={t('Search drop-off location')}
              dotClassName="bg-coral"
            />
          </div>
        )}
      </div>

      {/* stops */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[15px] py-3">
        {/* Trip mode: the day's anchored Belle Mare Tours activity leads the day. */}
        {activity && (
          <div className="mb-3">
            <ActivityCard
              activity={activity.activity}
              date={activity.date}
              seatsLeft={activity.seatsLeft}
              onRemove={onRemoveActivity}
            />
          </div>
        )}
        {stops.length === 0 && !activity ? (
          <div className="px-2.5 py-[30px] text-center text-ink-muted">
            <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-[14px] border-2 border-dashed border-[#D6E5E3]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 5v14M5 12h14" stroke="#9DBDBB" strokeWidth={2} strokeLinecap="round" />
              </svg>
            </div>
            <p className="m-0 text-[13.5px] font-semibold text-[#7A8B8F]">
              {t('Ask ZilAi or add places')}
            </p>
            <p className="m-0 mt-1 text-[12.5px]">
              {t('Stops appear here with live drive times.')}
            </p>
          </div>
        ) : stops.length === 0 ? (
          // Activity day with no driving stops — that's a valid plan, not an empty one.
          <p className="m-0 px-2.5 py-3 text-center text-[12.5px] text-ink-muted">
            {t('No driving stops this day — add some, or enjoy the activity.')}
          </p>
        ) : (
          <div>
            {/* pickup → first */}
            <div className="flex items-center gap-[7px] pb-2 pl-7 text-[11.5px] font-semibold text-ink-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 16l1.4-4A2 2 0 0 1 8.3 11h7.4a2 2 0 0 1 1.9 1l1.4 4M5 16v2.5a.5.5 0 0 0 .5.5H7a.5.5 0 0 0 .5-.5V16M5 16h14m0 0v2.5a.5.5 0 0 1-.5.5H17a.5.5 0 0 1-.5-.5V16"
                  stroke="#51666B"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('{n} min from pick-up', { n: segs[0]?.minutes ?? 0 })}
            </div>

            <div aria-live="polite" className="sr-only">
              {announce}
            </div>
            <div className="flex flex-col">
              {stops.map((p, i) => (
                <div key={p.id}>
                  <div
                    draggable
                    onDragStart={() => {
                      dragFrom.current = i;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFrom.current != null && dragFrom.current !== i)
                        onMove(dragFrom.current, i);
                      dragFrom.current = null;
                    }}
                    className="flex items-center gap-2.5 rounded-[14px] border border-[#EAF2F1] bg-white px-2.5 py-[9px] shadow-[0_3px_10px_rgba(10,46,54,.04)]"
                  >
                    {/* ▲/▼ keyboard reorder (parallel to drag-drop). Buttons are focusable + operable;
                        the grip dots stay as the visual affordance. */}
                    <span className="grid grid-rows-2 gap-0.5 px-0.5">
                      <button
                        type="button"
                        aria-label={t('Move {name} up', { name: p.name })}
                        disabled={i === 0}
                        onClick={() => moveStop(i, -1)}
                        className="grid h-4 w-4 place-items-center rounded text-[#7A8B8F] hover:bg-[#EAF2F1] disabled:opacity-30"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M6 15l6-6 6 6"
                            stroke="currentColor"
                            strokeWidth={2.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        aria-label={t('Move {name} down', { name: p.name })}
                        disabled={i === stops.length - 1}
                        onClick={() => moveStop(i, 1)}
                        className="grid h-4 w-4 place-items-center rounded text-[#7A8B8F] hover:bg-[#EAF2F1] disabled:opacity-30"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M6 9l6 6 6-6"
                            stroke="currentColor"
                            strokeWidth={2.4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </span>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-coral text-xs font-extrabold text-white shadow-[0_3px_8px_rgba(247,108,94,.34)]">
                      {i + 1}
                    </span>
                    <Thumb place={p} size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-bold text-ink">{p.name}</div>
                      <div className="mt-px text-[11.5px] text-ink-muted">
                        {p.category} · {fmtDur(p.durationMin)}
                        {p.closesAt ? ` · ${t('till {time}', { time: p.closesAt })}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(p.id)}
                      aria-label={t('Remove {name}', { name: p.name })}
                      className="grid place-items-center rounded-lg p-1.5 text-[#B7C6C8] transition hover:bg-[#FDECEA] hover:text-coral"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M6 6l12 12M18 6L6 18"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                  {i < stops.length - 1 && (
                    <div className="flex items-center gap-[7px] py-[5px] pl-7">
                      <span className="h-[18px] w-0.5 rounded bg-[#CDE6E4]" />
                      <DriveChip minutes={segs[i + 1]?.minutes ?? 0} km={segs[i + 1]?.km ?? 0} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* return / drop-off */}
            <div className="flex items-center gap-[7px] pl-7 pt-[9px] text-[11.5px] font-semibold text-ink-muted">
              <span className="h-2 w-2 rounded-full border-2 border-[#B7C6C8]" />
              {dropoffDiffers
                ? `${t('Drop-off')} · ${dropoff!.name} · ${t('{n} min', { n: segs[segs.length - 1]?.minutes ?? 0 })}`
                : t('Return to pick-up · {n} min', { n: segs[segs.length - 1]?.minutes ?? 0 })}
            </div>
          </div>
        )}

        {/* Trip mode: the evening's dinner suggestion — a recommendation, not a route stop. */}
        {dinner && (
          <div className="mt-3 border-t border-dashed border-[#E7EFEE] pt-3">
            <div className="mb-[7px] text-[11px] font-bold uppercase tracking-[0.04em] text-ink-muted">
              {t('Dinner idea')}
            </div>
            <div className="flex items-center gap-2.5 rounded-[14px] border border-[#D8ECEA] bg-[#FBFDFC] px-2.5 py-[9px]">
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-teal-tint">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M7 3v7a2 2 0 0 0 2 2v9M7 3v4M11 3v7a2 2 0 0 1-2 2M11 3v4M17 3c-1.7 1-2.5 3-2.5 5.5 0 2 .8 3 2 3.5v9M17 3v18"
                    stroke="#0E8C92"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-bold text-ink">{dinner.name}</div>
                <div className="mt-px text-[11.5px] text-ink-muted">
                  {dinner.blurb || t('Evening suggestion near your pick-up area')}
                </div>
              </div>
              {onRemoveDinner && (
                <button
                  type="button"
                  onClick={onRemoveDinner}
                  aria-label={t('Remove {name}', { name: dinner.name })}
                  className="grid place-items-center rounded-lg p-1.5 text-[#B7C6C8] transition hover:bg-[#FDECEA] hover:text-coral"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* totals + CTA */}
      {stops.length > 0 && (
        <div className="border-t border-[#EEF4F3] bg-[#FBFDFC] px-[15px] py-3.5">
          <div className="mb-3 flex justify-between gap-1.5">
            {[
              ['Stops', String(stops.length)],
              ['Driving', fmtDur(route.totalMinutes)],
              ['Distance', `${route.totalKm} km`],
            ].map(([k, v]) => (
              <div key={k} className="flex-1 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.03em] text-ink-muted">
                  {t(k ?? '')}
                </div>
                <div className="text-[14.5px] font-extrabold text-ink transition-all duration-300">
                  {v}
                </div>
              </div>
            ))}
            <div className="flex-[1.2] border-l border-[#E7EFEE] text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.03em] text-gold">
                {t('Est. price')}
              </div>
              <div className="font-display text-[19px] font-extrabold text-gold tabular-nums transition-all duration-300">
                {quote ? <Price eur={quote.totalEur} /> : '—'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onQuote}
            className="w-full cursor-pointer rounded-[13px] py-[13px] text-[15px] font-extrabold text-white shadow-[0_10px_22px_rgba(14,140,146,.30)]"
            style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
          >
            {t('Get my quote →')}
          </button>
          <div className="mt-[9px] flex gap-2">
            <button
              type="button"
              onClick={onShare}
              className="flex flex-1 cursor-pointer items-center justify-center gap-[7px] rounded-[10px] border border-[#E3EEEC] bg-white py-[9px] text-[12.5px] font-bold text-teal-dark transition hover:bg-teal-tint"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M8.7 13.3 15.3 17M15.3 7 8.7 10.7M18 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM8.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM18 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"
                  stroke="#0B5C63"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {shared ? t('Link copied') : t('Share')}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex flex-1 cursor-pointer items-center justify-center gap-[7px] rounded-[10px] border border-[#E3EEEC] bg-white py-[9px] text-[12.5px] font-bold text-teal-dark transition hover:bg-teal-tint"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9 13h6M9 17h4M8 3h5l5 5v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM13 3v5h5"
                  stroke="#0B5C63"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
