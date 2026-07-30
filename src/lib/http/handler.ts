import { z, ZodError, type ZodTypeAny } from 'zod';
import { ValidationError, isServiceError } from '@/lib/services/errors';
import { log, newCorrelationId } from '@/lib/log';
import { recordError, describeThrown } from '@/lib/error-log';
import { corsHeaders } from './cors';
import { errorToResponse } from './envelope';

/** Validates arbitrary data, converting Zod failures into a ValidationError. */
export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError('Invalid request', error.flatten());
    }
    throw error;
  }
}

/** Parses and validates the URL query string against a schema. */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  return parseWith(schema, raw);
}

/** Parses and validates a JSON request body against a schema. */
export async function parseJsonBody<S extends ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  return parseWith(schema, raw);
}

/**
 * Wraps a route handler with consistent error handling and CORS headers, so each
 * endpoint stays a thin adapter over the service layer.
 */
export function apiHandler<C = unknown>(
  handler: (req: Request, routeCtx: C) => Promise<Response>,
): (req: Request, routeCtx?: C) => Promise<Response> {
  return async (req: Request, routeCtx?: C): Promise<Response> => {
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin);
    // One id per request: returned to the caller as `x-request-id`, stamped on the request-summary
    // log line, and reused as the error id so a reported id maps to exactly what failed.
    const requestId = newCorrelationId();
    const start = Date.now();
    let route = req.url;
    try {
      route = new URL(req.url).pathname;
    } catch {
      /* malformed URL — keep the raw value */
    }

    let res: Response;
    // Kept so the durable error row below can carry the REAL message/stack — the response body only
    // ever gets the generic, non-revealing text.
    let thrown: unknown;
    let crashed = false;
    try {
      res = await handler(req, routeCtx as C);
      for (const [key, value] of Object.entries(cors)) {
        res.headers.set(key, value);
      }
    } catch (error) {
      crashed = true;
      thrown = error;
      // errorToResponse is defensive, but guard it too: a throw HERE would escape the wrapper and
      // surface to the client as a CDN HTML 500 ("Unexpected token '<'" when parsed) — the one thing
      // this layer must never do. Fall back to a minimal JSON envelope.
      try {
        res = errorToResponse(error, cors, requestId);
      } catch {
        res = new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'internal_error', message: 'Something went wrong' },
          }),
          { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } },
        );
      }
    }

    // Best-effort: a Response with immutable headers (e.g. a redirect) would throw on .set — never let
    // that escape as an uncaught error (which would become a CDN HTML 500).
    try {
      res.headers.set('x-request-id', requestId);
    } catch {
      /* immutable headers — skip the correlation header */
    }

    // Measured BEFORE the error-log write below, so the latency figure stays a measure of the HANDLER.
    // Folding a slow diagnostic write into it would make every 500 look like a 3-second endpoint.
    const ms = Date.now() - start;

    // Durable record of anything that actually crashed, so `select * from error_logs order by
    // created_at desc` can answer "what broke?" long after the log stream has rolled away. Only real
    // failures: a 4xx ServiceError describes the CALLER's mistake and would bury the genuine ones, and
    // a deliberately-returned 5xx (a config gate, say) never reaches this branch. Awaited, not
    // fire-and-forget — the edge runtime may cancel work that outlives the response — but bounded by
    // recordError's own short timeout, and it can neither throw nor slow a successful request.
    if (crashed && res.status >= 500) {
      const { errorName, message, stack } = describeThrown(thrown);
      await recordError({
        source: 'api',
        event: isServiceError(thrown) ? 'service_error' : 'unhandled_api_error',
        message,
        errorName,
        stack,
        route,
        method: req.method,
        status: res.status,
        requestId,
        ...(isServiceError(thrown) ? { context: { code: thrown.code } } : {}),
      });
    }

    // One structured line per API request (method, path, status, latency). 5xx/unhandled errors get
    // an additional detail line from errorToResponse sharing this requestId.
    log.info('request', {
      requestId,
      method: req.method,
      route,
      status: res.status,
      ms,
    });
    return res;
  };
}
