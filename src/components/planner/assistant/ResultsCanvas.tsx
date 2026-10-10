'use client';

import { useState } from 'react';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { IconPlus, IconStar, IconX } from '@/components/ui/icons';
import { RouteMap } from '@/components/maps/RouteMap';
import type { PlannerSession } from '../usePlannerSession';
import { PICKUPS, fmtDur } from '../planner-constants';
import { PickupSearch } from '../PickupSearch';
import { PlacesDrawer } from '../PlacesDrawer';
import { Thumb } from '../Thumb';
import { StopCard, TourCard } from './StopCard';
import { CompareTable } from './CompareTable';
import { focusStopCard } from './focus-stop';
import { CarGlyph, IconFork, IconPrinter, IconRefresh } from './icons';

/**
 * The results canvas: the plan ZilAi built, beside the chat that built it.
 *
 * The day is drawn as a road — a spine running from the pick-up through each numbered stop and back,
 * with the drive time written on every leg — because that is what we actually sell: a car, a driver,
 * and this route. The map on the right is the same day, and the bar at the bottom is its price.
 */
export function ResultsCanvas({
  session,
  onClose,
}: {
  session: PlannerSession;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [editingPickup, setEditingPickup] = useState(false);
  const {
    stops,
    route,
    typing,
    isTrip,
    days,
    activeDay,
    activeDayIdx,
    pickup,
    dropoff,
    quote,
    view,
    selectedBmt,
    dinnerPlace,
  } = session;

  const comparing = view === 'compare' && stops.length > 0;
  const dropoffDiffers = !!dropoff && dropoff.id !== pickup.id;
  const endName = dropoffDiffers ? dropoff!.name : pickup.name;
  const lastLeg = route.segs[stops.length];
  // A restored link names its stops before their places have been fetched: show that it is loading
  // rather than an empty day.
  const resolving = session.activeStopIds.length > 0 && stops.length === 0;

  const heading = session.prompt
    ? t('Results for “{query}”', { query: session.prompt })
    : session.bannerTour
      ? t('{tour} — make it yours', { tour: session.bannerTour })
      : t('Your plan');
  const dayName = isTrip && activeDay ? t('Day {n}', { n: activeDayIdx + 1 }) : t('Day 1');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── heading + tools ── */}
      <header className="shrink-0 px-5 pb-3 pt-4 lg:px-8 lg:pt-6">
        <div className="flex items-start gap-3">
          <h1 className="m-0 line-clamp-2 min-w-0 flex-1 text-balance text-[21px] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink lg:text-[28px]">
            {heading}
          </h1>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close the plan')}
            className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
          >
            <IconX width={24} height={24} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={comparing}
            disabled={stops.length < 2}
            onClick={() => session.setView(comparing ? 'list' : 'compare')}
            className="flex h-11 cursor-pointer items-center gap-3 rounded-full border border-ink/70 pl-4 pr-2 text-[14.5px] font-bold text-ink transition-colors hover:bg-ink/[0.04] disabled:cursor-default disabled:border-ink/25 disabled:text-ink-muted disabled:hover:bg-transparent"
          >
            {t('Compare my options')}
            <span
              aria-hidden
              className={`relative h-7 w-12 rounded-full transition-colors duration-200 ${
                comparing ? 'bg-teal-dark' : 'bg-ink/25'
              }`}
            >
              {/* `left` is stated, not left to default: an absolutely positioned box with no
                  `left` starts where it would have sat in the text flow, and a <button> centres its
                  text — so the knob began at the MIDDLE of the track and slid out the far side. */}
              <span
                className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  comparing ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => window.print()}
              aria-label={t('Print or save as PDF')}
              title={t('Print or save as PDF')}
              className="grid h-11 w-11 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
            >
              <IconPrinter width={19} height={19} />
            </button>
            <button
              type="button"
              onClick={session.regenerate}
              disabled={typing || stops.length === 0}
              title={t('Keeps the stops you hearted and replaces the rest')}
              // The words give way to the icon on a phone, where the toolbar would otherwise wrap
              // onto a second row and push the plan down; the label stays for a screen reader.
              aria-label={t('Regenerate unpinned')}
              className="group flex h-11 cursor-pointer items-center gap-2 rounded-full bg-teal-dark px-3.5 text-[14.5px] font-bold text-white transition-colors hover:bg-ink disabled:cursor-default disabled:bg-ink/20 sm:px-4"
            >
              <IconRefresh
                width={17}
                height={17}
                className={`transition-transform duration-500 ${typing ? '' : 'group-hover:rotate-180'}`}
              />
              <span className="hidden sm:inline">{t('Regenerate unpinned')}</span>
            </button>
          </div>
        </div>

        {isTrip && days && (
          <div
            className="zilai-scroll zilai-scroll-x -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 lg:-mx-8 lg:px-8"
            role="tablist"
            aria-label={t('Trip days')}
          >
            {days.map((d, i) => {
              const active = i === activeDayIdx;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => session.setActiveDayIdx(i)}
                  className={`shrink-0 cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold transition-colors ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-ink/20 text-ink hover:border-ink/50'
                  }`}
                >
                  {t('Day {n}', { n: i + 1 })}
                  <span
                    className={`ml-1.5 font-medium ${active ? 'text-white/75' : 'text-ink-muted'}`}
                  >
                    {session.dayDateLabel(d.date)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* ZilAi is changing this plan. */}
      <div className="relative h-[3px] shrink-0 overflow-hidden">
        {typing && (
          <div
            className="zilai-progress absolute inset-0 bg-teal/15"
            role="status"
            aria-label={t('Updating your plan')}
          />
        )}
      </div>

      {/* `data-view` lets the stylesheet give the comparison the map's space as well. */}
      <div
        className="zilai-canvas-body flex min-h-0 flex-1"
        data-view={comparing ? 'compare' : 'list'}
      >
        {/* ── the day ── */}
        <div className="zilai-canvas-list relative flex min-w-0 flex-1 flex-col">
          <div
            className={`zilai-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3 transition-opacity duration-300 lg:px-8 ${
              typing ? 'opacity-60' : ''
            }`}
          >
            <div className="mb-4">
              <h2 className="m-0 text-[22px] font-extrabold tracking-[-0.01em] text-ink">
                {dayName}
              </h2>
              {session.dayTitle && (
                <p className="m-0 mt-0.5 text-[16px] text-ink">{session.dayTitle}</p>
              )}
              {stops.length > 0 && (
                <p className="m-0 mt-1 text-[13.5px] text-ink-muted">
                  {t('{n} stops · {dur} driving · {km} km', {
                    n: stops.length,
                    dur: fmtDur(route.totalMinutes),
                    km: route.totalKm,
                  })}
                </p>
              )}
            </div>

            {selectedBmt && activeDay && (
              <div className="mb-5">
                <TourCard
                  activity={selectedBmt}
                  date={activeDay.date}
                  seatsLeft={selectedBmt.seatsLeft}
                  onRemove={() => session.removeDayActivity(activeDay.date)}
                />
              </div>
            )}

            {comparing ? (
              <CompareTable
                stops={stops}
                notes={session.notes}
                legs={route.segs}
                pinnedIds={session.pinnedIds}
                busy={typing}
                onTogglePin={session.togglePin}
                onRemove={session.removeStop}
              />
            ) : (
              // Keyed by the day so switching days replays the route being drawn.
              <ol key={activeDay?.date ?? 'single'} className="relative m-0 list-none p-0">
                {/* the road */}
                <span
                  aria-hidden
                  className="zilai-spine absolute bottom-5 left-[24px] top-5 w-[2px] rounded-full bg-teal/30"
                />

                {/* start */}
                <li className="relative pb-1 pl-[52px]">
                  <span
                    aria-hidden
                    className="absolute left-[9px] top-0.5 grid h-8 w-8 place-items-center rounded-full bg-coral-dark text-[13px] font-extrabold text-white ring-4 ring-white"
                  >
                    P
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1.5">
                    <span className="text-[13.5px] text-ink-muted">{t('Pick-up')}</span>
                    <span className="text-[15px] font-bold text-ink">{pickup.name}</span>
                    <button
                      type="button"
                      onClick={() => setEditingPickup((v) => !v)}
                      aria-expanded={editingPickup}
                      className="cursor-pointer text-[14px] font-semibold text-teal-dark underline decoration-teal/40 underline-offset-[3px] hover:decoration-teal"
                    >
                      {editingPickup ? t('Done') : t('Change')}
                    </button>
                  </div>
                  {editingPickup && (
                    <div className="zilai-view mt-2.5 max-w-[440px] rounded-2xl border border-ink/[0.14] bg-white p-3.5">
                      <PickupSearch
                        value={pickup}
                        onChange={session.choosePickup}
                        presets={PICKUPS}
                        dotClassName="bg-ink"
                        onUseMyLocation={
                          session.mayUseDeviceLocation ? session.useMyLocation : undefined
                        }
                        locating={session.locating}
                        locateError={session.locateError}
                      />
                      <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
                        <input
                          type="checkbox"
                          checked={session.wantsDropoff}
                          onChange={(e) => {
                            session.setWantsDropoff(e.target.checked);
                            if (!e.target.checked) session.setDropoff(null);
                          }}
                          className="h-[18px] w-[18px] accent-teal-dark"
                        />
                        {t('Drop me off somewhere else')}
                      </label>
                      {session.wantsDropoff && (
                        <div className="mt-2.5">
                          <PickupSearch
                            value={dropoff}
                            onChange={session.setDropoff}
                            presets={PICKUPS}
                            placeholder={t('Search drop-off location')}
                            dotClassName="bg-coral"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </li>

                {resolving &&
                  [0, 1, 2].map((i) => (
                    <li key={i} className="relative py-2 pl-[52px]" aria-hidden>
                      <div className="flex gap-4 rounded-2xl border border-ink/[0.14] p-3.5">
                        <div className="zilai-skel h-[120px] w-[120px] shrink-0 rounded-xl" />
                        <div className="flex-1 space-y-3 pt-1">
                          <div className="zilai-skel h-5 w-3/5 rounded" />
                          <div className="zilai-skel h-3.5 w-2/5 rounded" />
                          <div className="zilai-skel h-3.5 w-full rounded" />
                          <div className="zilai-skel h-3.5 w-4/5 rounded" />
                        </div>
                      </div>
                    </li>
                  ))}

                {stops.map((place, i) => {
                  const leg = route.segs[i];
                  return [
                    leg && (
                      <DriveLeg
                        key={`leg-${place.id}`}
                        label={t('{m} min · {km} km', { m: leg.minutes, km: leg.km })}
                      />
                    ),
                    <StopCard
                      key={place.id}
                      place={place}
                      index={i}
                      count={stops.length}
                      note={session.notes.get(place.id)}
                      pinned={session.pinnedIds.has(place.id)}
                      busy={typing}
                      onTogglePin={() => session.togglePin(place.id)}
                      onRemove={() => session.removeStop(place.id)}
                      onMove={(to) => session.moveStop(i, to)}
                    />,
                  ];
                })}

                {stops.length === 0 && !resolving && (
                  <li className="py-3 pl-[52px] text-[15px] leading-[1.5] text-ink-muted">
                    {selectedBmt
                      ? t(
                          'No driving stops on this day — the tour fills it. Add one if you’d like more.',
                        )
                      : t(
                          'Nothing on this day yet. Ask ZilAi in the chat, or add a stop yourself.',
                        )}
                  </li>
                )}

                {/* add + the way back */}
                <li className="relative py-3 pl-[52px]">
                  <button
                    type="button"
                    onClick={() => session.setDrawerOpen(true)}
                    disabled={session.dayFull}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-ink/70 px-4 py-2 text-[14px] font-bold text-ink transition-colors hover:bg-ink hover:text-white disabled:cursor-default disabled:border-ink/25 disabled:text-ink-muted disabled:hover:bg-transparent"
                  >
                    <IconPlus width={16} height={16} />
                    {session.dayFull ? t('Day full — 6 stops') : t('Add a stop')}
                  </button>
                </li>
                {stops.length > 0 && lastLeg && (
                  <>
                    <DriveLeg
                      label={t('{m} min · {km} km', { m: lastLeg.minutes, km: lastLeg.km })}
                    />
                    <li className="relative pl-[52px]">
                      <span
                        aria-hidden
                        className="absolute left-[9px] top-0 grid h-8 w-8 place-items-center rounded-full bg-coral-dark text-[13px] font-extrabold text-white ring-4 ring-white"
                      >
                        {dropoffDiffers ? 'D' : 'P'}
                      </span>
                      <div className="flex flex-wrap items-baseline gap-x-2 pb-1 pt-1">
                        <span className="text-[13.5px] text-ink-muted">
                          {dropoffDiffers ? t('Drop-off') : t('Back at')}
                        </span>
                        <span className="text-[15px] font-bold text-ink">{endName}</span>
                      </div>
                    </li>
                  </>
                )}
              </ol>
            )}

            {dinnerPlace && activeDay && (
              <div className="zilai-view mt-5 flex items-center gap-3 rounded-2xl bg-ink/[0.04] p-3">
                <Thumb place={dinnerPlace} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                    <IconFork width={14} height={14} />
                    {t('Dinner nearby')}
                  </div>
                  <div className="truncate text-[15px] font-bold text-ink">{dinnerPlace.name}</div>
                </div>
                <button
                  type="button"
                  onClick={() => session.removeDayDinner(activeDay.date)}
                  aria-label={t('Remove {name} from the day', { name: dinnerPlace.name })}
                  className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/[0.06] hover:text-ink"
                >
                  <IconX width={17} height={17} />
                </button>
              </div>
            )}
          </div>

          {/* ── the price of this day ── */}
          {stops.length > 0 && (
            <div className="shrink-0 border-t border-ink/10 bg-white px-5 py-3 lg:px-8">
              <div className="flex items-center gap-3">
                <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-tint text-teal-dark sm:grid">
                  <CarGlyph size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold text-ink">
                    {quote
                      ? t('{vehicle} with your own driver', { vehicle: t(quote.vehicle) })
                      : (session.quoteError ?? t('Private car with your own driver'))}
                  </div>
                  <div className="truncate text-[13px] text-ink-muted">
                    {session.party === 1
                      ? t('1 traveller')
                      : t('{n} travellers', { n: session.party })}
                    {' · '}
                    {t('one price for the vehicle, not per person')}
                  </div>
                </div>
                {quote && (
                  <div className="shrink-0 text-right">
                    <div className="text-[20px] font-extrabold leading-none tabular-nums text-ink">
                      <Price eur={quote.totalEur} />
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">{t('for the day')}</div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => session.setQuoteOpen(true)}
                  disabled={!quote}
                  className="h-11 shrink-0 cursor-pointer rounded-full bg-teal-dark px-5 text-[15px] font-bold text-white transition-colors hover:bg-ink disabled:cursor-default disabled:bg-ink/20"
                >
                  {t('Get quote')}
                </button>
              </div>
            </div>
          )}

          <PlacesDrawer
            open={session.drawerOpen}
            onClose={() => session.setDrawerOpen(false)}
            selectedIds={session.activeStopIds}
            onAdd={session.addPlace}
            addReason={session.addReasonForRegion}
          />
        </div>

        {/* ── the same day, on the map ── */}
        <div className="zilai-canvas-map relative w-full shrink-0 lg:w-[42%] lg:max-w-[760px] lg:pb-6 lg:pr-6">
          <div className="relative h-full overflow-hidden lg:rounded-2xl">
            <RouteMap
              stops={session.mapStops}
              kinds={session.mapKinds}
              labels={session.mapLabels}
              animate={stops.length > 0}
              carColor="#DC2626"
              className="h-full w-full"
              activities={session.mapActivities}
              onActivityClick={session.askAboutActivity}
              dinner={session.mapDinner}
              // Index 0 is the pick-up pin; the stops follow it.
              onStopClick={(i) => {
                const place = stops[i - 1];
                if (place) focusStopCard(place.id);
              }}
            />
            <button
              type="button"
              onClick={session.toggleBmtLayer}
              aria-pressed={session.showBmtLayer}
              className={`absolute left-3 top-3 z-10 cursor-pointer rounded-full px-3.5 py-2 text-[13px] font-bold shadow-[0_4px_14px_rgba(10,46,54,0.22)] transition-colors ${
                session.showBmtLayer
                  ? 'bg-teal-dark text-white'
                  : 'bg-white text-ink hover:text-teal-dark'
              }`}
            >
              {session.bmtLoading ? t('Loading activities…') : t('Our activities')}
            </button>

            {stops.length > 0 && (
              <div className="zilai-scroll zilai-scroll-x absolute inset-x-0 bottom-0 z-10 flex gap-2.5 overflow-x-auto p-3">
                {stops.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => focusStopCard(p.id)}
                    className="zilai-rail-tile flex w-[232px] shrink-0 cursor-pointer items-center gap-2.5 rounded-xl bg-white p-2 text-left shadow-[0_6px_18px_rgba(10,46,54,0.2)] transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <Thumb place={p} size={54} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-bold text-ink">
                        <span className="tabular-nums">{i + 1}. </span>
                        {p.name}
                      </span>
                      <span className="flex items-center gap-1 truncate text-[12.5px] text-ink-muted">
                        {typeof p.rating === 'number' && p.ratingCount ? (
                          <>
                            <span className="font-bold tabular-nums text-ink">
                              {p.rating.toFixed(1)}
                            </span>
                            <IconStar
                              width={12}
                              height={12}
                              fill="currentColor"
                              stroke="none"
                              className="text-gold"
                            />
                            <span className="tabular-nums">
                              ({p.ratingCount.toLocaleString('en')})
                            </span>
                            <span aria-hidden>·</span>
                          </>
                        ) : null}
                        {t(p.category)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The drive between two points on the road: a small car and the time, sitting on the spine. */
function DriveLeg({ label }: { label: string }) {
  return (
    <li className="relative flex items-center py-2 pl-[52px] text-[13px] font-semibold text-ink-muted">
      <span
        aria-hidden
        className="absolute left-[11px] grid h-7 w-7 place-items-center rounded-full bg-white text-teal-dark"
      >
        <CarGlyph size={20} />
      </span>
      {label}
    </li>
  );
}
