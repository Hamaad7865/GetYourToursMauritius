import { getServerEnv } from '@/lib/config/env';

export const runtime = 'edge';

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/photo?ref=places/<id>/photos/<ref> — proxies a Google Places photo so the API key
 * stays server-side. Streams the image bytes back with a long cache so each photo is billed once and
 * then served from the edge/browser cache. The `ref` is strictly validated to avoid open-proxy abuse.
 */
export async function GET(req: Request): Promise<Response> {
  const ref = new URL(req.url).searchParams.get('ref') ?? '';
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(ref)) {
    return new Response('Invalid photo reference', { status: 400 });
  }
  const key = mapsKey();
  if (!key) return new Response('Maps key not configured', { status: 404 });

  const media = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=400&key=${encodeURIComponent(key)}`;
  const res = await fetch(media);
  if (!res.ok || !res.body) return new Response('Photo unavailable', { status: 502 });

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    },
  });
}
