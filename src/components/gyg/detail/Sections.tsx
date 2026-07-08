import type { ActivityExtra, ItineraryStop } from '@/lib/validation/tours';
import type { TimelineNode } from './ItineraryTimeline';
import { RoutedItinerary } from './RoutedItinerary';
import type { StopKind } from '@/components/maps/RouteMap';
import { durationLabel } from '@/lib/catalogue/detail';
import { getT } from '@/lib/i18n/server';
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconShield,
  IconTrophy,
  IconUsers,
  IconX,
} from '@/components/ui/icons';

/** "Loved by travellers" social-proof banner. Rendered by the detail page above the facts grid — for
 *  every private sightseeing tour (using the operator aggregate when the tour has no reviews of its
 *  own) and for any other activity whose own rating clears 4.5. Kept separate from QuickFacts so the
 *  custom-badges branch can't hide it. */
export async function LovedBanner({ ratingAvg, ratingCount }: { ratingAvg: number; ratingCount: number }) {
  const t = await getT();
  return (
    // mt-6 so the card never butts up against the highlights box above when the option card (which
    // normally sits between them) is collapsed; margins collapse cleanly when it is expanded.
    <div className="mb-6 mt-6 flex items-center gap-3.5 rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-coral/10 text-coral">
        <IconTrophy width={22} height={22} />
      </span>
      <p className="m-0 text-[14px] leading-snug text-ink/80">
        <b className="text-ink">{t('Loved by travellers')}</b>{' — '}
        {t('rated {avg}★ by {n} guests', { avg: ratingAvg.toFixed(1), n: ratingCount })}
      </p>
    </div>
  );
}

/**
 * The four standard promises that apply to every private sightseeing (vehicle) tour: duration,
 * private vehicle, free child seat, flexible start. Rendered for vehicle-mode tours only. The
 * duration is the tour's own; the rest are fixed operator policy.
 */
export async function SightseeingHighlights({ durationMinutes }: { durationMinutes: number | null }) {
  const t = await getT();
  const duration = durationLabel(durationMinutes);
  const items: Array<{ icon: React.ReactNode; title: string; sub: string }> = [
    {
      icon: <IconClock width={22} height={22} />,
      title: t('Duration & availability'),
      sub: duration ? t('Approx {d} · available daily', { d: duration }) : t('Available daily'),
    },
    {
      icon: <IconUsers width={22} height={22} />,
      title: t('Private tour'),
      sub: t('A vehicle with driver, exclusively for you and your family.'),
    },
    {
      icon: <IconShield width={22} height={22} />,
      title: t('Free child seat'),
      sub: t('Your first child seat is free of charge.'),
    },
    {
      icon: <IconCalendar width={22} height={22} />,
      title: t('Flexible start time'),
      sub: t('Start any time between 7:30 and 9:30 in the morning.'),
    },
  ];
  return (
    <div className="mt-6 grid grid-cols-1 gap-x-5 gap-y-4 rounded-2xl border border-teal/20 bg-teal/[0.04] p-4 sm:grid-cols-2 sm:p-5">
      {items.map((f) => (
        <div key={f.title} className="flex items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-teal shadow-[0_6px_16px_-10px_rgba(10,46,54,0.5)]">
            {f.icon}
          </span>
          <span className="min-w-0">
            <span className="block text-[14.5px] font-bold leading-tight text-ink">{f.title}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{f.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Overview" box: availability, duration and start/return windows. */
export async function Overview({
  durationMinutes,
  extra,
}: {
  durationMinutes: number | null;
  extra: ActivityExtra;
}) {
  const t = await getT();
  const rows: Array<{ label: string; value: string }> = [];
  if (extra.availability) rows.push({ label: t('Availability'), value: extra.availability });
  const duration = durationLabel(durationMinutes);
  if (duration) rows.push({ label: t('Duration'), value: t('About {d}', { d: duration }) });
  if (extra.startWindow) rows.push({ label: t('Start time'), value: extra.startWindow });
  if (extra.returnWindow) rows.push({ label: t('Estimated return'), value: extra.returnWindow });
  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 bg-white p-4">
          <IconCalendar width={20} height={20} className="text-teal" />
          <span>
            <span className="block text-[12px] font-bold uppercase tracking-wide text-ink-muted">
              {r.label}
            </span>
            <span className="block text-[14.5px] font-semibold text-ink">{r.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Itinerary timeline + a real Google Map of the route, GetYourGuide style. */
export async function Itinerary({
  stops,
  meetingPoint,
}: {
  stops: ItineraryStop[];
  meetingPoint?: string | null;
}) {
  if (stops.length === 0) return null;
  const t = await getT();
  const nodes: TimelineNode[] = [
    ...(meetingPoint
      ? [{ title: t('Pickup location'), area: meetingPoint, variant: 'pickup' as const }]
      : []),
    ...stops.map((s) => ({
      title: s.title,
      area: s.area,
      description: s.description,
      tags: s.tags,
      variant: 'main' as const,
    })),
  ];
  // Map: the meeting point as the coral start pin (when set) + the stops as solid "main" pins.
  const mapStops: ItineraryStop[] = meetingPoint
    ? [{ title: meetingPoint } as ItineraryStop, ...stops]
    : stops;
  const mapKinds: StopKind[] = mapStops.map((_, i) => (meetingPoint && i === 0 ? 'start' : 'main'));

  // Render the list + map through RoutedItinerary so both are drawn in ONE proximity-optimised order:
  // the route never zig-zags, and the numbered list, the pins and the route always agree.
  return (
    <RoutedItinerary nodes={nodes} stops={mapStops} kinds={mapKinds} collapseAt={meetingPoint ? 4 : 3} />
  );
}

/** "Includes" — green checks for what's included, muted ✕ for what isn't. */
export function Includes({ inclusions, exclusions }: { inclusions: string[]; exclusions: string[] }) {
  if (inclusions.length === 0 && exclusions.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {inclusions.map((it) => (
          <li key={it} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink/85">
            <IconCheck width={18} height={18} className="mt-0.5 shrink-0 text-teal" />
            {it}
          </li>
        ))}
      </ul>
      {exclusions.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {exclusions.map((ex) => (
            <li key={ex} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-ink-muted">
              <IconX width={18} height={18} className="mt-0.5 shrink-0 text-coral" />
              {ex}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
