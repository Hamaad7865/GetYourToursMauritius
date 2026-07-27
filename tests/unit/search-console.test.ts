import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportWindow, sumMetrics, NotConnectedError } from '@/lib/seo/search-console';
import { buildJwtClaims, SEARCH_CONSOLE_SCOPE } from '@/lib/google/service-account';
import { resetServerEnvCache } from '@/lib/config/env';

/* The Search Console reader. The API itself is never called here — what's tested is the reporting
 * window (an off-by-one silently reports a window with no data), the impression-weighted totals,
 * and that a missing credential is a "not connected" state rather than a crash. */

describe('reportWindow', () => {
  it('ends 3 days back — Search Console has a processing lag, so today is always empty', () => {
    const { endDate } = reportWindow(new Date('2026-07-27T10:00:00Z'));
    expect(endDate).toBe('2026-07-24');
  });

  it('is inclusive: a 28-day window spans 28 days, not 29', () => {
    const { startDate, endDate } = reportWindow(new Date('2026-07-27T10:00:00Z'), 28);
    const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
    expect(days).toBe(28);
    expect(startDate).toBe('2026-06-27');
  });

  it('handles a 1-day window without inverting', () => {
    const { startDate, endDate } = reportWindow(new Date('2026-07-27T10:00:00Z'), 1);
    expect(startDate).toBe(endDate);
  });

  it('crosses a month boundary correctly', () => {
    const { startDate, endDate } = reportWindow(new Date('2026-03-02T10:00:00Z'), 7);
    expect(endDate).toBe('2026-02-27');
    expect(startDate).toBe('2026-02-21');
  });
});

describe('sumMetrics', () => {
  const row = (over: Partial<{ clicks: number; impressions: number; position: number }>) => ({
    key: Math.random().toString(36),
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: 0,
    ...over,
  });

  it('adds clicks and impressions', () => {
    const t = sumMetrics([
      row({ clicks: 3, impressions: 100 }),
      row({ clicks: 7, impressions: 400 }),
    ]);
    expect(t.clicks).toBe(10);
    expect(t.impressions).toBe(500);
  });

  it('derives CTR from the totals, not from an average of per-row CTRs', () => {
    const t = sumMetrics([
      row({ clicks: 1, impressions: 1 }), // 100% CTR on one impression
      row({ clicks: 0, impressions: 999 }),
    ]);
    expect(t.ctr).toBeCloseTo(1 / 1000);
  });

  it('weights average position by impressions — a 3-impression page must not sway the mean', () => {
    const t = sumMetrics([
      row({ impressions: 3, position: 2 }),
      row({ impressions: 3000, position: 40 }),
    ]);
    // A plain mean would say 21; the truth is ~39.96.
    expect(t.position).toBeGreaterThan(39);
  });

  it('reports zeroes rather than NaN when there are no impressions', () => {
    const t = sumMetrics([]);
    expect(t).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    expect(Number.isNaN(sumMetrics([row({})]).position)).toBe(false);
  });
});

describe('buildJwtClaims — Search Console scope', () => {
  it('requests read-only access, never a write scope', () => {
    const claims = buildJwtClaims('svc@proj.iam.gserviceaccount.com', 1000, SEARCH_CONSOLE_SCOPE);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    expect(claims.exp - claims.iat).toBe(3600);
  });
});

describe('fetchSearchConsoleReport — unconfigured', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    resetServerEnvCache();
    delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GSC_SITE_URL;
  });
  afterEach(() => {
    process.env = { ...OLD };
    resetServerEnvCache();
    vi.restoreAllMocks();
  });

  it('reports "not connected" instead of throwing a generic error when no account is set', async () => {
    const { fetchSearchConsoleReport } = await import('@/lib/seo/search-console');
    await expect(fetchSearchConsoleReport(new Date())).rejects.toBeInstanceOf(NotConnectedError);
  });

  it('never calls the API when unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { fetchSearchConsoleReport } = await import('@/lib/seo/search-console');
    await expect(fetchSearchConsoleReport(new Date())).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for GSC_SITE_URL when the account is present but the property is not', async () => {
    process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----\n',
    });
    resetServerEnvCache();
    const { fetchSearchConsoleReport } = await import('@/lib/seo/search-console');
    await expect(fetchSearchConsoleReport(new Date())).rejects.toThrow(/GSC_SITE_URL/);
  });
});
