'use client';

import type { PlannerPlace } from '@/lib/validation/planner';
import type { PlannerQuote } from '@/lib/planner/pricing';
import type { BmtActivity } from '@/lib/planner/our-activities';
import type { TripDayPlan } from '@/lib/planner/trip';
import { computePlannerRoute } from '@/lib/planner/route';
import { fmtDur, type PlannerPoint } from './planner-constants';
import { SITE } from '@/lib/seo/site';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';

/**
 * The printable trip document — what "PDF" actually produces.
 *
 * The button used to call `window.print()` against the live page, so the browser dumped the whole
 * app: hero, chat transcript, nav, suggestion chips, four pages of furniture, and the itinerary
 * squeezed into a screenshot of a scroll pane. Nothing a traveller could hand a driver.
 *
 * This is a separate document instead: hidden on screen (`hidden print:block`), the only thing that
 * prints (everything else carries `print:hidden`). It lays out the trip the way a paper itinerary
 * should read — every day, its stops in order with drive times between them, any Belle Mare Tours
 * activity booked into that day, the dinner suggestion, and the quote.
 *
 * Every number here comes from the same functions the on-screen planner uses, so the sheet can never
 * quote a different day or price from the page it was printed off. Drive times are recomputed per
 * day with `computePlannerRoute` — it's pure and synchronous, so a 7-day trip prints complete rather
 * than only showing the day that happened to be on screen.
 */
export function PlannerPrintSheet({
  days,
  stops,
  pickup,
  dropoff,
  quote,
  party,
  date,
  time,
  catalog,
  bmtBySlug,
}: {
  /** Trip mode: every day of the range. Null in single-day mode, where `stops` is the day. */
  days: TripDayPlan[] | null;
  /** Single-day mode's stops, in order. */
  stops: PlannerPlace[];
  pickup: PlannerPoint;
  /** A distinct drop-off, or null when the day returns to the pick-up. */
  dropoff: PlannerPoint | null;
  quote: PlannerQuote | null;
  party: number;
  /** The single-day booking date (trip mode uses each day's own date). */
  date: string;
  time: string;
  catalog: Map<string, PlannerPlace>;
  bmtBySlug: Map<string, BmtActivity & { seatsLeft?: number | null }>;
}) {
  const t = useT();
  const dropoffDiffers = !!dropoff && dropoff.id !== pickup.id;
  const end = dropoffDiffers ? dropoff! : pickup;

  /** One printed day: its stops resolved from the catalogue, plus its own route. */
  const buildDay = (dayStops: PlannerPlace[]) => ({
    stops: dayStops,
    route: computePlannerRoute(
      pickup,
      dayStops.map((s) => ({ lat: s.lat, lng: s.lng, durationMin: s.durationMin })),
      end,
    ),
  });

  const printedDays = days
    ? days.map((d) => ({
        date: d.date,
        activity: d.activitySlug ? (bmtBySlug.get(d.activitySlug) ?? null) : null,
        dinner: d.dinnerId ? (catalog.get(d.dinnerId) ?? null) : null,
        ...buildDay(
          d.stopIds.map((id) => catalog.get(id)).filter((p): p is PlannerPlace => Boolean(p)),
        ),
      }))
    : [{ date, activity: null, dinner: null, ...buildDay(stops) }];

  const planned = printedDays.some((d) => d.stops.length || d.activity);
  // An empty planner has nothing to print; printing a blank letterhead would just waste the paper.
  if (!planned) return null;

  const longDate = (dayKey: string): string => {
    const d = new Date(`${dayKey}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? dayKey
      : d.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
  };

  return (
    <div className="hidden print:block print:text-[11pt] print:text-black">
      <header className="mb-5 border-b-2 border-black/80 pb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-[20pt] font-semibold">{SITE.name}</h1>
          <span className="text-[10pt]">{SITE.url.replace(/^https?:\/\//, '')}</span>
        </div>
        <p className="mt-1 text-[12pt] font-bold">
          {days && days.length > 1
            ? t('Your {n}-day Mauritius trip', { n: days.length })
            : t('Your day in Mauritius')}
        </p>
        <p className="mt-0.5 text-[10pt]">
          {t('Pick-up {time} · {name}', { time, name: pickup.name })}
          {dropoffDiffers ? ` · ${t('Drop-off {name}', { name: dropoff!.name })}` : ''}
          {` · ${t('{n} travellers', { n: party })}`}
        </p>
      </header>

      {printedDays.map((d, i) => (
        <section key={d.date || i} className="mb-5 break-inside-avoid">
          <h2 className="mb-2 border-b border-black/30 pb-1 text-[12pt] font-bold">
            {days && days.length > 1
              ? `${t('Day {n}', { n: i + 1 })} — ${longDate(d.date)}`
              : longDate(d.date)}
          </h2>

          {d.stops.length > 0 && (
            <ol className="mb-2">
              {d.stops.map((s, j) => (
                <li key={s.id} className="mb-1.5 break-inside-avoid">
                  <div className="flex gap-2">
                    <span className="font-bold">{j + 1}.</span>
                    <div>
                      <span className="font-bold">{s.name}</span>
                      <span className="text-[10pt]">
                        {' '}
                        — {s.category} · {fmtDur(s.durationMin)}
                        {s.closesAt ? ` · ${t('closes {time}', { time: s.closesAt })}` : ''}
                      </span>
                      {/* Drive to the NEXT stop — segs[0] is pick-up → stop 1, so the hop leaving
                          stop j is segs[j+1]. The last one is the drive home, labelled as such. */}
                      {d.route.segs[j + 1] && (
                        <div className="text-[9.5pt] italic">
                          ↓ {fmtDur(d.route.segs[j + 1]!.minutes)} · {d.route.segs[j + 1]!.km} km
                          {j === d.stops.length - 1
                            ? ` — ${dropoffDiffers ? t('to drop-off') : t('back to pick-up')}`
                            : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {d.activity && (
            <p className="mb-1 text-[10.5pt]">
              <span className="font-bold">{t('Booked activity')}:</span> {d.activity.title}
              {d.activity.durationMinutes != null ? ` · ${fmtDur(d.activity.durationMinutes)}` : ''}
              {d.activity.fromPriceEur != null ? (
                <>
                  {' · '}
                  {t('from')} <Price eur={d.activity.fromPriceEur} />
                </>
              ) : null}
            </p>
          )}
          {d.dinner && (
            <p className="mb-1 text-[10.5pt]">
              <span className="font-bold">{t('Dinner suggestion')}:</span> {d.dinner.name}
            </p>
          )}

          {d.stops.length > 0 && (
            <p className="text-[10pt]">
              {t('{stops} stops · {driving} driving · {km} km · {visiting} at stops', {
                stops: d.stops.length,
                driving: fmtDur(d.route.totalMinutes),
                km: d.route.totalKm,
                visiting: fmtDur(d.route.visitMinutes),
              })}
            </p>
          )}
        </section>
      ))}

      {quote && (
        <section className="mt-4 break-inside-avoid border-t-2 border-black/80 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[12pt] font-bold">
              {t('Estimated transport')} — {quote.vehicle}
            </span>
            <span className="text-[14pt] font-bold">
              <Price eur={quote.totalEur} />
            </span>
          </div>
          {/* The planner's price covers the vehicle for the day. Activity tickets are their own
              bookings, so a printed total must not read as "everything is paid for". */}
          <p className="mt-1 text-[9.5pt]">
            {t(
              'Covers the vehicle and driver for the day. Activity tickets are booked and paid separately. Subject to availability until confirmed.',
            )}
          </p>
        </section>
      )}

      <footer className="mt-5 border-t border-black/30 pt-2 text-[9.5pt]">
        {SITE.legalName} · {SITE.phone} · {SITE.email}
      </footer>
    </div>
  );
}
