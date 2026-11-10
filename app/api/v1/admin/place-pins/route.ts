import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import { ForbiddenError } from '@/lib/services/errors';
import { findPins } from '@/lib/maps/osm-pin';
import { placePinsRequestSchema, type PlacePinsResponse } from '@/lib/validation/place-pins';

export const runtime = 'edge';

/**
 * POST /api/v1/admin/place-pins — map pins for itinerary stop names, so a tour saved in /admin stores
 * its stops' coordinates and its public page never pays Google to geocode them per visitor.
 *
 * Stored table first, then OpenStreetMap Nominatim (storable under ODbL; Google geocodes are not).
 * Server-side because Nominatim's policy wants an identifying User-Agent, which a browser cannot set,
 * and so the admin CSP needs no new origin. Needs the Tours section: it is only ever called by the
 * tour editor's save. It writes nothing — the editor stores what comes back with the tour.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'admin_place_pins', 30, 60);

  const user = await requireUser(req);
  const roleDb = createServiceRoleClient();
  const access = await loadCallerAccess(roleDb as unknown as AccessClient, user.id);
  if (!can(access, 'section.tours')) {
    throw new ForbiddenError("Your role doesn't include Tours — ask the owner.");
  }

  const { names } = await parseJsonBody(req, placePinsRequestSchema);
  const body: PlacePinsResponse = { pins: await findPins(names) };
  return jsonOk(body);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
