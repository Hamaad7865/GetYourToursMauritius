import { describe, expect, it } from 'vitest';
import {
  MAURITIUS_BOUNDS,
  MAURITIUS_COUNTRY,
  MAURITIUS_RECT,
  isInMauritius,
} from '@/lib/geo/mauritius';

/* This containment test gates whether a visitor's GPS fix may become the pick-up address on a real
 * booking, so its failure mode is a driver sent to the wrong place. It must reject anything it isn't
 * certain about. */

describe('isInMauritius', () => {
  it('accepts real places on the island', () => {
    expect(isInMauritius(-20.205, 57.76)).toBe(true); // Belle Mare (our base)
    expect(isInMauritius(-20.1609, 57.5012)).toBe(true); // Port Louis
    expect(isInMauritius(-20.4302, 57.6836)).toBe(true); // SSR Airport
    expect(isInMauritius(-20.006, 57.58)).toBe(true); // Grand Baie
    expect(isInMauritius(-20.456, 57.312)).toBe(true); // Le Morne
  });

  it('rejects other countries — the case the whole feature exists for', () => {
    expect(isInMauritius(48.8566, 2.3522)).toBe(false); // Paris
    expect(isInMauritius(51.5072, -0.1276)).toBe(false); // London
    expect(isInMauritius(-20.8907, 55.4551)).toBe(false); // Réunion — near, still not us
    expect(isInMauritius(-18.8792, 47.5079)).toBe(false); // Antananarivo
    expect(isInMauritius(-4.6796, 55.492)).toBe(false); // Seychelles
  });

  it('rejects Rodrigues — Mauritian, but not a pick-up we can serve', () => {
    expect(isInMauritius(-19.6833, 63.4167)).toBe(false);
  });

  it('rejects the null island and other zero-ish fixes', () => {
    expect(isInMauritius(0, 0)).toBe(false);
  });

  it('rejects non-finite coordinates instead of letting them through a comparison', () => {
    expect(isInMauritius(NaN, 57.5)).toBe(false);
    expect(isInMauritius(-20.2, NaN)).toBe(false);
    expect(isInMauritius(Infinity, 57.5)).toBe(false);
    expect(isInMauritius(-20.2, -Infinity)).toBe(false);
  });

  it('is inclusive exactly at the boundary', () => {
    const { minLat, maxLat, minLng, maxLng } = MAURITIUS_BOUNDS;
    expect(isInMauritius(minLat, minLng)).toBe(true);
    expect(isInMauritius(maxLat, maxLng)).toBe(true);
    expect(isInMauritius(minLat - 0.0001, minLng)).toBe(false);
    expect(isInMauritius(maxLat + 0.0001, maxLng)).toBe(false);
  });
});

describe('shared constants', () => {
  it('derives the Places rectangle from the same numbers (no drift)', () => {
    expect(MAURITIUS_RECT.low.latitude).toBe(MAURITIUS_BOUNDS.minLat);
    expect(MAURITIUS_RECT.low.longitude).toBe(MAURITIUS_BOUNDS.minLng);
    expect(MAURITIUS_RECT.high.latitude).toBe(MAURITIUS_BOUNDS.maxLat);
    expect(MAURITIUS_RECT.high.longitude).toBe(MAURITIUS_BOUNDS.maxLng);
  });

  it('uses the ISO country code Cloudflare reports', () => {
    expect(MAURITIUS_COUNTRY).toBe('MU');
  });
});
