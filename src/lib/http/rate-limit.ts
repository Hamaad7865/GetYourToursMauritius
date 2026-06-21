import type { ServiceContext } from '@/lib/services/context';
import { enforceRateLimit } from '@/lib/services/rate-limit';

/** Hard cap on the stored IP length. Caps a spoofed giant `x-forwarded-for` so it can't bloat the
 *  rate-limit / lead row. A valid IPv4/IPv6 (even with a zone id) is well under this. */
export const MAX_IP_LENGTH = 64;

/** Truncates the derived IP to {@link MAX_IP_LENGTH} so a forged header can't bloat the DB row. */
export function capIp(ip: string | null): string | null {
  return ip == null ? null : ip.slice(0, MAX_IP_LENGTH);
}

/**
 * Derives the client IP from Cloudflare's `cf-connecting-ip`, falling back to the first hop of
 * `x-forwarded-for`. Returns null when neither is present (server-side / unknown). Identical to the
 * lead route's extraction so every public endpoint keys its limit on the same identity. The result is
 * length-capped so a spoofed giant `x-forwarded-for` can't bloat the row it's written to.
 */
export function clientIp(req: Request): string | null {
  return capIp(
    req.headers.get('cf-connecting-ip') ??
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      null,
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
