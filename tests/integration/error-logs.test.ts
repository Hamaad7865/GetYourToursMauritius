import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * error_logs (20260831000000) — the table behind `select * from error_logs order by created_at desc`.
 *
 * Half of its input is attacker-controlled: anyone on the internet can POST to /api/v1/client-errors,
 * so every clamp is enforced in SQL rather than trusted from the caller. And because api_log_error is
 * called from inside catch blocks, it must NORMALISE bad input instead of raising — a logging call
 * that throws would convert a handled 500 into an unhandled one.
 */
describe('error_logs', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.asOwner();
    await db.pg.exec('delete from error_logs');
  });

  const logError = async (payload: Record<string, unknown>): Promise<void> => {
    await db.pg.query('select api_log_error($1::jsonb)', [JSON.stringify(payload)]);
  };

  const rows = async <T>(sql: string): Promise<T[]> => {
    const { rows } = await db.pg.query<T>(sql);
    return rows;
  };

  it('stores a failure and hands it back newest-first', async () => {
    await logError({ source: 'api', event: 'unhandled_api_error', message: 'first' });
    await logError({ source: 'browser', event: 'client_error', message: 'second' });

    const found = await rows<{ message: string; source: string }>(
      'select message, source from error_logs order by created_at desc, message desc',
    );
    expect(found.map((r) => r.message)).toEqual(['second', 'first']);
    expect(found[0]!.source).toBe('browser');
  });

  it('keeps every field the operator triages on', async () => {
    await logError({
      source: 'api',
      event: 'unhandled_api_error',
      message: 'cannot read x of undefined',
      errorName: 'TypeError',
      stack: 'TypeError: cannot read x\n  at handler',
      route: '/api/v1/bookings',
      method: 'POST',
      status: 500,
      requestId: 'req-123',
      userAgent: 'Mozilla/5.0',
      context: { code: 'internal_error' },
    });

    const [row] = await rows<Record<string, unknown>>('select * from error_logs');
    expect(row).toMatchObject({
      event: 'unhandled_api_error',
      error_name: 'TypeError',
      route: '/api/v1/bookings',
      method: 'POST',
      status: 500,
      request_id: 'req-123',
      user_agent: 'Mozilla/5.0',
    });
    expect(row!.context).toEqual({ code: 'internal_error' });
  });

  it('normalises rather than raises — bad input still produces a row', async () => {
    // Every one of these would raise if the function trusted its payload: an unknown enum value
    // against the CHECK, a non-numeric status against ::int, a missing message against NOT NULL.
    await logError({ source: 'martian', event: '', message: '', status: 'five hundred' });

    const [row] = await rows<{ source: string; event: string; message: string; status: number }>(
      'select source, event, message, status from error_logs',
    );
    expect(row).toMatchObject({
      source: 'api',
      event: 'unknown',
      message: '(no message)',
      status: null,
    });
  });

  it('clamps oversized fields so one runaway report cannot bloat the table', async () => {
    await logError({
      source: 'browser',
      event: 'e'.repeat(500),
      message: 'm'.repeat(10_000),
      stack: 's'.repeat(50_000),
      context: { blob: 'x'.repeat(20_000) },
    });

    const [row] = await rows<{
      event: string;
      message: string;
      stack: string;
      context: { truncated?: boolean };
    }>('select event, message, stack, context from error_logs');
    expect(row!.event).toHaveLength(100);
    expect(row!.message).toHaveLength(2_000);
    expect(row!.stack).toHaveLength(8_000);
    // The row stays useful (message/stack/route are the triage fields); only the blob is dropped.
    expect(row!.context.truncated).toBe(true);
  });

  it('ignores a context that is not an object', async () => {
    await logError({ source: 'api', event: 'x', message: 'y', context: 'not-an-object' });
    const [row] = await rows<{ context: unknown }>('select context from error_logs');
    expect(row!.context).toBeNull();
  });

  it('is unreadable and unwritable by anon and authenticated', async () => {
    await db.asOwner();
    await logError({ source: 'api', event: 'secret', message: 'internal detail' });

    // The table holds unredacted internal detail (which env var is missing, which upstream failed),
    // so a leaked anon key must get nothing — grants revoked AND RLS on with no policies.
    for (const claims of [null, { sub: '11111111-1111-1111-1111-111111111111' }]) {
      await db.as(claims);
      await expect(db.pg.query('select * from error_logs')).rejects.toThrow();
      await expect(
        db.pg.query(`select api_log_error('{"event":"x","message":"y"}'::jsonb)`),
      ).rejects.toThrow();
      await expect(db.pg.query(`select api_purge_error_logs('{}'::jsonb)`)).rejects.toThrow();
    }
    await db.asOwner();
  });

  it('lets service_role write and read (the app and the operator)', async () => {
    await db.as({ role: 'service_role' });
    await db.pg.query(`select api_log_error('{"event":"e","message":"m"}'::jsonb)`);
    const { rows } = await db.pg.query<{ n: number }>('select count(*)::int as n from error_logs');
    expect(rows[0]!.n).toBe(1);
    await db.asOwner();
  });
});

describe('api_purge_error_logs', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.asOwner();
    await db.pg.exec('delete from error_logs');
  });

  const count = async (): Promise<number> => {
    const { rows } = await db.pg.query<{ n: number }>('select count(*)::int as n from error_logs');
    return rows[0]!.n;
  };

  it('drops rows past the retention window and keeps the rest', async () => {
    await db.pg.exec(`
      insert into error_logs (source, event, message, created_at) values
        ('api', 'old', 'from last quarter', now() - interval '95 days'),
        ('api', 'old', 'from last month',   now() - interval '31 days'),
        ('api', 'new', 'yesterday',         now() - interval '1 day')
    `);

    const { rows } = await db.pg.query<{ purge: { deleted: number; aged: number } }>(
      `select api_purge_error_logs('{"days":30}'::jsonb) as purge`,
    );
    expect(rows[0]!.purge).toMatchObject({ deleted: 2, aged: 2 });

    const kept = await db.pg.query<{ message: string }>('select message from error_logs');
    expect(kept.rows.map((r) => r.message)).toEqual(['yesterday']);
  });

  it('enforces the row cap so a crash loop cannot make the table unusable', async () => {
    // The cap clamps to a 1000 floor, so a real overflow is what gets exercised here. A single broken
    // page hit by a crawler can write more rows in an hour than a month of normal operation.
    await db.pg.exec(`
      insert into error_logs (source, event, message, created_at)
      select 'api', 'loop', 'crash ' || i, now() - (i * interval '1 second')
        from generate_series(1, 1005) as i
    `);

    const { rows } = await db.pg.query<{ purge: { overflow: number } }>(
      `select api_purge_error_logs('{"days":365,"maxRows":1000}'::jsonb) as purge`,
    );
    expect(rows[0]!.purge.overflow).toBe(5);
    expect(await count()).toBe(1000);

    // The survivors are the NEWEST ones — the oldest five went.
    const { rows: oldest } = await db.pg.query<{ message: string }>(
      'select message from error_logs order by created_at asc limit 1',
    );
    expect(oldest[0]!.message).toBe('crash 1000');
  });

  it('is a no-op on a healthy table', async () => {
    await db.pg.exec(
      `insert into error_logs (source, event, message) values ('api', 'e', 'recent')`,
    );
    const { rows } = await db.pg.query<{ purge: { deleted: number } }>(
      `select api_purge_error_logs('{}'::jsonb) as purge`,
    );
    expect(rows[0]!.purge.deleted).toBe(0);
    expect(await count()).toBe(1);
  });
});
