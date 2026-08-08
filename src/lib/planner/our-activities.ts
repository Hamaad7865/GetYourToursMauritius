import type { ServiceContext } from '@/lib/services/context';
import { searchActivities, getActivity } from '@/lib/services/activities';
import { checkAvailability } from '@/lib/services/availability';
import { utcDayKey } from '@/lib/services/day-key';
import {
  regionDistanceBand,
  regionFromCoords,
  REGION_DISTANCE_DEFAULT,
} from '@/lib/services/pricing';
import { searchGooglePlaces } from '@/lib/maps/google-places';
import { cacheGet, cacheSet } from '@/lib/maps/places-cache';
import type { TourSummary } from '@/lib/validation/tours';

/**
 * Belle Mare Tours activities as the planner sees them: every published catalogue activity resolved
 * to ONE representative map point + region, so the trip co-pilot can recommend "things WE run" near a
 * day's route and the map can pin them with branded markers. Facts (title, price, rating) come from
 * the existing catalogue DTOs — no new money math; coords come from the activity row when the admin
 * set them, else its itinerary, else one cached Google text search.
 */
export interface BmtActivity {
  slug: string;
  title: string;
  category: string;
  region: string | null;
  lat: number | null;
  lng: number | null;
  fromPriceEur: number | null;
  pricingMode: string;
  ratingAvg: number | null;
  ratingCount: number;
  heroImageUrl: string | null;
  /** The catalogue's own short description, for the chat's hover preview. */
  summary: string | null;
  /** Hero + up to two more photos, for the same preview. */
  imageUrls: string[];
  durationMinutes: number | null;
  minAdvanceDays: number;
}

/** The planner's own bookable day product — never recommended as "an activity to add". */
const EXCLUDED_SLUGS = new Set(['custom-road-trip']);

// v2: summaries carry lat/lng/region themselves now — the bump orphans v1 lists assembled from the
// old per-activity fallback resolution (itinerary stops / Places title searches), whose points were
// wrong for every activity without admin-set coords.
// v3: entries now carry `summary` + `imageUrls` for the chat's hover preview — a cached v2 list would
// render those cards with no words and no photos, so the bump retires it.
const LIST_CACHE_KEY = 'bmt-activities:v3';
const LIST_TTL_MS = 60 * 60 * 1000; // the assembled list: 1h (prices/ratings drift slowly)
const COORDS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // resolved coords: 30d (places don't move)
const COORDS_MISS_TTL_MS = 6 * 60 * 60 * 1000; // unresolved: 6h, so a flaky lookup retries soon

interface ResolvedCoords {
  lat: number | null;
  lng: number | null;
  region: string | null;
}

/** Injectable lookups so the resolution rules unit-test without Supabase or Google. */
export interface CoordsSources {
  detail: (slug: string) => Promise<{
    lat?: number | null;
    lng?: number | null;
    region?: string | null;
    itinerary?: Array<{ lat?: number; lng?: number }>;
  } | null>;
  searchPlace: (query: string) => Promise<{ lat: number; lng: number } | null>;
}

/**
 * One activity's representative point + region, by precedence:
 *   1. the activity row's own lat/lng (admin-set "Map location");
 *   2. its first detail-itinerary stop that carries coords;
 *   3. a Google Places text search of "title, location, Mauritius".
 * The region prefers the admin-set home region (it drives transport pricing and was hand-checked),
 * falling back to classifying whatever point we resolved. All-null when nothing resolves — the
 * activity stays recommendable as a card but never becomes a marker at a made-up point.
 */
export async function resolveActivityCoords(
  summary: Pick<TourSummary, 'slug' | 'title' | 'location'>,
  sources: CoordsSources,
): Promise<ResolvedCoords> {
  const detail = await sources.detail(summary.slug).catch(() => null);
  const adminRegion = detail?.region ?? null;

  if (typeof detail?.lat === 'number' && typeof detail?.lng === 'number') {
    return {
      lat: detail.lat,
      lng: detail.lng,
      region: adminRegion ?? regionFromCoords(detail.lat, detail.lng),
    };
  }
  const stop = detail?.itinerary?.find(
    (s) => typeof s.lat === 'number' && typeof s.lng === 'number',
  );
  if (stop) {
    return {
      lat: stop.lat!,
      lng: stop.lng!,
      region: adminRegion ?? regionFromCoords(stop.lat!, stop.lng!),
    };
  }
  const query = [summary.title, summary.location, 'Mauritius'].filter(Boolean).join(', ');
  const found = await sources.searchPlace(query).catch(() => null);
  if (found) {
    return {
      lat: found.lat,
      lng: found.lng,
      region: adminRegion ?? regionFromCoords(found.lat, found.lng),
    };
  }
  return { lat: null, lng: null, region: adminRegion };
}

/** The real coord sources: the activity detail RPC + a Places text search (null when keyless). */
function realSources(ctx: ServiceContext, mapsApiKey: string | null): CoordsSources {
  return {
    detail: async (slug) => {
      const d = await getActivity(ctx, slug);
      return { lat: d.lat, lng: d.lng, region: d.region, itinerary: d.extra.itinerary };
    },
    searchPlace: async (query) => {
      if (!mapsApiKey) return null;
      const places = await searchGooglePlaces({ query }, mapsApiKey);
      const first = places[0];
      return first ? { lat: first.lat, lng: first.lng } : null;
    },
  };
}

async function cachedCoords(summary: TourSummary, sources: CoordsSources): Promise<ResolvedCoords> {
  const key = `bmt-coords:v1:${summary.slug}`;
  const hit = await cacheGet<ResolvedCoords>(key);
  if (hit !== undefined) return hit;
  const resolved = await resolveActivityCoords(summary, sources);
  await cacheSet(key, resolved, resolved.lat != null ? COORDS_TTL_MS : COORDS_MISS_TTL_MS);
  return resolved;
}

/**
 * Every published, recommendable activity with its resolved point. Cached (memory + durable) so the
 * browse layer and the AI tool cost ~zero per request; a cold rebuild is one summaries RPC plus the
 * per-activity cached coord lookups.
 */
export async function listBmtActivities(
  ctx: ServiceContext,
  mapsApiKey: string | null,
): Promise<BmtActivity[]> {
  const hit = await cacheGet<BmtActivity[]>(LIST_CACHE_KEY);
  if (hit !== undefined) return hit;

  const { items } = await searchActivities(ctx, { page: 1, pageSize: 100 });
  // Transport products (transfers) and the planner's own day product aren't "things to do".
  const recommendable = items.filter((i) => i.type === 'activity' && !EXCLUDED_SLUGS.has(i.slug));
  const sources = realSources(ctx, mapsApiKey);
  const out: BmtActivity[] = [];
  for (const s of recommendable) {
    // The summary itself carries the admin-set map point + region now, so the common case costs
    // nothing beyond the one summaries RPC above. Only an activity WITHOUT a stored point (e.g. a
    // freshly created one the admin hasn't placed yet) falls back to the per-activity resolution —
    // sequential on purpose: that path is rare and this avoids a burst of parallel detail RPCs +
    // Places calls against shared pool limits.
    const coords: ResolvedCoords =
      typeof s.lat === 'number' && typeof s.lng === 'number'
        ? { lat: s.lat, lng: s.lng, region: s.region ?? regionFromCoords(s.lat, s.lng) }
        : await cachedCoords(s, sources);
    out.push({
      slug: s.slug,
      title: s.title,
      category: s.category,
      region: coords.region,
      lat: coords.lat,
      lng: coords.lng,
      fromPriceEur: s.fromPriceEur,
      pricingMode: s.pricingMode,
      ratingAvg: s.ratingAvg,
      ratingCount: s.ratingCount,
      heroImageUrl: s.heroImage?.url ?? null,
      // The chat's hover preview shows what a tour actually is — its own words and its own photos,
      // not just a price. Three images is what the card has room for.
      summary: s.summary,
      imageUrls: [s.heroImage?.url, ...s.images.map((i) => i.url)]
        .filter((u): u is string => Boolean(u))
        .filter((u, i, all) => all.indexOf(u) === i)
        .slice(0, 3),
      durationMinutes: s.durationMinutes,
      minAdvanceDays: s.minAdvanceDays,
    });
  }
  await cacheSet(LIST_CACHE_KEY, out, LIST_TTL_MS);
  return out;
}

/**
 * A recommendation candidate: the activity plus its real bookability on the requested date.
 *
 * `date`/`seatsLeft` are BOTH null when the lookup ran without a date — the visitor asked about an
 * activity before choosing when to go (tapping a map pin does exactly that). Availability is a fact
 * about a date, so with no date there is none to report: the caller must ask which day rather than
 * assume one. Nulls together, never one without the other.
 */
export interface BmtCandidate extends BmtActivity {
  date: string | null;
  seatsLeft: number | null;
}

/** How many availability lookups one search may fan out to (each is a DB RPC). */
export const MAX_AVAILABILITY_CHECKS = 6;

/**
 * Rank the catalogue for one trip day (pure): keep activities whose region is not `far` from the
 * day's region (matching the day-planner's own coherence rule) and that match an optional category
 * and/or free-text title (`q` — how the agent grounds "tell me about <this exact activity>", e.g.
 * after a map-pin click), best-rated first, capped at {@link MAX_AVAILABILITY_CHECKS} so the
 * availability fan-out is bounded. A `q` match deliberately ignores the region rule: the visitor
 * asked about THAT activity, so answering about it is never wrong, wherever their day is.
 */
export function rankBmtForDay(
  all: BmtActivity[],
  args: { region?: string | null; category?: string | null; q?: string | null },
): BmtActivity[] {
  const wantCat = args.category?.trim().toLowerCase() || null;
  const wantQ = args.q?.trim().toLowerCase() || null;
  return all
    .filter(
      (a) =>
        wantQ ||
        !args.region ||
        regionDistanceBand(a.region, args.region, REGION_DISTANCE_DEFAULT) !== 'far',
    )
    .filter((a) => !wantCat || a.category.toLowerCase().includes(wantCat))
    .filter((a) => !wantQ || a.title.toLowerCase().includes(wantQ))
    .sort((a, b) => (b.ratingAvg ?? 0) - (a.ratingAvg ?? 0) || b.ratingCount - a.ratingCount)
    .slice(0, MAX_AVAILABILITY_CHECKS);
}

/**
 * Availability-checked candidates for one trip day: {@link rankBmtForDay}'s top candidates, then REAL
 * availability confirmed for the date. Only activities with open seats on that exact day come back —
 * a recommendation can never dead-end.
 *
 * A null `date` means the visitor has not chosen one yet: the catalogue facts (price, duration,
 * rating) come back unchecked, with `date`/`seatsLeft` null. That is deliberately NOT the same as
 * probing some default day — quoting seats for a date nobody picked reads as a decision already
 * taken, and the honest answer is to describe the activity and ask when they want to go.
 */
export async function searchBmtActivitiesForDay(
  ctx: ServiceContext,
  args: {
    date: string | null;
    region?: string | null;
    category?: string | null;
    q?: string | null;
  },
  mapsApiKey: string | null,
): Promise<BmtCandidate[]> {
  const all = await listBmtActivities(ctx, mapsApiKey);
  const filtered = rankBmtForDay(all, args);
  const date = args.date;
  if (!date) return filtered.map((a) => ({ ...a, date: null, seatsLeft: null }));

  const checked = await Promise.all(
    filtered.map(async (a): Promise<BmtCandidate | null> => {
      try {
        const slots = await checkAvailability(ctx, { slug: a.slug, from: date, to: date });
        const open = slots.filter((s) => utcDayKey(s.startsAt) === date && s.seatsLeft > 0);
        if (!open.length) return null;
        const seatsLeft = Math.max(...open.map((s) => s.seatsLeft));
        return { ...a, date, seatsLeft };
      } catch {
        return null; // availability unknown → don't recommend (never a dead end)
      }
    }),
  );
  return checked.filter((c): c is BmtCandidate => c !== null);
}
