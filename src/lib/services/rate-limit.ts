import type { ServiceContext } from './context';
import { callRpc } from './rpc';

/**
 * Generic per-IP rate limit, backed by the `api_rate_limit` Postgres function (a fixed-window counter
 * in the `rate_limits` table). DB-backed so it holds across edge isolates / server instances, unlike an
 * in-process counter. Throws a RateLimitError (→ HTTP 429) once `limit` calls for the same (bucket, ip)
 * land inside the current window; `callRpc` → `mapDbError` maps the raised `rate_limited` exception.
 *
 * A null/empty `ip` is allowed through unthrottled (server-side or unknown client), matching the lead
 * limiter — app-level throttling needs a client identity, and the edge (Cloudflare) is the backstop.
 */
export async function enforceRateLimit(
  ctx: ServiceContext,
  bucket: string,
  ip: string | null,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  await callRpc(ctx, 'api_rate_limit', {
    bucket,
    ip: ip ?? null,
    limit,
    windowSeconds,
  });
}
