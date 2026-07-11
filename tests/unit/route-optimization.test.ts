import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildOptimizeToursModel,
  parseOptimizedOrder,
  buildJwtClaims,
  pemToPkcs8,
  getOptimizedStopOrder,
} from '@/lib/maps/route-optimization';
import { resetServerEnvCache } from '@/lib/config/env';

const PICKUP = { lat: -20.1833, lng: 57.774 };
const GRAND_BAIE = { lat: -20.0182, lng: 57.5802 };
const LE_MORNE = { lat: -20.4563, lng: 57.3082 };
const CHAMAREL = { lat: -20.4308, lng: 57.3789 };

describe('buildOptimizeToursModel', () => {
  it('models each stop as a delivery shipment and one round-trip vehicle', () => {
    const model = buildOptimizeToursModel(PICKUP, [GRAND_BAIE, LE_MORNE]);

    expect(model.shipments).toHaveLength(2);
    expect(model.shipments[0]).toEqual({
      label: '0',
      deliveries: [
        {
          arrivalWaypoint: {
            location: { latLng: { latitude: GRAND_BAIE.lat, longitude: GRAND_BAIE.lng } },
          },
        },
      ],
    });
    expect(model.shipments[1]!.label).toBe('1');

    expect(model.vehicles).toHaveLength(1);
    const v = model.vehicles[0]!;
    expect(v.travelMode).toBe('DRIVING');
    expect(v.startWaypoint).toEqual({
      location: { latLng: { latitude: PICKUP.lat, longitude: PICKUP.lng } },
    });
    expect(v.endWaypoint).toEqual(v.startWaypoint);
  });
});

describe('parseOptimizedOrder', () => {
  it('reads the optimized visiting order from routes[0].visits', () => {
    const res = {
      routes: [{ visits: [{ shipmentIndex: 2 }, { shipmentIndex: 1 }, { shipmentIndex: 0 }] }],
    };
    expect(parseOptimizedOrder(res, 3)).toEqual([2, 1, 0]);
  });

  it('treats a visit with no shipmentIndex as shipment 0 (proto omits the default)', () => {
    // The REST/JSON encoding drops `shipmentIndex: 0`, so the first shipment appears as `{}`.
    const res = { routes: [{ visits: [{ shipmentIndex: 2 }, {}, { shipmentIndex: 1 }] }] };
    expect(parseOptimizedOrder(res, 3)).toEqual([2, 0, 1]);
  });

  it('appends skipped/unvisited stops at the end in original order (never drops a stop)', () => {
    const res = { routes: [{ visits: [{ shipmentIndex: 1 }] }] };
    expect(parseOptimizedOrder(res, 3)).toEqual([1, 0, 2]);
  });

  it('ignores duplicate and out-of-range indices', () => {
    const res = { routes: [{ visits: [{ shipmentIndex: 5 }, {}, { shipmentIndex: 0 }] }] };
    expect(parseOptimizedOrder(res, 2)).toEqual([0, 1]);
  });

  it('returns null when there are no usable visits (untrustworthy response)', () => {
    expect(parseOptimizedOrder({ routes: [{ visits: [] }] }, 2)).toBeNull();
    expect(parseOptimizedOrder({ routes: [{}] }, 2)).toBeNull();
    expect(parseOptimizedOrder({}, 2)).toBeNull();
  });
});

describe('buildJwtClaims', () => {
  it('builds a 1-hour cloud-platform assertion for the service account', () => {
    const claims = buildJwtClaims('svc@proj.iam.gserviceaccount.com', 1000);
    expect(claims).toEqual({
      iss: 'svc@proj.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
  });
});

describe('pemToPkcs8', () => {
  it('strips the PEM header/footer and whitespace, then base64-decodes the body', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----\n';
    expect(Array.from(pemToPkcs8(pem))).toEqual([1, 2, 3]);
  });
});

describe('getOptimizedStopOrder (fail-open)', () => {
  beforeEach(() => resetServerEnvCache());
  afterEach(() => resetServerEnvCache());

  it('returns null for fewer than 2 stops (nothing to reorder)', async () => {
    expect(await getOptimizedStopOrder(PICKUP, [GRAND_BAIE])).toBeNull();
  });

  it('returns null when no service account is configured (planner keeps its order)', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(await getOptimizedStopOrder(PICKUP, [GRAND_BAIE, LE_MORNE, CHAMAREL])).toBeNull();
  });
});
