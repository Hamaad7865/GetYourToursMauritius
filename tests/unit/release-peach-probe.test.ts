import { describe, expect, it } from 'vitest';
import { isSameHostAsProduction } from '../../scripts/release/peach-payment-probe.mjs';

describe('release/peach-payment-probe isSameHostAsProduction', () => {
  it('flags the probe target when it matches PRODUCTION_URL', () => {
    expect(
      isSameHostAsProduction('https://bellemaretours.com', 'https://bellemaretours.com', undefined),
    ).toBe(true);
  });

  it('flags the probe target when its host equals CANONICAL_HOST', () => {
    expect(
      isSameHostAsProduction('https://bellemaretours.com/', undefined, 'bellemaretours.com'),
    ).toBe(true);
  });

  it('allows a distinct staging host', () => {
    expect(
      isSameHostAsProduction(
        'https://staging.bellemaretours.com',
        'https://bellemaretours.com',
        'bellemaretours.com',
      ),
    ).toBe(false);
  });

  it('allows a distinct staging host when neither guard var is set', () => {
    expect(isSameHostAsProduction('https://staging.example.com', undefined, undefined)).toBe(false);
  });
});
