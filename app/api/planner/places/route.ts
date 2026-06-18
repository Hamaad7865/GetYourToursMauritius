import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { getServerEnv } from '@/lib/config/env';
import { searchGooglePlaces, placeDetailsByIds } from '@/lib/maps/google-places';

export const runtime = 'edge';

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/places — live place discovery for the AI Road Trip Planner, from Google Places
 * (New). `?q=` free text, `?category=`, `?region=` for browse; `?ids=a,b` resolves specific places
 * (the AI's chosen ids + shareable deep-links). Cached at the edge since places change rarely.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const key = mapsKey();
  if (!key) return jsonOk([]);

  const url = new URL(req.url);
  const ids = url.searchParams.get('ids');
  const places = ids
    ? await placeDetailsByIds(
        ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25),
        key,
      )
    : await searchGooglePlaces(
        {
          query: url.searchParams.get('q') ?? undefined,
          category: url.searchParams.get('category') ?? undefined,
          region: url.searchParams.get('region') ?? undefined,
        },
        key,
      );

  return jsonOk(places, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
