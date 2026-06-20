import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

// Inject a PGlite-backed ServiceContext into the route handlers (same pattern as api-routes.test.ts).
vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return { buildServiceContext: () => mod.requireRouteContext() };
});

const { POST: tripPlannerPost } = await import('../../app/api/ai/trip-planner/route');

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

/**
 * P0 (wallet-DoS): the generic per-IP limiter (api_rate_limit) that the public AI/planner routes share,
 * proven two ways — the RPC directly (the contract every route relies on), and end-to-end through the
 * trip-planner route handler (route → rateLimit → enforceRateLimit → RPC → rate_limited → 429).
 */
describe('P0: generic per-IP rate limit (api_rate_limit)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const hit = (bucket: string, ip: string | null, limit = 3, windowSeconds = 60) =>
    db.pg.query(`select api_rate_limit($1::jsonb) as data`, [
      JSON.stringify({ bucket, ip, limit, windowSeconds }),
    ]);

  it('allows up to the limit, then raises rate_limited on the (N+1)th call', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expect(hit('ai:trip-planner', '203.0.113.10')).resolves.toBeDefined();
    }
    await expect(hit('ai:trip-planner', '203.0.113.10')).rejects.toThrow(/rate_limited/);
  });

  it('keys on (bucket, ip): a different IP and a different bucket each get their own budget', async () => {
    // Exhaust one IP on one bucket.
    for (let i = 0; i < 3; i += 1) await hit('planner:places', '198.51.100.1');
    await expect(hit('planner:places', '198.51.100.1')).rejects.toThrow(/rate_limited/);
    // A different IP on the same bucket is unaffected.
    await expect(hit('planner:places', '198.51.100.2')).resolves.toBeDefined();
    // The same IP on a different bucket is unaffected (buckets don't share a budget).
    await expect(hit('planner:optimize', '198.51.100.1')).resolves.toBeDefined();
  });

  it('does not throttle when no IP is supplied (server-side / unknown client)', async () => {
    for (let i = 0; i < 10; i += 1) {
      await expect(hit('ai:place-insights', null)).resolves.toBeDefined();
    }
  });

  it('resets in a later window (fixed-window counter)', async () => {
    for (let i = 0; i < 3; i += 1) await hit('w:test', '192.0.2.50', 3, 60);
    await expect(hit('w:test', '192.0.2.50', 3, 60)).rejects.toThrow(/rate_limited/);
    // 61s later the floored window boundary advances → a fresh counter.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    try {
      await expect(hit('w:test', '192.0.2.50', 3, 60)).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a call with no bucket (programming error)', async () => {
    await expect(hit('', '203.0.113.99')).rejects.toThrow(/invalid_request/);
  });
});

describe('P0: trip-planner route returns 429 after its per-IP limit', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(), // no Gemini model → graceful fallback, zero billed calls
      now: () => new Date(),
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  const call = (ip: string) =>
    tripPlannerPost(
      new Request('http://localhost/api/ai/trip-planner', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'plan my day' }] }),
      }),
    );

  it('serves the first 15 requests, then 429s the 16th from the same IP', async () => {
    for (let i = 0; i < 15; i += 1) {
      const res = await call('203.0.113.200');
      expect(res.status).toBe(200);
    }
    const limited = await call('203.0.113.200');
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('rate_limited');
  });

  it('does not throttle a different IP', async () => {
    const res = await call('203.0.113.201');
    expect(res.status).toBe(200);
  });
});
