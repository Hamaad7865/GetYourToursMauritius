/**
 * A `fetch` wrapper with a hard timeout, for outbound calls made from the edge worker (Supabase, any
 * upstream). Without a timeout, a slow/unreachable upstream hangs the worker until Cloudflare gives up
 * and returns a 502 Bad Gateway (an HTML page the client can't parse). With it the call aborts and the
 * caller's normal error handling produces a clean JSON 5xx instead.
 *
 * Returns a function with fetch's signature so it can be passed as supabase-js's `global.fetch`.
 */
export function timeoutFetch(ms: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    // Propagate a caller-supplied signal (supabase-js may pass one) so either source can abort.
    const caller = init?.signal;
    if (caller) {
      if (caller.aborted) controller.abort();
      else caller.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Default upstream timeout: well under any CDN gateway limit, generous for our sub-second RPCs. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
