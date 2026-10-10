import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { visitorLocality } from '@/lib/geo/visitor-country';

export const runtime = 'edge';

/**
 * GET /api/planner/locality — whether the assistant may offer "use my current location".
 *
 * The planner page used to pass this down as a server prop. The assistant now opens on every page,
 * and the homepage is edge-cached with `Vary: Cookie` only — so the answer cannot be rendered into
 * page HTML without one visitor's country being served to the next. It is asked for here instead,
 * once, when the assistant first opens. Only a boolean leaves the server, never the country.
 */
export const GET = apiHandler(async () => {
  const locality = await visitorLocality();
  return jsonOk(
    { mayUseDeviceLocation: locality !== 'abroad' },
    // Per-visitor by construction: it must never be stored by a shared cache.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
