import { describe, expect, it, vi } from 'vitest';
import { getCurrentPosition } from '@/lib/geo/current-position';

/* Every failure path matters equally here: the caller's correct response to all of them is "silently
 * keep the default pick-up", so a hang (no settle) is the only real bug — and it's the one the raw
 * browser API produces when a permission prompt is dismissed. */

const fix = (lat: number, lng: number, accuracy = 12) =>
  ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;

/** A geolocation stub that calls the success callback. */
const granting = (lat: number, lng: number) => ({
  getCurrentPosition: (ok: PositionCallback) => ok(fix(lat, lng)),
});

/** A geolocation stub that calls the error callback with a spec error code. */
const failing = (code: number) => ({
  getCurrentPosition: (_ok: PositionCallback, err?: PositionErrorCallback | null) =>
    err?.({ code } as GeolocationPositionError),
});

/** The nasty one: a dismissed prompt calls NEITHER callback, ever. */
const silent = { getCurrentPosition: () => {} };

describe('getCurrentPosition', () => {
  it('resolves a granted fix with coordinates and accuracy', async () => {
    const r = await getCurrentPosition({
      geolocation: granting(-20.205, 57.76),
      secureContext: true,
    });
    expect(r).toEqual({ ok: true, lat: -20.205, lng: 57.76, accuracyM: 12 });
  });

  it('reports a declined prompt as denied', async () => {
    const r = await getCurrentPosition({ geolocation: failing(1), secureContext: true });
    expect(r).toEqual({ ok: false, reason: 'denied' });
  });

  it('reports no-fix as unavailable and a slow fix as timeout', async () => {
    expect(await getCurrentPosition({ geolocation: failing(2), secureContext: true })).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(await getCurrentPosition({ geolocation: failing(3), secureContext: true })).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it('maps an unknown error code to unavailable rather than throwing', async () => {
    const r = await getCurrentPosition({ geolocation: failing(99), secureContext: true });
    expect(r).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('SETTLES when the prompt is dismissed and no callback ever fires', async () => {
    vi.useFakeTimers();
    try {
      const p = getCurrentPosition({
        geolocation: silent,
        secureContext: true,
        timeoutMs: 8000,
      });
      await vi.advanceTimersByTimeAsync(8000);
      expect(await p).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an unsupported browser without calling anything', async () => {
    const r = await getCurrentPosition({ geolocation: null, secureContext: true });
    expect(r).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('distinguishes an insecure context from a user saying no', async () => {
    const spy = vi.fn();
    const r = await getCurrentPosition({
      geolocation: { getCurrentPosition: spy },
      secureContext: false,
    });
    expect(r).toEqual({ ok: false, reason: 'insecure' });
    expect(spy).not.toHaveBeenCalled(); // never prompt on http
  });

  it('survives a webview that throws synchronously', async () => {
    const r = await getCurrentPosition({
      geolocation: {
        getCurrentPosition: () => {
          throw new Error('not implemented');
        },
      },
      secureContext: true,
    });
    expect(r).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('ignores a late or duplicate callback after it has already settled', async () => {
    let succeed: PositionCallback | undefined;
    const p = getCurrentPosition({
      geolocation: {
        getCurrentPosition: (ok: PositionCallback, err?: PositionErrorCallback | null) => {
          succeed = ok;
          err?.({ code: 1 } as GeolocationPositionError); // settles as denied first
        },
      },
      secureContext: true,
    });
    expect(await p).toEqual({ ok: false, reason: 'denied' });
    // A fix arriving afterwards must not change the already-resolved outcome.
    succeed?.(fix(-20.2, 57.7));
    expect(await p).toEqual({ ok: false, reason: 'denied' });
  });
});
