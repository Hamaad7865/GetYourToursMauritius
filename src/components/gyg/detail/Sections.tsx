import type { ActivityExtra, ItineraryStop } from '@/lib/validation/tours';
import { RouteMap } from './RouteMap';
import { durationLabel } from '@/lib/catalogue/detail';
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconGlobe,
  IconPin,
  IconUsers,
  IconX,
} from '@/components/ui/icons';

/** Row of at-a-glance facts under the title, GetYourGuide style. */
export function QuickFacts({
  durationMinutes,
  languages,
  pickupAvailable,
  type,
}: {
  durationMinutes: number | null;
  languages: string[];
  pickupAvailable: boolean;
  type: 'activity' | 'transport';
}) {
  const facts: Array<{ icon: React.ReactNode; label: string; sub: string }> = [];
  const duration = durationLabel(durationMinutes);
  if (duration) facts.push({ icon: <IconClock width={22} height={22} />, label: 'Duration', sub: duration });
  if (languages.length > 0)
    facts.push({
      icon: <IconGlobe width={22} height={22} />,
      label: 'Live tour guide',
      sub: languages.join(', '),
    });
  facts.push(
    pickupAvailable
      ? { icon: <IconPin width={22} height={22} />, label: 'Pickup included', sub: 'Hotel / port pickup' }
      : { icon: <IconPin width={22} height={22} />, label: 'Meeting point', sub: 'On your voucher' },
  );
  facts.push({
    icon: <IconUsers width={22} height={22} />,
    label: type === 'transport' ? 'Private transfer' : 'Private group',
    sub: 'Only your party',
  });

  return (
    <div className="grid grid-cols-2 gap-4 border-y border-ink/10 py-5 sm:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="flex items-start gap-3">
          <span className="mt-0.5 text-teal">{f.icon}</span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-ink">{f.label}</span>
            <span className="block text-[12.5px] text-ink-muted">{f.sub}</span>
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

function placeQuery(s: string): string {
  return encodeURIComponent(`${s}, Mauritius`);
}

/** Builds a Google Maps embed URL: the route through every stop when a Maps Embed API
 *  key is configured, otherwise a keyless region map (no key required). */
function mapEmbedSrc(stops: ItineraryStop[]): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (key && stops.length >= 2) {
    const origin = placeQuery(stops[0]!.title);
    const destination = placeQuery(stops[stops.length - 1]!.title);
    const waypoints = stops
      .slice(1, -1)
      .map((s) => placeQuery(s.title))
      .join('|');
    return `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${origin}&destination=${destination}${
      waypoints ? `&waypoints=${waypoints}` : ''
    }&mode=driving`;
  }
  if (key) {
    return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${placeQuery(stops[0]!.title)}&zoom=10`;
  }
  const center = stops[Math.floor(stops.length / 2)]!.title;
  return `https://maps.google.com/maps?q=${placeQuery(center)}&z=10&output=embed`;
}

/** Itinerary timeline + a real embedded Google Map, GetYourGuide style. */
export function Itinerary({
  stops,
  meetingPoint,
}: {
  stops: ItineraryStop[];
  meetingPoint?: string | null;
}) {
  if (stops.length === 0) return null;
  const hasCoords = stops.some((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
  const nodes = [
    ...(meetingPoint
      ? [{ title: 'Pickup location', area: meetingPoint, pickup: true } as const]
      : []),
    ...stops.map((s) => ({ ...s, pickup: false as const })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <ol className="relative m-0 list-none p-0">
        {nodes.map((stop, i) => (
          <li key={`${stop.title}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
            {i < nodes.length - 1 && (
              <span className="absolute left-[7px] top-6 h-full w-0.5 bg-teal/25" aria-hidden />
            )}
            <span
              className={`z-[1] mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-[3px] ${
                stop.pickup ? 'border-coral bg-coral' : 'border-teal bg-white'
              }`}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-ink">{stop.title}</div>
              {stop.area && <div className="text-[13px] text-ink-muted">{stop.area}</div>}
              {'tags' in stop && stop.tags && stop.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {stop.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-teal/8 px-2 py-0.5 text-[11.5px] font-semibold text-teal"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div>
        {hasCoords ? (
          <RouteMap stops={stops} />
        ) : (
          <iframe
            src={mapEmbedSrc(stops)}
            title="Tour route map"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            className="h-[300px] w-full rounded-2xl border border-ink/10 lg:h-[360px]"
          />
        )}
        <div className="mt-2 flex items-center gap-4 text-[12px] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-coral" /> Start / main stop
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-ink" /> Tour stop
          </span>
        </div>
      </div>
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
