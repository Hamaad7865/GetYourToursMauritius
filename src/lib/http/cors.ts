import { getServerEnv } from '@/lib/config/env';

/**
 * Scoped CORS for browser clients. Reflects the configured site origin; other
 * origins fall back to the site URL. Native/mobile clients send no Origin and use
 * Bearer tokens, so they are unaffected.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const env = getServerEnv();
  const allowList = new Set<string>([env.NEXT_PUBLIC_SITE_URL]);
  const allowOrigin = origin && allowList.has(origin) ? origin : env.NEXT_PUBLIC_SITE_URL;

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}
