import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

// Inject a PGlite-backed ServiceContext into the route handlers.
vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return { buildServiceContext: () => mod.requireRouteContext() };
});

const { GET: activitiesGet } = await import('../../app/api/v1/activities/route');
const { GET: activityGet } = await import('../../app/api/v1/activities/[slug]/route');
const { POST: bookingsPost } = await import('../../app/api/v1/bookings/route');
const { GET: bookingGet } = await import('../../app/api/v1/bookings/[ref]/route');
const { POST: leadsPost } = await import('../../app/api/v1/leads/route');
const { GET: healthGet } = await import('../../app/api/v1/health/route');

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

async function mintToken(sub = 'route-user'): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

describe('/api/v1 routes', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    });
    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    occurrenceId = rows[0]!.id;
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  it('GET /activities is public and returns a paginated envelope', async () => {
    const res = await activitiesGet(new Request('http://localhost/api/v1/activities?pageSize=3'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.meta.total).toBe(catalogue.activities.length);
  });

  it('GET /activities rejects an invalid token with 401', async () => {
    const res = await activitiesGet(
      new Request('http://localhost/api/v1/activities', {
        headers: { authorization: 'Bearer not-a-real-token' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('GET /activities/:slug returns detail (and 404 for unknown)', async () => {
    const ok = await activityGet(new Request('http://localhost/x'), {
      params: Promise.resolve({ slug: 'private-south-tour-with-pickup' }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.slug).toBe('private-south-tour-with-pickup');

    const missing = await activityGet(new Request('http://localhost/x'), {
      params: Promise.resolve({ slug: 'nope' }),
    });
    expect(missing.status).toBe(404);
  });

  it('POST /bookings creates a booking (201), accepting a null itinerary/pickup; validates input (400)', async () => {
    const ok = await bookingsPost(
      new Request('http://localhost/api/v1/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occurrenceId,
          party: { 'Private group': 1 },
          // The checkout always sends these as null when there's no custom route / pickup. The schema
          // must accept null (nullish), not just omitted — `.optional()` alone 400s on an explicit null.
          itinerary: null,
          pickupLocation: null,
          customer: { name: 'Route Test', email: 'route@example.com' },
          idempotencyKey: 'route-book-1',
        }),
      }),
    );
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.data.status).toBe('payment_pending');
    expect(body.data.totalEur).toBe(110);

    const bad = await bookingsPost(
      new Request('http://localhost/api/v1/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ occurrenceId: 'not-a-uuid', party: {}, customer: {} }),
      }),
    );
    expect(bad.status).toBe(400);
  });

  it('GET /bookings/:ref requires authentication', async () => {
    const res = await bookingGet(new Request('http://localhost/x'), {
      params: Promise.resolve({ ref: 'BMT-XXXX' }),
    });
    expect(res.status).toBe(401);

    const token = await mintToken();
    const authed = await bookingGet(
      new Request('http://localhost/x', { headers: { authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ ref: 'BMT-DOESNOTEXIST' }) },
    );
    expect(authed.status).toBe(404); // authenticated but no such booking
  });

  it('GET /health reports ok (shallow, non-live env)', async () => {
    const res = await healthGet(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.checks.paymentsSafe).toBe(true);
  });

  it('POST /leads captures a lead (201)', async () => {
    const res = await leadsPost(
      new Request('http://localhost/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Curious', contact: 'curious@example.com' }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('new');
  });
});
