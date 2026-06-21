import { z, ZodError, type ZodTypeAny } from 'zod';
import { ValidationError } from '@/lib/services/errors';
import { log, newCorrelationId } from '@/lib/log';
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
    try {
      res = await handler(req, routeCtx as C);
      for (const [key, value] of Object.entries(cors)) {
        res.headers.set(key, value);
      }
    } catch (error) {
      res = errorToResponse(error, cors, requestId);
    }

    res.headers.set('x-request-id', requestId);
    // One structured line per API request (method, path, status, latency). 5xx/unhandled errors get
    // an additional detail line from errorToResponse sharing this requestId.
    log.info('request', {
      requestId,
      method: req.method,
      route,
      status: res.status,
      ms: Date.now() - start,
    });
    return res;
  };
}
