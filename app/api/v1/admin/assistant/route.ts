import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { buildServiceContext } from '@/lib/http/context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import {
  assistantGrants,
  buildRecordLookups,
  type RefLookupClient,
} from '@/lib/http/assistant-lookups';
import {
  runAdminAssistant,
  type AssistantDeparture,
  type AssistantPort,
  type AssistantPricing,
  type AssistantTour,
} from '@/lib/services/admin-assistant';
import { searchActivities, getActivity } from '@/lib/services/activities';
import { listRentalVehicles } from '@/lib/services/rental';
import { ForbiddenError } from '@/lib/services/errors';
import { resolvePlaceByText } from '@/lib/maps/google-places';
import { getServerEnv } from '@/lib/config/env';
import { catalogueLineRefusal } from '@/components/admin/quotes/state';
import {
  transportFareMinor,
  sightseeingQuote,
  REGION_DISTANCE_DEFAULT,
  TRANSPORT_BANDS_DEFAULT,
  type RegionDistanceMap,
  type TransportBandFare,
  type TransportBandPricing,
  type ZoneBand,
} from '@/lib/services/pricing';
import {
  adminAssistantRequestSchema,
  type AdminAssistantResponse,
} from '@/lib/validation/admin-assistant';

export const runtime = 'edge';

/**
 * POST /api/v1/admin/assistant — the back-office assistant, reachable from every admin screen.
 *
 * The browser sends the visible thread plus where the operator is; this grounds a reply with
 * READ-ONLY tools over our own data and may return PROPOSED ACTIONS. Nothing is written here —
 * the panel applies an action in the browser, under the operator's own session, only when they
 * press Apply. See `runAdminAssistant` for why that split is the security boundary.
 *
 * THE GATE is the AI assistant section (`section.assistant`), read by `loadCallerAccess`:
 * `requireUser(req).role` is the JWT's Postgres selector, never the business role, so the caller's
 * role and permissions come from `profiles` + `team_roles` through the service-role client. A
 * content-only account never holds it (replies surface guests' names and money). Holding it does not
 * entitle a role to PROPOSE tour changes or quote drafts, though: those tools are only offered to the
 * model with `section.tours` / `section.quotes` (see `AssistantGrants`).
 * Rate-limited before the gate because every call runs a model.
 */

/** The embedded-relation select, typed by hand exactly as quote-catalogue.ts types it. */
interface OptionWithPrices {
  id: string;
  name: string;
  private_base_minor: number | null;
  activity_option_prices: Array<{ label: string; amount_minor: number; position: number }> | null;
}

/** A jsonb/text[] column as a clean string list — the content columns are stored as arrays. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Region a free-typed hotel resolves to, best effort — the AI decides no geography. */
async function hotelRegion(hotel: string | undefined): Promise<string | null> {
  const query = hotel?.trim();
  if (!query) return null;
  const env = getServerEnv();
  const key = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
  if (!key) return null;
  try {
    const place = await resolvePlaceByText(query, key);
    return place?.region ?? null;
  } catch {
    return null;
  }
}

export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'admin_assistant', 20, 60);

  const user = await requireUser(req);
  const sb = createServiceRoleClient();
  const access = await loadCallerAccess(sb as unknown as AccessClient, user.id);
  if (!can(access, 'section.assistant')) {
    throw new ForbiddenError("Your role doesn't include the AI assistant — ask the owner.");
  }

  const body = await parseJsonBody(req, adminAssistantRequestSchema);
  const ctx = buildServiceContext(req);

  // The catalogue list backs the search tool and slug→id resolution; fetched once per request.
  const cataloguePromise = searchActivities(ctx, { page: 1, pageSize: 100 }).then((page) =>
    page.items.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      category: a.category,
      region: a.region ?? null,
      pricingMode: a.pricingMode,
      // Carried so a price question is answerable from a plain search. Without it the assistant knew
      // a tour existed but not what it cost, and answered anyway.
      fromPriceEur: a.fromPriceEur,
    })),
  );

  /** The transport fare config, read like the quote drawer reads it: DB rows over seed defaults. */
  async function loadTransport(): Promise<{
    bands: TransportBandPricing;
    distances: RegionDistanceMap;
  }> {
    const bands: TransportBandPricing = {
      same: { ...TRANSPORT_BANDS_DEFAULT.same },
      near: { ...TRANSPORT_BANDS_DEFAULT.near },
      far: { ...TRANSPORT_BANDS_DEFAULT.far },
    };
    const distances: RegionDistanceMap = { ...REGION_DISTANCE_DEFAULT };
    const [bandsRes, distRes] = await Promise.all([
      sb
        .from('transport_band_pricing')
        .select('band, sedan_minor, suv_minor, family_minor, van_minor, coaster_minor'),
      sb.from('region_zone_distance').select('region_a, region_b, band'),
    ]);
    if (!bandsRes.error && bandsRes.data) {
      for (const row of bandsRes.data) {
        const band = row.band as ZoneBand;
        if (band === 'same' || band === 'near' || band === 'far') {
          const fare: TransportBandFare = {
            sedanMinor: row.sedan_minor,
            suvMinor: row.suv_minor,
            familyMinor: row.family_minor,
            vanMinor: row.van_minor,
            coasterMinor: row.coaster_minor,
          };
          bands[band] = fare;
        }
      }
    }
    if (!distRes.error && distRes.data) {
      for (const row of distRes.data) {
        if (row.band !== 'near' && row.band !== 'far') continue;
        const [lo, hi] =
          row.region_a < row.region_b ? [row.region_a, row.region_b] : [row.region_b, row.region_a];
        distances[`${lo}|${hi}`] = row.band;
      }
    }
    return { bands, distances };
  }

  const port: AssistantPort = {
    listCatalogue: () =>
      cataloguePromise.then((items) =>
        items.map(({ slug, title, category, region, pricingMode, fromPriceEur }) => ({
          slug,
          title,
          category,
          region,
          pricingMode,
          fromPriceEur,
        })),
      ),

    /**
     * A tour's real prices for a party, no date needed.
     *
     * Vehicle-mode tours are priced by `sightseeingQuote` — the same function the booking widget and
     * the SQL `create_booking` mirror — over the activity's OWN `vehiclePricing`. It deliberately
     * does NOT fall back to `SIGHTSEEING_DEFAULT` when that config is missing: those defaults are a
     * stale seed (Sedan €70 against a configured €90), and quoting a plausible wrong number to an
     * operator who will repeat it to a guest is worse than admitting the gap.
     */
    tourPricing: async (slug, guests): Promise<AssistantPricing | null> => {
      const key = slug.trim();
      const summary = (await cataloguePromise).find((a) => a.slug === key);
      if (!summary) return null;
      const base: AssistantPricing = {
        slug: summary.slug,
        title: summary.title,
        pricingMode: summary.pricingMode,
        fromPriceEur: summary.fromPriceEur,
      };

      const detail = await getActivity(ctx, key).catch(() => null);
      if (!detail) return { ...base, unavailable: 'Could not load this tour to price it.' };

      if (summary.pricingMode === 'vehicle') {
        const cfg = detail.vehiclePricing;
        if (!cfg) {
          return {
            ...base,
            unavailable:
              'This sightseeing tour has no vehicle pricing configured — set it in admin → Pricing.',
          };
        }
        try {
          const quote = sightseeingQuote(guests, false, cfg);
          return {
            ...base,
            vehicle: {
              guests,
              vehicle: quote.vehicle,
              totalEur: quote.totalEur,
              table: {
                'Sedan 1-4': cfg.sedanEur,
                'SUV 1-4': cfg.suvEur,
                'Family car 5-6': cfg.familyEur,
                'Van 7-14': cfg.vanEur,
                'Coaster 15-25': cfg.coasterEur,
              },
            },
          };
        } catch {
          return { ...base, unavailable: `A party of ${guests} is outside this tour's vehicles.` };
        }
      }

      return {
        ...base,
        options: detail.options.map((o) => ({
          name: o.name,
          privateBaseEur: o.privateBaseEur ?? null,
          tiers: o.prices.map((p) => ({ label: p.label, eur: p.amountEur })),
        })),
      };
    },

    // Content columns straight off the row: this is what "copy the highlights from X" reads, and
    // what the operator's browser will write back through the tested activity-write path.
    readTour: async (slug): Promise<AssistantTour | null> => {
      const { data } = await sb
        .from('activities')
        .select(
          'id, slug, title, status, category, location, summary, description, highlights, inclusions, exclusions, extra',
        )
        .eq('slug', slug.trim())
        .maybeSingle();
      if (!data) return null;
      // whatToBring / importantInfo are `extra` keys, not columns (see buildExtra in activity-write).
      const extra = (data.extra ?? {}) as Record<string, unknown>;
      return {
        id: data.id,
        slug: data.slug,
        title: data.title ?? '',
        status: data.status ?? 'draft',
        category: data.category ?? '',
        location: data.location ?? '',
        summary: data.summary ?? '',
        description: data.description ?? '',
        highlights: stringList(data.highlights),
        inclusions: stringList(data.inclusions),
        exclusions: stringList(data.exclusions),
        whatToBring: stringList(extra.whatToBring),
        importantInfo: stringList(extra.importantInfo),
      };
    },

    activityDepartures: async (slug, day) => {
      const activity = (await cataloguePromise).find((a) => a.slug === slug);
      if (!activity) return null;
      const { data: options } = await sb
        .from('activity_options')
        .select(
          'id, name, private_base_minor, activity_option_prices(label, amount_minor, position)',
        )
        .eq('activity_id', activity.id)
        .order('position', { ascending: true })
        .returns<OptionWithPrices[]>();
      const byOption = new Map((options ?? []).map((option) => [option.id, option]));
      if (byOption.size === 0) return [];
      const from = new Date(`${day}T00:00:00.000+04:00`).toISOString();
      const to = new Date(`${day}T24:00:00.000+04:00`).toISOString();
      const { data: occurrences } = await sb
        .from('session_occurrences')
        .select('id, activity_option_id, starts_at, status')
        .in('activity_option_id', [...byOption.keys()])
        .eq('status', 'open')
        .gte('starts_at', from)
        .lt('starts_at', to)
        .order('starts_at', { ascending: true });
      return (occurrences ?? []).flatMap((occurrence): AssistantDeparture[] => {
        const option = byOption.get(occurrence.activity_option_id);
        if (!option) return [];
        const tiers = [...(option.activity_option_prices ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((price) => ({ label: price.label, eur: price.amount_minor / 100 }));
        return [
          {
            optionName: option.name,
            // Mauritius local time — the raw ISO instant is UTC, and a model handed "T08:00:00Z"
            // faithfully tells the operator the 12:00 cruise leaves at 08:00.
            startsAt: new Date(occurrence.starts_at).toLocaleString('en-GB', {
              timeZone: 'Indian/Mauritius',
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
            tiers,
            refusal: catalogueLineRefusal({
              pricingMode: activity.pricingMode,
              isPrivate: option.private_base_minor != null,
              priceCount: tiers.length,
            }),
          },
        ];
      });
    },

    transferFare: async ({ activitySlug, guests, hotel, pickupRegion }) => {
      const activity = (await cataloguePromise).find((a) => a.slug === activitySlug);
      const activityRegion = activity?.region ?? null;
      const pickup = pickupRegion?.trim() || (await hotelRegion(hotel));
      if (!pickup || !activityRegion) return null;
      const { bands, distances } = await loadTransport();
      const fareMinor = transportFareMinor(pickup, activityRegion, guests, false, bands, distances);
      return { pickupRegion: pickup, activityRegion, roundTripEur: fareMinor / 100 };
    },

    // Guest names, emails and amounts via the service-role client — so only for callers whose role holds
    // Bookings / Quotes (see buildRecordLookups); anyone else gets the usual "not found".
    ...buildRecordLookups(sb as unknown as RefLookupClient, access),

    rentalFleet: async () => {
      const fleet = await listRentalVehicles(ctx);
      return fleet.map((v) => ({
        slug: v.slug,
        name: v.name,
        category: v.category,
        transmission: v.transmission ?? null,
        dailyRateEur: v.dailyRateEur,
      }));
    },
  };

  const { available, reply, actions } = await runAdminAssistant(ctx, port, {
    messages: body.messages,
    page: body.page,
    // The assistant section alone does not entitle a role to the tour-writing or quote-drafting tools:
    // the browser applies those proposals as the member, so they are only offered with the section.
    grants: assistantGrants(access),
  });

  const response: AdminAssistantResponse = { available, reply, actions };
  return jsonOk(response);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
