import { describe, expect, it } from 'vitest';
import { assertWorkerLive } from '../../scripts/release/verify-worker-liveness.mjs';

const SHA = 'c5fcdfaf1e10c351d5905484b72a0e3cf1cd9e4d';
const LIVE_BODY = {
  status: 'alive',
  releaseSha: SHA,
  releaseRunId: '29934529090',
  internalTaskSecretConfigured: true,
  siteUrl: 'https://bellemaretours.com',
};

describe('release/verify-worker-liveness assertWorkerLive', () => {
  it('accepts a Worker reporting the expected release', () => {
    expect(assertWorkerLive(LIVE_BODY, SHA)).toEqual([]);
  });

  // The exact failure that broke a real release: `wrangler deploy` returned, but the edge was still
  // serving the PREVIOUS version for a few seconds. The assertion must reject it (so the caller's
  // bounded retry keeps polling) rather than pass it through.
  it('rejects a stale SHA from a not-yet-propagated deploy', () => {
    const stale = { ...LIVE_BODY, releaseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    expect(assertWorkerLive(stale, SHA).some((e) => e.includes('releaseSha'))).toBe(true);
  });

  it('rejects a Worker whose internal task secret is missing', () => {
    const body = { ...LIVE_BODY, internalTaskSecretConfigured: false };
    expect(
      assertWorkerLive(body, SHA).some((e) => e.includes('internalTaskSecretConfigured')),
    ).toBe(true);
  });

  it('rejects a non-alive status', () => {
    expect(
      assertWorkerLive({ ...LIVE_BODY, status: 'down' }, SHA).some((e) => e.includes('status')),
    ).toBe(true);
  });

  it('handles a malformed body without throwing', () => {
    expect(assertWorkerLive(null, SHA).length).toBeGreaterThan(0);
  });
});
