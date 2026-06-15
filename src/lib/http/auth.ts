import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { getServerEnv } from '@/lib/config/env';
import { ConfigError, UnauthorizedError } from '@/lib/services/errors';

export interface AuthUser {
  id: string;
  email: string | null;
  role: string | null;
}

// Cache the remote JWKS per project (jose fetches + caches the keys internally).
let jwksEndpoint: string | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(supabaseUrl: string): ReturnType<typeof createRemoteJWKSet> {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  if (!jwks || jwksEndpoint !== endpoint) {
    jwksEndpoint = endpoint;
    jwks = createRemoteJWKSet(new URL(endpoint));
  }
  return jwks;
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
 * Verifies a Supabase access token on the edge using `jose`. Branches on the token's
 * algorithm so both signing schemes work identically for web and mobile:
 *  - ES256/RS256 → the project's current asymmetric signing keys, verified via JWKS.
 *  - HS256       → the legacy shared secret (`SUPABASE_JWT_SECRET`); also the test harness.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const env = getServerEnv();

  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  let payload: JWTPayload;
  if (alg === 'HS256') {
    if (!env.SUPABASE_JWT_SECRET) {
      throw new ConfigError('SUPABASE_JWT_SECRET is not configured');
    }
    try {
      payload = (
        await jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET), {
          algorithms: ['HS256'],
        })
      ).payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  } else {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL is not configured');
    }
    try {
      payload = (
        await jwtVerify(token, getJwks(env.NEXT_PUBLIC_SUPABASE_URL), {
          algorithms: ['ES256', 'RS256'],
        })
      ).payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
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
