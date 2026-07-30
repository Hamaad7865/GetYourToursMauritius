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
 *  2. **It never blocks for long.** A 3-second client timeout, not the 15-second default: a customer
 *     staring at a failing page must not also wait on a sick database. A write that misses the window
 *     is dropped, and the console line still carries the error.
 *  3. **It stores no personal data.** No IP, no email, no request bodies, no tokens. Only what the
 *     operator needs to find the bug.
 */
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { supabaseRpc } from '@/lib/supabase/rpc';
import { getServerEnv } from '@/lib/config/env';

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
    const env = getServerEnv();
    // No service key (local dev, preview builds, the seed-fixture fallback) — the console line is the
    // whole story there, and there is no database to write to.
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

    const db = supabaseRpc(createServiceRoleClient(ERROR_LOG_TIMEOUT_MS));
    await db.rpc('api_log_error', {
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
    });
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
