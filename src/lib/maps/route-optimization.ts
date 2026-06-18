import { getServerEnv } from '@/lib/config/env';
import { ProviderError } from '@/lib/services/errors';
import type { LatLng } from './haversine';

/**
 * Google **Route Optimization API** (`optimizeTours`) client for the AI Road Trip Planner.
 *
 * Given the pickup and the day's stops, it returns the optimal driving order (a permutation of the
 * stop indices) so the planner can auto-reorder the itinerary to the shortest round trip
 * (pickup → stops → pickup). Unlike Routes/Places, this Cloud API authenticates with an OAuth2
 * **service-account** token (scope `cloud-platform`, IAM `routeoptimization.locations.use`) — NOT an
 * API key. We mint the token with Web Crypto (RS256), so this works on the Cloudflare Pages edge.
 *
 * Everything here is best-effort and fail-open: any missing credential or upstream error returns
 * `null` and the planner simply keeps the current order — optimization never breaks the planner.
 */
const RO_BASE = 'https://routeoptimization.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });

/** The OptimizeTours `model`: one delivery shipment per stop, one vehicle starting+ending at pickup. */
export function buildOptimizeToursModel(pickup: LatLng, stops: LatLng[]) {
  return {
    shipments: stops.map((s, i) => ({
      label: String(i),
      deliveries: [{ arrivalWaypoint: wp(s) }],
    })),
    vehicles: [
      {
        label: 'planner-vehicle',
        startWaypoint: wp(pickup),
        endWaypoint: wp(pickup),
        travelMode: 'DRIVING',
      },
    ],
  };
}

interface OptimizeToursResponse {
  routes?: Array<{ visits?: Array<{ shipmentIndex?: number }> }>;
}

/**
 * The optimal stop order from an OptimizeToursResponse — original stop indices in visiting order.
 * Returns `null` when the response can't be trusted (so the caller keeps the current order). Any
 * skipped/unvisited stop is appended in its original position rather than dropped.
 */
export function parseOptimizedOrder(response: unknown, stopCount: number): number[] | null {
  const visits = (response as OptimizeToursResponse)?.routes?.[0]?.visits;
  if (!Array.isArray(visits)) return null;

  const order: number[] = [];
  const seen = new Set<number>();
  for (const v of visits) {
    // JSON drops proto's default `shipmentIndex: 0`, so shipment 0 arrives as `{}`.
    const idx = typeof v?.shipmentIndex === 'number' ? v.shipmentIndex : 0;
    if (idx < 0 || idx >= stopCount || seen.has(idx)) continue;
    seen.add(idx);
    order.push(idx);
  }
  if (seen.size === 0) return null;

  for (let i = 0; i < stopCount; i += 1) if (!seen.has(i)) order.push(i);
  return order;
}

// ── OAuth2 service-account token (RS256 via Web Crypto) ──

export function buildJwtClaims(clientEmail: string, nowSec: number) {
  return { iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
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

function base64url(input: ArrayBuffer | Uint8Array | string): string {
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

async function signServiceAccountJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(buildJwtClaims(sa.client_email, nowSec)));
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

let tokenCache: { token: string; expSec: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expSec - 60 > nowSec) return tokenCache.token;

  const assertion = await signServiceAccountJwt(sa, nowSec);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_BEARER, assertion }),
  });
  if (!res.ok) throw new ProviderError(`OAuth token HTTP ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new ProviderError('OAuth token missing access_token');
  tokenCache = { token: data.access_token, expSec: nowSec + (data.expires_in ?? 3600) };
  return data.access_token;
}

/** Test seam: drop the cached access token. */
export function __resetRouteOptimizationToken(): void {
  tokenCache = null;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = getServerEnv().GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

/**
 * Best-effort optimal driving order for `stops` (returned as original indices in visiting order),
 * or `null` when optimization is unavailable/fails — in which case the planner keeps its order.
 * Never throws.
 */
export async function getOptimizedStopOrder(pickup: LatLng, stops: LatLng[]): Promise<number[] | null> {
  if (stops.length < 2) return null;
  const sa = loadServiceAccount();
  if (!sa) return null;
  const project = getServerEnv().GOOGLE_CLOUD_PROJECT ?? sa.project_id;
  if (!project) return null;

  try {
    const token = await getAccessToken(sa);
    const res = await fetch(`${RO_BASE}/projects/${encodeURIComponent(project)}:optimizeTours`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: buildOptimizeToursModel(pickup, stops) }),
    });
    if (!res.ok) throw new ProviderError(`optimizeTours HTTP ${res.status}`);
    return parseOptimizedOrder(await res.json(), stops.length);
  } catch {
    return null;
  }
}
