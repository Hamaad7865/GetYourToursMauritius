import { describe, expect, it } from 'vitest';
import { devLocalityOverride, localityFromCountry } from '@/lib/geo/visitor-country';

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

/* Cloudflare's header never reaches `next dev`, so the homepage's on-island row could not be seen
 * locally. The override exists for that and nothing else: a production build must ignore it, or anyone
 * could pick their own row with a query string. */
describe('devLocalityOverride', () => {
  it('lets next dev stand in for Cloudflare with ?as=island / ?as=abroad', () => {
    expect(devLocalityOverride('island', 'development')).toBe('mauritius');
    expect(devLocalityOverride('abroad', 'development')).toBe('abroad');
  });

  it('ignores anything else, and is never honoured outside development', () => {
    expect(devLocalityOverride(null, 'development')).toBeNull();
    expect(devLocalityOverride('mars', 'development')).toBeNull();
    expect(devLocalityOverride('island', 'production')).toBeNull();
    expect(devLocalityOverride('island', 'test')).toBeNull();
    expect(devLocalityOverride('island', undefined)).toBeNull();
  });
});
