import { ProviderError } from '@/lib/services/errors';

/**
 * Google **service-account** OAuth2 for the Cloudflare Pages edge.
 *
 * Cloud APIs that refuse API keys (Route Optimization, Search Console) want a short-lived OAuth2
 * access token minted from a signed JWT assertion. There is no `googleapis` client on the edge, so
 * the RS256 assertion is signed with Web Crypto and exchanged for a token here.
 *
 * Extracted from the Route Optimization client so the Search Console reader could reuse it rather
 * than carry a second copy of the crypto. Tokens are cached per (account, scope) — one account can
 * legitimately hold several scopes, and caching them together would hand a caller a token missing
 * the scope it asked for.
 */

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** The assertion claims Google exchanges for an access token. One hour is the documented maximum. */
export function buildJwtClaims(clientEmail: string, nowSec: number, scope: string) {
  return { iss: clientEmail, scope, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
}

/** Decode a PEM PKCS#8 private key body to raw DER bytes. */
export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Copy into a fresh ArrayBuffer so the value satisfies `BufferSource` (Web Crypto) regardless of
 *  the source Uint8Array's backing buffer type. */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

export function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signServiceAccountJwt(
  sa: ServiceAccount,
  nowSec: number,
  scope: string,
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(buildJwtClaims(sa.client_email, nowSec, scope)));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pemToPkcs8(sa.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    toArrayBuffer(new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64url(sig)}`;
}

const tokenCache = new Map<string, { token: string; expSec: number }>();

/** A cached OAuth2 access token for `scope`. Refreshed a minute before it actually expires. */
export async function getServiceAccountToken(sa: ServiceAccount, scope: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cacheKey = `${sa.client_email}|${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expSec - 60 > nowSec) return cached.token;

  const assertion = await signServiceAccountJwt(sa, nowSec, scope);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_BEARER, assertion }),
  });
  if (!res.ok) throw new ProviderError(`OAuth token HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new ProviderError('OAuth token missing access_token');
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expSec: nowSec + (data.expires_in ?? 3600),
  });
  return data.access_token;
}

/** Test seam: drop every cached access token. */
export function __resetServiceAccountTokens(): void {
  tokenCache.clear();
}

/** Parse a service-account JSON blob from the environment; null when absent or malformed. */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}
