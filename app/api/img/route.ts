import { apiHandler } from '@/lib/http/handler';

export const runtime = 'edge';

/** Only these hosts may be proxied — a strict allowlist so this can't be used as an open proxy. */
const ALLOWED_HOSTS = new Set(['upload.wikimedia.org']);

// A descriptive UA: Wikimedia rate-limits/blocks anonymous hotlinkers, which is exactly why the browser
// hitting upload.wikimedia.org directly (≈20 thumbnails at once on the attractions page) gets 429s and
// shows broken images. Fetching server-side with a proper UA + edge caching means each image is pulled
// from Wikimedia at most once per edge POP and then served from our own cache.
const UA = 'BelleMareToursBot/1.0 (+https://bellemaretours.com)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/img?u=<encoded https URL> — caches + re-serves an allowlisted remote image from our own
 * domain so we never hotlink (and get rate-limited by) the origin at runtime. Retries a 429 a couple of
 * times so a cold-cache burst still resolves. Returns 404 on failure so the caller's onError can fall
 * back to the branded gradient.
 *
 * Wrapped in apiHandler so an upstream fetch rejection maps to the standard envelope; apiHandler only
 * JSON-ifies the error path, so the streamed image body on success is preserved.
 */
export const GET = apiHandler(async (req) => {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response('Host not allowed', { status: 400 });
  }

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await fetch(target.toString(), { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (res.status !== 429) break;
    await sleep(300 * (attempt + 1));
  }
  if (!res || !res.ok || !res.body) return new Response('Image unavailable', { status: 404 });

  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      // Immutable: the underlying Wikimedia thumbnail at this URL never changes. Cache hard at the edge
      // (s-maxage) + browser (max-age) so users effectively never wait on Wikimedia.
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
    },
  });
});
