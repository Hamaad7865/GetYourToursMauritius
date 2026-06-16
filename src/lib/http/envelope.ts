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

/** Maps any thrown value to a consistent error response. ServiceErrors keep their status/code. */
export function errorToResponse(error: unknown, headers?: Record<string, string>): Response {
  if (isServiceError(error)) {
    return jsonError(error.status, error.code, error.message, error.details, headers);
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
