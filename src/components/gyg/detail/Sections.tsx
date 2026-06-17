import type { ActivityExtra, ItineraryStop } from '@/lib/validation/tours';
import { ItineraryTimeline, type TimelineNode } from './ItineraryTimeline';
import { ItineraryMap } from '@/components/maps/ItineraryMap';
import type { StopKind } from '@/components/maps/RouteMap';
import { durationLabel } from '@/lib/catalogue/detail';
import {
  IconBolt,
  IconCalendar,
  IconCheck,
  IconClock,
  IconGlobe,
  IconPin,
  IconShield,
  IconTrophy,
  IconUsers,
  IconWallet,
  IconX,
} from '@/components/ui/icons';

/** Two-column "at a glance" facts grid + a "loved by travellers" banner, GetYourGuide style. */
export function QuickFacts({
  durationMinutes,
  languages,
  pickupAvailable,
  type,
  cancellationPolicy,
  ratingAvg,
  ratingCount,
  startWindow,
}: {
  durationMinutes: number | null;
  languages: string[];
  pickupAvailable: boolean;
  type: 'activity' | 'transport';
  cancellationPolicy: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  startWindow?: string | null;
}) {
  const duration = durationLabel(durationMinutes);
  const facts: Array<{ icon: React.ReactNode; title: string; sub: string }> = [];

  if (cancellationPolicy) {
    facts.push({
      icon: <IconCalendar width={22} height={22} />,
      title: 'Free cancellation',
      sub: cancellationPolicy,
    });
  }
  facts.push({
    icon: <IconWallet width={22} height={22} />,
    title: 'Reserve now & pay later',
    sub: 'Book your spot today and settle up closer to the date.',
  });
  if (duration) {
    facts.push({
      icon: <IconClock width={22} height={22} />,
      title: `Duration ${duration}`,
      sub: startWindow ?? 'Check availability for start times',
    });
  }
  if (languages.length > 0) {
    facts.push({
      icon: <IconGlobe width={22} height={22} />,
      title: 'Live tour guide',
      sub: languages.join(', '),
    });
  }
  facts.push(
    pickupAvailable
      ? {
          icon: <IconPin width={22} height={22} />,
          title: 'Pickup included',
          sub: 'Hotel or port pickup & drop-off',
        }
      : {
          icon: <IconPin width={22} height={22} />,
          title: 'Meeting point',
          sub: 'Shared on your voucher',
        },
  );
  facts.push({
    icon: <IconUsers width={22} height={22} />,
    title: type === 'transport' ? 'Private transfer' : 'Private group',
    sub: 'Only your party — no strangers',
  });
  facts.push({
    icon: <IconBolt width={22} height={22} />,
    title: 'Instant confirmation',
    sub: 'E-voucher sent straight to your inbox',
  });

  const loved = ratingAvg != null && ratingAvg >= 4.5 && ratingCount > 0;

  return (
    <div className="border-t border-ink/10 pt-6">
      {loved && (
        <div className="mb-6 flex items-center gap-3.5 rounded-2xl border border-ink/10 bg-white px-4 py-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-coral/10 text-coral">
            <IconTrophy width={22} height={22} />
          </span>
          <p className="m-0 text-[14px] leading-snug text-ink/80">
            <b className="text-ink">Loved by travellers</b> — rated {ratingAvg.toFixed(1)}&#9733; by{' '}
            {ratingCount} guests
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.title} className="flex items-start gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-ink">
              {f.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-tight text-ink">{f.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{f.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The four standard promises that apply to every private sightseeing (vehicle) tour: duration,
 * private vehicle, free child seat, flexible start. Rendered for vehicle-mode tours only. The
 * duration is the tour's own; the rest are fixed operator policy.
 */
export function SightseeingHighlights({ durationMinutes }: { durationMinutes: number | null }) {
  const duration = durationLabel(durationMinutes);
  const items: Array<{ icon: React.ReactNode; title: string; sub: string }> = [
    {
      icon: <IconClock width={22} height={22} />,
      title: 'Duration & availability',
      sub: duration ? `Approx ${duration} · available daily` : 'Available daily',
    },
    {
      icon: <IconUsers width={22} height={22} />,
      title: 'Private tour',
      sub: 'A vehicle with driver, exclusively for you and your family.',
    },
    {
      icon: <IconShield width={22} height={22} />,
      title: 'Free child seat',
      sub: 'Your first child seat is free of charge.',
    },
    {
      icon: <IconCalendar width={22} height={22} />,
      title: 'Flexible start time',
      sub: 'Start any time between 7:30 and 9:30 in the morning.',
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
export function Overview({
  durationMinutes,
  extra,
}: {
  durationMinutes: number | null;
  extra: ActivityExtra;
}) {
  const rows: Array<{ label: string; value: string }> = [];
  if (extra.availability) rows.push({ label: 'Availability', value: extra.availability });
  const duration = durationLabel(durationMinutes);
  if (duration) rows.push({ label: 'Duration', value: `About ${duration}` });
  if (extra.startWindow) rows.push({ label: 'Start time', value: extra.startWindow });
  if (extra.returnWindow) rows.push({ label: 'Estimated return', value: extra.returnWindow });
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
export function Itinerary({
  stops,
  meetingPoint,
}: {
  stops: ItineraryStop[];
  meetingPoint?: string | null;
}) {
  if (stops.length === 0) return null;
  const nodes: TimelineNode[] = [
    ...(meetingPoint
      ? [{ title: 'Pickup location', area: meetingPoint, variant: 'pickup' as const }]
      : []),
    ...stops.map((s) => ({ title: s.title, area: s.area, tags: s.tags, variant: 'main' as const })),
  ];
  // Map: the meeting point as the coral start pin (when set) + the stops as solid "main" pins.
  const mapStops: ItineraryStop[] = meetingPoint
    ? [{ title: meetingPoint } as ItineraryStop, ...stops]
    : stops;
  const mapKinds: StopKind[] = mapStops.map((_, i) => (meetingPoint && i === 0 ? 'start' : 'main'));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <ItineraryTimeline nodes={nodes} collapseAt={meetingPoint ? 4 : 3} />
      <ItineraryMap stops={mapStops} kinds={mapKinds} />
    </div>
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
