import type { PaginationMeta } from '@/lib/validation/common';
import { isServiceError } from '@/lib/services/errors';

export interface SuccessBody<T> {
  ok: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
};

export function jsonOk<T>(
  data: T,
  opts: { status?: number; meta?: PaginationMeta; headers?: Record<string, string> } = {},
): Response {
  const body: SuccessBody<T> = { ok: true, data };
  if (opts.meta) body.meta = opts.meta;
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: { ...JSON_HEADERS, ...(opts.headers ?? {}) },
  });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
): Response {
  const body: ErrorBody = { ok: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...(headers ?? {}) },
  });
}

/** Generic, non-revealing message for a 5xx service error code. */
function genericServerMessage(code: string): string {
  switch (code) {
    case 'config_error':
      return 'The service is temporarily unavailable';
    case 'provider_error':
      return 'An upstream service is unavailable';
    case 'not_implemented':
      return 'This operation is not available yet';
    default:
      return 'Something went wrong';
  }
}

/** Maps any thrown value to a consistent error response. 4xx ServiceErrors keep their message. */
export function errorToResponse(error: unknown, headers?: Record<string, string>): Response {
  if (isServiceError(error)) {
    // Client errors (4xx) are safe to surface verbatim — they describe the caller's mistake.
    if (error.status < 500) {
      return jsonError(error.status, error.code, error.message, error.details, headers);
    }
    // Server errors (5xx) may carry internal detail (e.g. WHICH env var is missing, upstream
    // specifics). Log the real message with a correlation id; return only a generic message + id.
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'service_error',
        errorId,
        code: error.code,
        message: error.message,
        time: new Date().toISOString(),
      }),
    );
    return jsonError(error.status, error.code, genericServerMessage(error.code), { errorId }, headers);
  }
  // Unhandled error: emit a single structured JSON line (parseable by Cloudflare Logpush / any log
  // sink) with a correlation id, and return that id to the client so a report can be traced — but
  // never the raw error text.
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_api_error',
      errorId,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      time: new Date().toISOString(),
    }),
  );
  return jsonError(500, 'internal_error', 'Something went wrong', { errorId }, headers);
}
