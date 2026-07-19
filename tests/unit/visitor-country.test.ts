import { describe, expect, it } from 'vitest';
import { localityFromCountry } from '@/lib/geo/visitor-country';

/* This gate decides only whether to OFFER a Mauritius-only affordance. It must never be the thing
 * that decides a coordinate is acceptable — that's isInMauritius() on the real fix. Hence the
 * deliberate fail-open on 'unknown': losing the header should not silently kill the feature. */

describe('localityFromCountry', () => {
  it('recognises Mauritius', () => {
    expect(localityFromCountry('MU')).toBe('mauritius');
    expect(localityFromCountry('mu')).toBe('mauritius');
    expect(localityFromCountry(' MU ')).toBe('mauritius');
  });

  it('treats any other country as abroad — the case the feature exists for', () => {
    expect(localityFromCountry('FR')).toBe('abroad');
    expect(localityFromCountry('GB')).toBe('abroad');
    expect(localityFromCountry('RE')).toBe('abroad'); // Réunion, the near neighbour
    expect(localityFromCountry('ZA')).toBe('abroad');
  });

  it('is unknown when the header is missing (local dev / not behind Cloudflare)', () => {
    expect(localityFromCountry(null)).toBe('unknown');
    expect(localityFromCountry(undefined)).toBe('unknown');
    expect(localityFromCountry('')).toBe('unknown');
    expect(localityFromCountry('   ')).toBe('unknown');
  });

  it("is unknown for Cloudflare's own can't-tell codes", () => {
    expect(localityFromCountry('XX')).toBe('unknown'); // undeterminable
    expect(localityFromCountry('T1')).toBe('unknown'); // Tor exit node
  });
});
