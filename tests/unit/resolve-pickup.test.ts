import { describe, expect, it, vi } from 'vitest';
import { needsPickupPin } from '@/lib/checkout/pickup';
import { resolvePickupText } from '@/lib/checkout/resolve-pickup';

describe('needsPickupPin', () => {
  const base = { transportPriced: true, wantsPickup: true, tbd: false, hasCoords: false };

  it('is true for a typed pickup with no pin on a transport-priced tour', () => {
    // BMTB1FD2E9A58637 (18 Nov 2026): "Anelia Resort & Spa" typed, never picked from the list — no
    // coords reached api_book, so the €30 transport add-on was silently skipped.
    expect(needsPickupPin(base)).toBe(true);
  });
  it('is false once the pickup has a pin', () => {
    expect(needsPickupPin({ ...base, hasCoords: true })).toBe(false);
  });
  it('is false for "I don’t know yet" and for no pickup', () => {
    expect(needsPickupPin({ ...base, tbd: true })).toBe(false);
    expect(needsPickupPin({ ...base, wantsPickup: false })).toBe(false);
  });
  it('is false when the tour has no coordinate-priced transport (vehicle tours, transfers)', () => {
    expect(needsPickupPin({ ...base, transportPriced: false })).toBe(false);
  });
});

describe('resolvePickupText', () => {
  const ANELIA = { lat: -20.2869, lng: 57.3637 };

  it('uses OpenStreetMap first and does not touch Google when OSM finds it', async () => {
    const google = vi.fn();
    const pin = await resolvePickupText('Anelia Resort & Spa', {
      nominatim: async () => ANELIA,
      google,
    });
    expect(pin).toEqual(ANELIA);
    expect(google).not.toHaveBeenCalled();
  });

  it('retries OSM with just the hotel name when the full address finds nothing', async () => {
    const nominatim = vi.fn(async (q: string) => (q === 'Shangri-La' ? ANELIA : null));
    const pin = await resolvePickupText(
      'Shangri-La, Belle Mare, Poste de Flacq, Flacq 41511, Mauritius',
      { nominatim, google: async () => null },
    );
    expect(pin).toEqual(ANELIA);
    expect(nominatim).toHaveBeenCalledTimes(2);
  });

  it('falls back to Google when OSM is unreachable', async () => {
    const pin = await resolvePickupText('Salt of Palmar', {
      nominatim: async () => {
        throw new Error('Nominatim 429');
      },
      google: async () => ANELIA,
    });
    expect(pin).toEqual(ANELIA);
  });

  it('rejects an off-island answer from either provider', async () => {
    const rodrigues = { lat: -19.7, lng: 63.42 };
    const pin = await resolvePickupText('Cotton Bay Lodge Xyz', {
      nominatim: async () => rodrigues,
      google: async () => rodrigues,
    });
    expect(pin).toBeNull();
  });

  it('returns null for blank text without asking anyone', async () => {
    const nominatim = vi.fn();
    const google = vi.fn();
    expect(await resolvePickupText('   ', { nominatim, google })).toBeNull();
    expect(nominatim).not.toHaveBeenCalled();
    expect(google).not.toHaveBeenCalled();
  });

  it('returns null (never throws) when every provider fails', async () => {
    const pin = await resolvePickupText('Somewhere', {
      nominatim: async () => {
        throw new Error('down');
      },
      google: async () => {
        throw new Error('403');
      },
    });
    expect(pin).toBeNull();
  });
});
