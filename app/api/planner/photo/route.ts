import { apiHandler } from '@/lib/http/handler';
import { getServerEnv } from '@/lib/config/env';
import { rateLimit } from '@/lib/http/rate-limit';

export const runtime = 'edge';

/** Upstream fetch timeout (ms) — a hung Google Places request must not tie up the edge invocation. */
const UPSTREAM_TIMEOUT_MS = 8000;

function mapsKey(): string | null {
  const env = getServerEnv();
  return env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

/**
 * GET /api/planner/photo?ref=places/<id>/photos/<ref> — proxies a Google Places photo so the API key
 * stays server-side. Streams the image bytes back with a long cache so each photo is billed once and
 * then served from the edge/browser cache. The `ref` is strictly validated to avoid open-proxy abuse.
 *
 * Wrapped in `apiHandler` so an upstream fetch rejection (Google unreachable / DNS) maps to the
 * standard error envelope instead of a raw 500. apiHandler only sets CORS headers on a successful
 * Response and is JSON-only on the error path, so the image/redirect success body is preserved.
 */
export const GET = apiHandler(async (req) => {
  // Per-IP limit: a cache MISS bills a Google Places media request, so an unthrottled proxy is
  // wallet-DoS-prone. Generous (photos are cached hard below, so real page loads rarely re-hit it).
  await rateLimit(req, 'planner:photo', 60);

  const ref = new URL(req.url).searchParams.get('ref') ?? '';
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(ref)) {
    return new Response('Invalid photo reference', { status: 400 });
  }
  const key = mapsKey();
  if (!key) return new Response('Maps key not configured', { status: 404 });

  const media = `https://places.googleapis.com/v1/${ref}/media?maxWidthPx=400&key=${encodeURIComponent(key)}`;
  // Bound the upstream fetch so a hung Google request can't hold the edge invocation open indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(media, { signal: controller.signal });
  } catch {
    return new Response('Photo unavailable', { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok || !res.body) return new Response('Photo unavailable', { status: 502 });

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
    },
  });
});
