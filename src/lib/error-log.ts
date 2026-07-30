/**
 * The durable half of error reporting: writes one row to `error_logs` so a failure survives the
 * request that produced it. The structured console line (see `@/lib/log`) still goes out on every
 * path — this is an additional sink, not a replacement, and it exists so the operator can answer
 * "what broke, and when?" with:
 *
 *     select * from error_logs order by created_at desc;
 *
 * Three rules hold everywhere this is called from:
 *  1. **It never throws.** It runs inside catch blocks that are already handling a failure; a throw
 *     here would convert a handled 500 into an unhandled one — the exact blindness the table fixes.
 *  2. **It never blocks for long.** A 3-second abort, not the 15-second upstream default: a customer
 *     staring at a failing page must not also wait on a sick database.
 *  3. **It stores no personal data.** No IP, no email, no request bodies, no tokens.
 *
 * ── Why this module imports NOTHING ────────────────────────────────────────────────────────────
 * It is called from `instrumentation.ts`, which Next inlines into EVERY edge function. Any module
 * this file imports is therefore shared between the instrumentation prelude and the route body of
 * the same generated function — and when webpack chunks such a module, next-on-pages' dedup pass
 * sees the same chunk identifier twice in one function file and aborts the build with "A duplicated
 * identifier has been detected in the same function file" (dedupeEdgeFunctions → collectIdentifiers).
 * That is exactly what a `@supabase/supabase-js` import here did. Keeping this a dependency-free leaf
 * — a single fetch, `process.env` read directly instead of through the zod-backed env module — keeps
 * instrumentation's module graph disjoint from the routes'. Do not add imports to this file.
 *
 * PostgREST's RPC endpoint is a plain POST, so the Supabase client bought us nothing here anyway.
 */

/** Which layer produced the failure — the first thing you filter on when triaging. */
export type ErrorSource = 'api' | 'ssr' | 'browser' | 'cron';

export interface ErrorRecord {
  source: ErrorSource;
  /** Stable name per call site (`unhandled_api_error`, `request_error`, `client_error`, …). */
  event: string;
  message: string;
  errorName?: string;
  stack?: string;
  route?: string;
  method?: string;
  status?: number;
  /** The value returned to the caller as `x-request-id`, so a reported id maps to this row. */
  requestId?: string;
  userAgent?: string;
  context?: Record<string, unknown>;
}

/** A failing request must not wait on the log write; the SQL insert is sub-millisecond when healthy. */
const ERROR_LOG_TIMEOUT_MS = 3_000;

/** Mirrors the clamps in api_log_error so an oversized payload is never put on the wire at all. */
const MAX_MESSAGE = 2_000;
const MAX_STACK = 8_000;

function clamp(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Records one failure. Safe to `await` from any catch block — it resolves either way and swallows its
 * own failures (falling back to a plain console line, never to a recursive call into itself).
 */
export async function recordError(record: ErrorRecord): Promise<void> {
  try {
    // Read straight from process.env — see the module note above on why this file imports nothing.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // No service key (local dev, preview builds, the seed-fixture fallback) — the console line is the
    // whole story there, and there is no database to write to.
    if (!url || !key) return;

    const res = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/api_log_error`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p: {
          source: record.source,
          event: record.event,
          message: clamp(record.message, MAX_MESSAGE) ?? '(no message)',
          errorName: record.errorName,
          stack: clamp(record.stack, MAX_STACK),
          route: record.route,
          method: record.method,
          status: record.status,
          requestId: record.requestId,
          userAgent: record.userAgent,
          context: record.context,
        },
      }),
      // Hard bound on an already-failing request. AbortSignal.timeout is available on the edge
      // runtime and in Node 18+; the catch below covers the abort like any other failure.
      signal: AbortSignal.timeout(ERROR_LOG_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[error-log] api_log_error returned ${res.status}`);
    }
  } catch (error) {
    // Deliberately a bare console line, NOT `log.error` and never a retry: this path runs when the
    // database is the thing that's broken, and anything cleverer risks recursing or stalling.
    console.error(
      '[error-log] could not persist an error row:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
}

/** Normalises any thrown value into the name/message/stack triple the table stores. */
export function describeThrown(error: unknown): {
  errorName: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { errorName: error.name, message: error.message, stack: error.stack };
  }
  return { errorName: typeof error, message: String(error) };
}
