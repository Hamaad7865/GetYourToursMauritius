import { z, ZodError, type ZodTypeAny } from 'zod';
import { ValidationError } from '@/lib/services/errors';
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
    try {
      const res = await handler(req, routeCtx as C);
      for (const [key, value] of Object.entries(cors)) {
        res.headers.set(key, value);
      }
      return res;
    } catch (error) {
      return errorToResponse(error, cors);
    }
  };
}
