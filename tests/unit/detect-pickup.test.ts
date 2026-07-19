import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ACCEPTABLE_ACCURACY_M, detectPickup } from '@/lib/geo/detect-pickup';

const getCurrentPosition = vi.fn();
const reverseGeocode = vi.fn();

vi.mock('@/lib/geo/current-position', () => ({
  getCurrentPosition: (...args: unknown[]) => getCurrentPosition(...args),
}));
vi.mock('@/lib/maps/reverse-geocode', () => ({
  reverseGeocode: (...args: unknown[]) => reverseGeocode(...args),
}));

const BELLE_MARE = { ok: true as const, lat: -20.205, lng: 57.76, accuracyM: 20 };

afterEach(() => {
  getCurrentPosition.mockReset();
  reverseGeocode.mockReset();
});

describe('detectPickup', () => {
  it('resolves a precise Mauritius fix into a named, driver-usable point', async () => {
    getCurrentPosition.mockResolvedValue(BELLE_MARE);
    reverseGeocode.mockResolvedValue([
      { formatted_address: 'Coastal Rd, Belle Mare', types: ['route'] },
    ]);
    const r = await detectPickup();
    expect(r).toEqual({
      ok: true,
      id: 'geo:-20.20500,57.76000',
      name: 'Coastal Rd, Belle Mare',
      lat: -20.205,
      lng: 57.76,
    });
  });

  it('REJECTS a fix outside Mauritius even though the browser granted it', async () => {
    getCurrentPosition.mockResolvedValue({ ok: true, lat: 48.8566, lng: 2.3522, accuracyM: 10 });
    expect(await detectPickup()).toEqual({ ok: false, reason: 'outside-mauritius' });
    // …and never spends a billed geocode on a location we can't serve.
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('rejects a fix too vague to tell one resort from the next', async () => {
    getCurrentPosition.mockResolvedValue({
      ...BELLE_MARE,
      accuracyM: MAX_ACCEPTABLE_ACCURACY_M + 1,
    });
    expect(await detectPickup()).toEqual({ ok: false, reason: 'imprecise' });
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('accepts a fix exactly at the accuracy limit', async () => {
    getCurrentPosition.mockResolvedValue({ ...BELLE_MARE, accuracyM: MAX_ACCEPTABLE_ACCURACY_M });
    reverseGeocode.mockResolvedValue([{ formatted_address: 'Coastal Rd', types: ['route'] }]);
    expect((await detectPickup()).ok).toBe(true);
  });

  it('passes through every reason we never got a fix', async () => {
    for (const reason of ['denied', 'timeout', 'unavailable', 'unsupported', 'insecure'] as const) {
      getCurrentPosition.mockResolvedValue({ ok: false, reason });
      expect(await detectPickup()).toEqual({ ok: false, reason });
    }
  });

  it('reports unnamed rather than planting a coordinate string on the automatic path', async () => {
    getCurrentPosition.mockResolvedValue(BELLE_MARE);
    reverseGeocode.mockResolvedValue([]);
    expect(await detectPickup()).toEqual({ ok: false, reason: 'unnamed' });
  });

  it('allows the coordinate fallback only when the visitor explicitly asked', async () => {
    getCurrentPosition.mockResolvedValue(BELLE_MARE);
    reverseGeocode.mockResolvedValue([]);
    const r = await detectPickup({ explicit: true });
    expect(r).toMatchObject({ ok: true, name: 'Pinned location (-20.20500, 57.76000)' });
  });

  it('survives a reverse geocode that throws instead of failing the whole detection', async () => {
    getCurrentPosition.mockResolvedValue(BELLE_MARE);
    reverseGeocode.mockRejectedValue(new Error('maps down'));
    expect(await detectPickup()).toEqual({ ok: false, reason: 'unnamed' });
    // The explicit path can still offer coordinates the driver can paste into Maps.
    reverseGeocode.mockRejectedValue(new Error('maps down'));
    expect(await detectPickup({ explicit: true })).toMatchObject({ ok: true });
  });
});
