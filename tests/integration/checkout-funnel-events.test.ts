import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * checkout_funnel_events (20261017000000) — what the card-payment page saw. Fed by an UNAUTHENTICATED
 * route (sendBeacon on unload can't carry a token), so the SQL writer is the real gate: it clamps and
 * drops bad input instead of raising, and only service_role may call it or read the table.
 */
describe('checkout_funnel_events', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.asOwner();
    await db.pg.exec('delete from checkout_funnel_events');
  });

  const logEvent = async (payload: Record<string, unknown>): Promise<{ ok: boolean }> => {
    const { rows } = await db.pg.query<{ r: { ok: boolean } }>(
      'select api_log_checkout_event($1::jsonb) as r',
      [JSON.stringify(payload)],
    );
    return rows[0]!.r;
  };

  it('stores an event with its device class and timing', async () => {
    const r = await logEvent({
      checkoutId: 'chk_1',
      event: 'first_input',
      msSinceMount: 4200,
      device: 'mobile',
      browser: 'safari',
      inApp: true,
    });
    expect(r.ok).toBe(true);
    const { rows } = await db.pg.query('select * from checkout_funnel_events');
    expect(rows[0]).toMatchObject({
      checkout_id: 'chk_1',
      event: 'first_input',
      ms_since_mount: 4200,
      device: 'mobile',
      browser: 'safari',
      in_app: true,
    });
  });

  it('drops an unknown event or a missing checkout id instead of raising', async () => {
    expect((await logEvent({ checkoutId: 'chk_1', event: 'drop table' })).ok).toBe(false);
    expect((await logEvent({ event: 'cancelled' })).ok).toBe(false);
    const { rows } = await db.pg.query('select count(*)::int as n from checkout_funnel_events');
    expect(rows[0]).toEqual({ n: 0 });
  });

  it('normalises junk fields rather than failing the write', async () => {
    await logEvent({
      checkoutId: 'x'.repeat(200),
      event: 'CANCELLED',
      msSinceMount: 'soon',
      device: 'toaster',
      browser: 'b'.repeat(100),
    });
    const { rows } = await db.pg.query<Record<string, unknown>>(
      'select * from checkout_funnel_events',
    );
    expect(rows[0]).toMatchObject({ event: 'cancelled', device: 'unknown', ms_since_mount: null });
    expect(String(rows[0]!.checkout_id)).toHaveLength(64);
    expect(String(rows[0]!.browser)).toHaveLength(30);
  });

  it('purges rows past the retention window', async () => {
    await logEvent({ checkoutId: 'old', event: 'cancelled', device: 'desktop' });
    await logEvent({ checkoutId: 'new', event: 'cancelled', device: 'desktop' });
    await db.pg.exec(
      "update checkout_funnel_events set created_at = now() - interval '200 days' where checkout_id = 'old'",
    );
    await db.pg.query('select api_purge_checkout_funnel_events($1::jsonb)', ['{"days":120}']);
    const { rows } = await db.pg.query<{ checkout_id: string }>(
      'select checkout_id from checkout_funnel_events',
    );
    expect(rows.map((r) => r.checkout_id)).toEqual(['new']);
  });

  it('is closed to anon and authenticated — table and both functions', async () => {
    const { rows } = await db.pg.query<Record<string, boolean>>(`
      select
        has_table_privilege('anon', 'checkout_funnel_events', 'select') as anon_read,
        has_table_privilege('authenticated', 'checkout_funnel_events', 'insert') as auth_write,
        has_function_privilege('anon', 'api_log_checkout_event(jsonb)', 'execute') as anon_log,
        has_function_privilege('authenticated', 'api_purge_checkout_funnel_events(jsonb)', 'execute') as auth_purge
    `);
    expect(rows[0]).toEqual({
      anon_read: false,
      auth_write: false,
      anon_log: false,
      auth_purge: false,
    });
  });
});
