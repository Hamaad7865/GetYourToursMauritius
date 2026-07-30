import { afterEach, describe, expect, it, vi } from 'vitest';
import { EUR_MUR_MAX, EUR_MUR_MIN, fetchEurMurRate, formatMur } from '@/lib/money/fx';

/**
 * The FX fetch feeds the fx_rates table the charge pin reads — a wrong rate here prices real card
 * charges. Every malformed/implausible upstream shape must collapse to null (keep last-known-good),
 * NEVER to a number: the band gate exists because an inverted payload (≈0.0185) or a USD-based one
 * (≈1.08) would survive a plain typeof check and bill customers MUR 1.85 for a €100 booking.
 */
const fresh = Math.floor(Date.now() / 1_000) - 3_600; // upstream updated an hour ago

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchEurMurRate', () => {
  const good = {
    result: 'success',
    base_code: 'EUR',
    rates: { MUR: 53.976111 },
    time_last_update_unix: fresh,
  };

  it('returns the rate + upstream timestamp on a healthy payload', async () => {
    stubFetch(good);
    const r = await fetchEurMurRate();
    expect(r).not.toBeNull();
    expect(r!.rate).toBeCloseTo(53.976111, 6);
    expect(r!.source).toBe('open.er-api.com');
    expect(r!.fetchedAt).toBe(new Date(fresh * 1_000).toISOString());
  });

  it.each([
    ['non-200 response', good, 502],
    ['result not success', { ...good, result: 'error' }, 200],
    ['wrong base currency', { ...good, base_code: 'USD' }, 200],
    ['missing MUR rate', { ...good, rates: {} }, 200],
    ['rate as a string', { ...good, rates: { MUR: '53.98' } }, 200],
    ['inverted payload (MUR→EUR)', { ...good, rates: { MUR: 0.0185 } }, 200],
    ['USD-magnitude payload', { ...good, rates: { MUR: 1.08 } }, 200],
    ['below the band', { ...good, rates: { MUR: EUR_MUR_MIN - 0.01 } }, 200],
    ['above the band', { ...good, rates: { MUR: EUR_MUR_MAX + 0.01 } }, 200],
    ['missing upstream timestamp', { ...good, time_last_update_unix: undefined }, 200],
    [
      'stale upstream timestamp (8 days)',
      { ...good, time_last_update_unix: fresh - 8 * 24 * 3_600 },
      200,
    ],
  ])('returns null on %s', async (_label, body, status) => {
    stubFetch(body, status);
    expect(await fetchEurMurRate()).toBeNull();
  });

  it('returns null (never throws) when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(fetchEurMurRate()).resolves.toBeNull();
  });

  it('band edges themselves are accepted (the gate is exclusive of the outside, not the edge)', async () => {
    stubFetch({ ...good, rates: { MUR: EUR_MUR_MIN } });
    expect((await fetchEurMurRate())?.rate).toBe(EUR_MUR_MIN);
    stubFetch({ ...good, rates: { MUR: EUR_MUR_MAX } });
    expect((await fetchEurMurRate())?.rate).toBe(EUR_MUR_MAX);
  });
});

describe('formatMur', () => {
  /** Intl group separators vary (NBSP/narrow-NBSP in fr) — normalise to plain spaces for matching. */
  const norm = (s: string): string => s.replace(/[\s  ]/g, ' ');

  it('renders minor units with the ISO code, never ₨ (WinAnsi strips U+20A8 in the PDFs)', () => {
    expect(norm(formatMur(593800))).toBe('MUR 5,938.00');
    expect(formatMur(593800)).not.toContain('₨');
  });

  it('always shows two decimals so the figure matches what Peach displays', () => {
    expect(norm(formatMur(530000))).toBe('MUR 5,300.00');
    expect(norm(formatMur(0))).toBe('MUR 0.00');
  });

  it('localises digit grouping for fr', () => {
    expect(norm(formatMur(593800, 'fr'))).toBe('MUR 5 938,00');
  });
});
