import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { buildServiceContext } from '@/lib/http/context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import {
  runQuoteAssistant,
  type AssistantDeparture,
  type AssistantPort,
} from '@/lib/services/quote-assistant';
import { searchActivities } from '@/lib/services/activities';
import { listRentalVehicles } from '@/lib/services/rental';
import { ForbiddenError } from '@/lib/services/errors';
import { resolvePlaceByText } from '@/lib/maps/google-places';
import { getServerEnv } from '@/lib/config/env';
import { catalogueLineRefusal } from '@/components/admin/quotes/state';
import {
  transportFareMinor,
  REGION_DISTANCE_DEFAULT,
  TRANSPORT_BANDS_DEFAULT,
  type RegionDistanceMap,
  type TransportBandFare,
  type TransportBandPricing,
  type ZoneBand,
} from '@/lib/services/pricing';
import {
  quoteAssistantRequestSchema,
  type QuoteAssistantResponse,
} from '@/lib/validation/quote-assistant';

export const runtime = 'edge';

/**
 * POST /api/v1/admin/quotes/assistant — the staff Gemini chat.
 *
 * The browser sends the visible thread; this grounds a reply with read-only tools over our own
 * data (catalogue, departures + tiers, transfer fares, bookings, quotes, the fleet) and returns
 * it. No state is held here, nothing is written, and the model key never leaves the server —
 * see `runQuoteAssistant` for the guardrails.
 *
 * THE STAFF GATE is byte-for-byte the draft-from-email one: `requireUser(req).role` is the JWT's
 * Postgres selector, never the business role, so the role is read from `profiles` through the
 * service-role client; 'seo' is NOT admitted (the chat surfaces guests' names, emails and money).
 * Rate-limited before the gate because every call runs a model.
 *
 * THE READS run through the service-role client AFTER the gate — the same tables the operator's
 * own session already reads in this screen (the RLS staff policies grant them); service-role here
 * only spares this edge route a second user-scoped PostgREST client.
 */

const SENDING_ROLES = new Set(['admin', 'staff']);

type Row = Record<string, unknown>;

interface ReadBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): ReadBuilder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface RoleClient {
  from(table: 'profiles'): { select(columns: string): ReadBuilder };
}

/**
 * The generated Database types lag the schema (no `quotes` table, older `bookings` columns), so the
 * ref lookups go through this narrow cast — the same move the send route makes with its SendClient.
 */
interface RefLookupClient {
  from(table: 'bookings' | 'quotes'): {
    select(columns: string): {
      eq(
        column: 'ref',
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }> };
    };
  };
}

/** A minor-unit column as euros, tolerating null/undefined and non-numeric junk. */
function eurOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : null;
}

/** The embedded-relation select, typed by hand exactly as quote-catalogue.ts types it. */
interface OptionWithPrices {
  id: string;
  name: string;
  private_base_minor: number | null;
  activity_option_prices: Array<{ label: string; amount_minor: number; position: number }> | null;
}

/** The signed-in caller's business role, read through the SERVICE-ROLE client (profiles is RLS-gated). */
async function callerRole(db: RoleClient, userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'profile read failed'));
  const role = data?.role;
  return typeof role === 'string' ? role : null;
}

/** Region a free-typed hotel resolves to, best effort — the AI decides no geography (Phase 2 rule). */
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
  await rateLimit(req, 'admin_quote_assistant', 20, 60);

  const user = await requireUser(req);
  const sb = createServiceRoleClient();
  const role = await callerRole(sb as unknown as RoleClient, user.id);
  if (!role || !SENDING_ROLES.has(role)) {
    throw new ForbiddenError('Staff only');
  }

  const body = await parseJsonBody(req, quoteAssistantRequestSchema);
  const ctx = buildServiceContext(req);

  // The catalogue list backs BOTH the search tool and slug→id resolution; fetched once per request.
  const cataloguePromise = searchActivities(ctx, { page: 1, pageSize: 100 }).then((page) =>
    page.items.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      category: a.category,
      region: a.region ?? null,
      pricingMode: a.pricingMode,
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
        items.map(({ slug, title, category, region, pricingMode }) => ({
          slug,
          title,
          category,
          region,
          pricingMode,
        })),
      ),

    // The same day-window + open-status + tier reads the browser's loadActivityDepartures does,
    // through the service-role client (this is an edge route; the browser client cannot run here).
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
            // Presented in Mauritius local time — the raw ISO instant is UTC, and a model handed
            // "T08:00:00Z" faithfully tells the operator the 12:00 cruise leaves at 08:00.
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

    lookupBooking: async (ref) => {
      const { data } = await (sb as unknown as RefLookupClient)
        .from('bookings')
        .select(
          'ref, status, payment_state, customer_name, customer_email, currency, total_minor, deposit_minor, balance_due_minor, pickup_location, created_at',
        )
        .eq('ref', ref.trim().toUpperCase())
        .maybeSingle();
      if (!data) return null;
      const { total_minor, deposit_minor, balance_due_minor, ...rest } = data;
      return {
        ...rest,
        totalEur: eurOf(total_minor),
        depositEur: eurOf(deposit_minor),
        balanceDueEur: eurOf(balance_due_minor),
      };
    },

    lookupQuote: async (ref) => {
      const { data } = await (sb as unknown as RefLookupClient)
        .from('quotes')
        .select(
          'ref, status, customer_name, customer_email, currency, total_minor, valid_until, deposit_bps, sent_at, converted_at, created_at',
        )
        .eq('ref', ref.trim().toUpperCase())
        .maybeSingle();
      if (!data) return null;
      const { total_minor, ...rest } = data;
      return { ...rest, totalEur: eurOf(total_minor) };
    },

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

  const { available, reply } = await runQuoteAssistant(ctx, port, {
    messages: body.messages,
    quoteContext: body.quoteContext,
  });

  const response: QuoteAssistantResponse = { available, reply };
  return jsonOk(response);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
