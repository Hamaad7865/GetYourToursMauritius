import { getServerEnv } from '@/lib/config/env';

/**
 * Scoped CORS for browser clients. Reflects the Origin ONLY when it's allow-listed; any other
 * browser origin gets no `access-control-allow-origin` header at all (the response is simply not
 * CORS-readable) rather than the site URL echoed back — echoing a non-matching origin granted
 * nothing and obscured intent. Native/mobile clients send no Origin and use Bearer tokens, so
 * they are unaffected.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const env = getServerEnv();
  const allowList = new Set<string>([env.NEXT_PUBLIC_SITE_URL]);

  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (origin && allowList.has(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

export function preflightResponse(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}
