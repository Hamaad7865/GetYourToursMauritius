import { reportClientError } from '@/lib/client-error-report';

/** Our standard API response envelope (mirror of src/lib/http/envelope.ts on the client side). */
export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data: T;
  error?: { code?: string; message?: string; details?: unknown };
  meta?: unknown;
}

/**
 * Parse an API `Response` as our JSON envelope. When the body ISN'T JSON — almost always an HTML
 * error page served by the edge/CDN when a function hard-crashes or a route 404s — throw a clear,
 * user-facing Error instead of the cryptic `Unexpected token '<', "<!DOCTYPE"... is not valid JSON`
 * that `JSON.parse` raises. The thrown message includes the `x-request-id` (when the response carried
 * one) so the failure can be traced to its server log line, and the raw failure is reported to
 * `/api/v1/client-errors` so it lands in the log pipeline.
 *
 * A normal JSON error envelope (`{ ok: false, ... }`) parses fine and is returned as-is, so callers
 * keep doing their own `if (!res.ok) …` handling.
 */
export async function parseApiJson<T = unknown>(res: Response): Promise<ApiEnvelope<T>> {
  const requestId = res.headers.get('x-request-id');
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    // Not JSON: an HTML error page, a gateway 5xx, an empty body, etc.
    reportClientError({
      kind: 'api.non_json',
      message: `Non-JSON response (HTTP ${res.status}) from ${res.url || 'API'}${
        requestId ? ` [req ${requestId}]` : ''
      }`,
      stack: text.slice(0, 1000),
    });
    const ref = requestId ? ` (ref: ${requestId})` : '';
    throw new Error(
      `Something went wrong on our side (HTTP ${res.status})${ref}. Please try again — if it keeps ` +
        `happening, contact us and we’ll finish your booking.`,
    );
  }
}
