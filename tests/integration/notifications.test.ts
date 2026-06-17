import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

type Claimed = Array<{ id: string }>;

describe('notification drain lease (F4: no double-send)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  const claim = async (limit = 10): Promise<Claimed> =>
    (
      await db.pg.query<{ data: Claimed }>(`select claim_notifications($1::jsonb) as data`, [
        JSON.stringify({ limit }),
      ])
    ).rows[0]!.data;

  const mark = (id: string, result: 'sent' | 'failed', error?: string) =>
    db.pg.query(`select mark_notification($1::jsonb)`, [JSON.stringify({ id, result, error })]);

  it('a claimed row is leased — a concurrent drain cannot re-claim and re-send it', async () => {
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, payload, idempotency_key)
       values ('email', 'guest@x.com', 'booking_confirmation', '{}'::jsonb, 'lease-row-1')`,
    );

    const first = await claim();
    expect(first).toHaveLength(1);

    // A second drain in the lease window must see nothing (the row is leased, not still 'pending').
    const second = await claim();
    expect(second).toHaveLength(0);

    // The lease is recorded and the row is still pending (send hasn't completed yet).
    const row = (
      await db.pg.query<{ status: string; locked_until: string | null }>(
        `select status, locked_until from notification_outbox where idempotency_key = 'lease-row-1'`,
      )
    ).rows[0]!;
    expect(row.status).toBe('pending');
    expect(row.locked_until).not.toBeNull();

    // Completing the send marks it sent and clears the lease.
    await mark(first[0]!.id, 'sent');
    const done = (
      await db.pg.query<{ status: string; locked_until: string | null }>(
        `select status, locked_until from notification_outbox where idempotency_key = 'lease-row-1'`,
      )
    ).rows[0]!;
    expect(done.status).toBe('sent');
    expect(done.locked_until).toBeNull();
  });

  it('a failed send clears the lease so the row can be retried', async () => {
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, payload, idempotency_key)
       values ('email', 'retry@x.com', 'booking_confirmation', '{}'::jsonb, 'lease-row-2')`,
    );
    const claimed = await claim();
    const id = claimed.find(() => true)!.id;
    await mark(id, 'failed', 'smtp timeout');

    const row = (
      await db.pg.query<{ status: string; attempts: number; locked_until: string | null }>(
        `select status, attempts, locked_until from notification_outbox where idempotency_key = 'lease-row-2'`,
      )
    ).rows[0]!;
    expect(row.status).toBe('pending'); // back to pending (attempts < 5)
    expect(row.locked_until).toBeNull(); // lease cleared → immediately reclaimable
    expect(row.attempts).toBe(1);
  });
});
