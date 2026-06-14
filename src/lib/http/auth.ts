import { jwtVerify } from 'jose';
import { getServerEnv } from '@/lib/config/env';
import { ConfigError, UnauthorizedError } from '@/lib/services/errors';

export interface AuthUser {
  id: string;
  email: string | null;
  role: string | null;
}

/** Extracts a Bearer token from the Authorization header (no cookie reliance). */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const parts = header.split(' ');
  const scheme = parts[0];
  const token = parts[1];
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Verifies a Supabase access token (HS256, signed with the project JWT secret)
 * on the edge using `jose`. Works identically for web and mobile.
 *
 * TODO(Phase 4+): also support Supabase asymmetric signing keys via JWKS.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const env = getServerEnv();
  if (!env.SUPABASE_JWT_SECRET) {
    throw new ConfigError('SUPABASE_JWT_SECRET is not configured');
  }

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), {
      algorithms: ['HS256'],
    });
    payload = result.payload as Record<string, unknown>;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  const sub = payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new UnauthorizedError('Token has no subject');
  }

  return {
    id: sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    role: typeof payload.role === 'string' ? payload.role : null,
  };
}

/** Requires a valid token; throws UnauthorizedError otherwise. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const token = getBearerToken(req);
  if (!token) throw new UnauthorizedError();
  return verifyAccessToken(token);
}

/** Returns the user if a valid token is present, otherwise null (never throws on auth). */
export async function optionalUser(req: Request): Promise<AuthUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  try {
    return await verifyAccessToken(token);
  } catch {
    return null;
  }
}

/**
 * For public-or-authenticated endpoints: no token → anonymous (null); a token that
 * is present but invalid → 401. This validates the JWT when supplied while still
 * allowing public access (RLS gates the data as anon).
 */
export async function authenticateOptional(req: Request): Promise<AuthUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  return verifyAccessToken(token);
}
