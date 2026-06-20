import type { ServiceContext } from '@/lib/services/context';
import { enforceRateLimit } from '@/lib/services/rate-limit';

/**
 * Derives the client IP from Cloudflare's `cf-connecting-ip`, falling back to the first hop of
 * `x-forwarded-for`. Returns null when neither is present (server-side / unknown). Identical to the
 * lead route's extraction so every public endpoint keys its limit on the same identity.
 */
export function clientIp(req: Request): string | null {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null
  );
}

/**
 * Per-IP, per-route rate limit for a public endpoint. Extracts the IP, then enforces the DB-backed
 * limit under a distinct `bucket` so routes don't share a budget. Throws a RateLimitError (→ 429) on
 * exceed; the `apiHandler` wrapper maps it to the standard error envelope. A missing IP is allowed
 * through (the edge / Cloudflare is the backstop), matching the lead limiter. OPTIONS/CORS preflight
 * is handled by a separate exported `OPTIONS` and never reaches this.
 */
export async function rateLimit(
  req: Request,
  ctx: ServiceContext,
  bucket: string,
  limit: number,
  windowSeconds = 60,
): Promise<void> {
  await enforceRateLimit(ctx, bucket, clientIp(req), limit, windowSeconds);
}
