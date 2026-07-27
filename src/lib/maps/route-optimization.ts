import { getServerEnv } from '@/lib/config/env';
import { ProviderError } from '@/lib/services/errors';
import {
  CLOUD_PLATFORM_SCOPE,
  getServiceAccountToken,
  parseServiceAccount,
  __resetServiceAccountTokens,
  type ServiceAccount,
} from '@/lib/google/service-account';
import type { LatLng } from './haversine';

/**
 * Google **Route Optimization API** (`optimizeTours`) client for the AI Road Trip Planner.
 *
 * Given the pickup and the day's stops, it returns the optimal driving order (a permutation of the
 * stop indices) so the planner can auto-reorder the itinerary to the shortest round trip
 * (pickup → stops → pickup). Unlike Routes/Places, this Cloud API authenticates with an OAuth2
 * **service-account** token (scope `cloud-platform`, IAM `routeoptimization.locations.use`) — NOT an
 * API key; the edge-safe token minting lives in @/lib/google/service-account.
 *
 * Everything here is best-effort and fail-open: any missing credential or upstream error returns
 * `null` and the planner simply keeps the current order — optimization never breaks the planner.
 */
const RO_BASE = 'https://routeoptimization.googleapis.com/v1';

export type { ServiceAccount };

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

/** Test seam: drop the cached access token. */
export function __resetRouteOptimizationToken(): void {
  __resetServiceAccountTokens();
}

function loadServiceAccount(): ServiceAccount | null {
  return parseServiceAccount(getServerEnv().GOOGLE_SERVICE_ACCOUNT_JSON);
}

/**
 * Best-effort optimal driving order for `stops` (returned as original indices in visiting order),
 * or `null` when optimization is unavailable/fails — in which case the planner keeps its order.
 * Never throws.
 */
export async function getOptimizedStopOrder(
  pickup: LatLng,
  stops: LatLng[],
): Promise<number[] | null> {
  if (stops.length < 2) return null;
  const sa = loadServiceAccount();
  if (!sa) return null;
  const project = getServerEnv().GOOGLE_CLOUD_PROJECT ?? sa.project_id;
  if (!project) return null;

  try {
    const token = await getServiceAccountToken(sa, CLOUD_PLATFORM_SCOPE);
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
