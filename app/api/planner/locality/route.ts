import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { devLocalityOverride, visitorLocality } from '@/lib/geo/visitor-country';

export const runtime = 'edge';

/**
 * GET /api/planner/locality — where this visitor is browsing from, reduced to two yes/no answers:
 *   * mayUseDeviceLocation — whether the assistant may offer "use my current location" (unknown counts
 *     as yes; see visitorLocality);
 *   * onIsland — whether the homepage should lead with tours still free tomorrow (only a CONFIRMED
 *     Mauritius counts).
 *
 * The homepage is edge-cached and identical for everyone, so neither can be rendered into page HTML
 * without one visitor's answer being served to the next. It is asked for here instead. The country
 * itself never leaves the server.
 */
export const GET = apiHandler(async (req) => {
  const override = devLocalityOverride(
    new URL(req.url).searchParams.get('as'),
    process.env.NODE_ENV,
  );
  const locality = override ?? (await visitorLocality());
  return jsonOk(
    { mayUseDeviceLocation: locality !== 'abroad', onIsland: locality === 'mauritius' },
    // Per-visitor by construction: it must never be stored by a shared cache.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
