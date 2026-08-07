import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { buildServiceContext } from '@/lib/http/context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { extractQuoteFromEmail } from '@/lib/services/quote-extraction';
import { searchActivities } from '@/lib/services/activities';
import { listRentalVehicles } from '@/lib/services/rental';
import { ForbiddenError } from '@/lib/services/errors';
import { resolvePlaceByText } from '@/lib/maps/google-places';
import { getServerEnv } from '@/lib/config/env';
import type { DraftFromEmailResponse } from '@/lib/validation/quote-extraction';

export const runtime = 'edge';

/**
 * POST /api/v1/admin/quotes/draft-from-email — the AI email→draft entry point (plan Task A4).
 *
 * The operator pastes a customer enquiry email; this reads it into a structured request and returns it,
 * plus the catalogue candidates, for the BROWSER to compose into a draft quote the operator reviews and
 * prices. Nothing here writes a quote, and nothing is auto-sent — that is the whole guardrail.
 *
 * WHY EXTRACTION IS SERVER-SIDE AND THE DRAFT IS NOT. `extractQuoteFromEmail` calls Gemini, whose API
 * key is server-only — so the model has to run here. The draft assembly (`draftFromExtraction`) needs
 * `loadActivityDepartures`, which is a BROWSER-only catalogue read (getBrowserSupabase, no server
 * equivalent exists), so it runs in the editor with the operator's own authenticated session. This
 * route bridges the two: it returns the extraction AND the candidate lists — fetched here because
 * `searchActivities` carries the slug + id the browser picker list (loadQuotableActivities) omits, and
 * the extraction's `matchedSlug` is looked up in exactly that list.
 *
 * THE STAFF GATE mirrors app/api/v1/admin/quotes/send/route.ts exactly: `requireUser(req).role` is the
 * JWT's Postgres selector ('authenticated'), never the business role, so the role is read from
 * `profiles` through the service-role client. 'seo' is NOT admitted — a drafted quote carries the
 * guest's name/email and shapes an offer we will price and send. It is rate-limited before the gate,
 * like every other admin route, because each call runs a model.
 *
 * THE AI-UNAVAILABLE PATH. With no GOOGLE_GENERATIVE_AI_API_KEY the provider is the stub and
 * `extractQuoteFromEmail` returns `{ available: false }` BEFORE any catalogue read — the route hands
 * back `{ available: false }` and the editor tells the operator to add lines manually. The feature is
 * fully usable by hand; it lights up when the Gemini billing is restored, with no code change.
 */

const bodySchema = z.object({
  // A generous cap: a long enquiry with an itinerary pasted in, but not an unbounded upload.
  email: z.string().min(1, 'Paste the enquiry email first.').max(20000),
});

/** The business roles allowed to draft a quote. See the staff-gate note above re 'seo'. */
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
 * The region a pickup hotel resolves to, for pricing transport add-ons in the browser draft (Phase 2).
 * The AI decides no geography — it only reports the hotel as free text — so this is resolved here, on
 * the server, with the Maps key, via one cached Places Text Search. Best effort: no hotel, no key, or a
 * geocode that finds nothing all yield null, and the draft simply carries no auto-priced transfers.
 */
async function resolvePickupRegion(hotel: string | null | undefined): Promise<string | null> {
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

/** The signed-in caller's business role, read through the SERVICE-ROLE client (profiles is RLS-gated). */
async function callerRole(db: RoleClient, userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'profile read failed'));
  const role = data?.role;
  return typeof role === 'string' ? role : null;
}

export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'admin_quote_draft', 20, 60);

  const user = await requireUser(req);
  const roleDb = createServiceRoleClient() as unknown as RoleClient;
  const role = await callerRole(roleDb, user.id);
  if (!role || !SENDING_ROLES.has(role)) {
    throw new ForbiddenError('Staff only');
  }

  const { email } = await parseJsonBody(req, bodySchema);
  const ctx = buildServiceContext(req);

  const { available, extraction } = await extractQuoteFromEmail(ctx, email);
  if (!available || !extraction) {
    const body: DraftFromEmailResponse = {
      available: false,
      extraction: null,
      candidates: null,
      pickupRegion: null,
    };
    return jsonOk(body);
  }

  // The candidate lists the browser draft resolves matched slugs against. searchActivities carries the
  // slug AND the id (the id feeds the browser's loadActivityDepartures); the picker's own list omits the
  // slug, so this server list is the one the extraction was matched against. The pickup region is
  // resolved alongside, from the hotel the AI read out of the email, so transfers can be auto-priced.
  const [page, fleet, pickupRegion] = await Promise.all([
    searchActivities(ctx, { page: 1, pageSize: 100 }),
    listRentalVehicles(ctx),
    resolvePickupRegion(extraction.pickupHotel),
  ]);

  const body: DraftFromEmailResponse = {
    available: true,
    extraction,
    candidates: {
      activities: page.items.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        region: a.region ?? null,
        pricingMode: a.pricingMode,
      })),
      rentals: fleet.map((v) => ({ slug: v.slug, name: v.name, dailyRateEur: v.dailyRateEur })),
    },
    pickupRegion,
  };
  return jsonOk(body);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
