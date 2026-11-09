import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { seedOccurrence } from '../db/seed';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { homePicks } from '@/lib/services/home-picks';
import type { ServiceContext } from '@/lib/services/context';

// Inject a PGlite-backed ServiceContext into the route handler.
vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { GET: picksGet } = await import('../../app/api/v1/activities/picks/route');

/** The homepage picks reach the browser through homePicks() and GET /api/v1/activities/picks. */
describe('homePicks + GET /api/v1/activities/picks', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const seeded = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2,
         (((now() at time zone 'Indian/Mauritius')::date + 1) + time '10:00') at time zone 'Indian/Mauritius',
         (((now() at time zone 'Indian/Mauritius')::date + 1) + time '14:00') at time zone 'Indian/Mauritius',
         10)`,
      [seeded.optionId, seeded.operatorId],
    );
    slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seeded.activityId,
      ])
    ).rows[0]!.slug;
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    setRouteContext(ctx);
    await db.as(null);
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  it('the service returns the parsed picks', async () => {
    const picks = await homePicks(ctx);
    expect(picks.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(picks.freeTomorrow).toContain(slug);
    expect(Array.isArray(picks.mostBooked)).toBe(true);
  });

  it('the route serves them to anyone, cached at the edge for a minute', async () => {
    const res = await picksGet(new Request('http://localhost/api/v1/activities/picks'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.freeTomorrow).toContain(slug);
  });
});
