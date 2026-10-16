import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * api_enqueue_checkout_recovery (20261017000100) — ONE service email to a shopper whose web checkout
 * expired unpaid. Emailing the wrong person costs money (a paid customer told to "book again" pays
 * twice) or trust (a sequence, a staff tester, someone who opted out), so every exclusion is pinned
 * here. Called through the `p jsonb` wrapper, exactly as the maintenance cron's adapter calls it.
 */
const STAFF = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('api_enqueue_checkout_recovery', () => {
  let db: TestDb;
  let activityId: string;
  let optionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'bmt')`);
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ((select id from operators limit 1), 'ile-aux-cerfs', 'activity', 'Ile aux Cerfs',
                 'Sightseeing tours', 'published', 'per_person') returning id`,
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [activityId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.asOwner();
    await db.pg.exec(`
      delete from notification_outbox;
      delete from checkout_recovery_emails;
      delete from email_suppressions;
      delete from payment_events;
      delete from payments;
      delete from booking_items;
      delete from bookings;
      update business_settings set checkout_recovery_enabled_at = now() - interval '7 days';
    `);
  });

  /** An expired web booking. `ago`/`startsIn` are SQL interval literals. */
  async function expired(opts: {
    email: string;
    ago?: string;
    startsIn?: string;
    status?: string;
    userId?: string;
  }): Promise<string> {
    const id = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, source, customer_name, customer_email, total_minor, currency, user_id, created_at)
         values ($1, $2, 'web', 'Sam', $3, 15000, 'EUR', $4, now() - $5::interval) returning id`,
        [
          `BMT${Math.random().toString(36).slice(2, 15).toUpperCase()}`,
          opts.status ?? 'expired',
          opts.email,
          opts.userId ?? null,
          opts.ago ?? '3 hours',
        ],
      )
    ).rows[0]!.id;
    const occ = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, (select operator_id from activities where id = $2), now() + $3::interval,
                 now() + $3::interval + interval '4 hours', 10, 'open') returning id`,
        [optionId, activityId, opts.startsIn ?? '3 days'],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 15000, 15000)`,
      [id, occ, optionId],
    );
    return id;
  }

  async function enqueue(): Promise<number> {
    await db.as({ role: 'service_role' });
    const n = await call<number>(db, 'api_enqueue_checkout_recovery', {});
    await db.asOwner();
    return n;
  }

  async function recipients(): Promise<string[]> {
    const { rows } = await db.pg.query<{ recipient: string }>(
      `select recipient from notification_outbox where template = 'checkout_recovery' order by recipient`,
    );
    return rows.map((r) => r.recipient);
  }

  it('sends nothing while switched off', async () => {
    await db.pg.exec(`update business_settings set checkout_recovery_enabled_at = null`);
    await expired({ email: 'a@example.com' });
    expect(await enqueue()).toBe(0);
  });

  it('emails an eligible shopper once, with the activity and an opt-out token', async () => {
    await expired({ email: 'a@example.com' });
    expect(await enqueue()).toBe(1);
    const { rows } = await db.pg.query<{ payload: Record<string, unknown> }>(
      `select payload from notification_outbox where template = 'checkout_recovery'`,
    );
    expect(rows[0]!.payload).toMatchObject({
      activitySlug: 'ile-aux-cerfs',
      activityTitle: 'Ile aux Cerfs',
      customerName: 'Sam',
    });
    expect(String(rows[0]!.payload.token)).toHaveLength(64);
    // A second tick never repeats it.
    expect(await enqueue()).toBe(0);
  });

  it('respects the 2-hour to 24-hour window and the enable floor', async () => {
    await expired({ email: 'too-fresh@example.com', ago: '1 hour' });
    await expired({ email: 'too-old@example.com', ago: '30 hours' });
    await db.pg.exec(
      `update business_settings set checkout_recovery_enabled_at = now() - interval '5 hours'`,
    );
    await expired({ email: 'before-enable@example.com', ago: '6 hours' });
    expect(await enqueue()).toBe(0);
  });

  it('never emails when money may have moved', async () => {
    const paid = await expired({ email: 'paid@example.com' });
    const review = await expired({ email: 'review@example.com' });
    await db.pg.query(
      `insert into payments (booking_id, idempotency_key, provider, amount_minor, currency, status, paid_minor)
       values ($1, 'k-paid', 'peach', 15000, 'EUR', 'failed', 15000)`,
      [paid],
    );
    await db.pg.query(
      `insert into payments (booking_id, idempotency_key, provider, amount_minor, currency, status, settlement_review_at)
       values ($1, 'k-review', 'peach', 15000, 'EUR', 'pending', now())`,
      [review],
    );
    expect(await enqueue()).toBe(0);
  });

  it('skips staff testers, people who booked again, and dates too close to reach', async () => {
    await expired({ email: 'staff@example.com', userId: STAFF });
    await expired({ email: 'rebooked@example.com' });
    await expired({ email: 'rebooked@example.com', ago: '1 hour', status: 'confirmed' });
    await expired({ email: 'soon@example.com', startsIn: '6 hours' });
    expect(await enqueue()).toBe(0);
  });

  it('sends ONE email per person — the latest attempt — and none again within 30 days', async () => {
    await expired({ email: 'Multi@Example.com', ago: '5 hours' });
    await expired({ email: 'multi@example.com', ago: '4 hours' });
    await expired({ email: 'multi@example.com', ago: '3 hours' });
    expect(await enqueue()).toBe(1);
    expect(await recipients()).toEqual(['multi@example.com']);
  });

  it('honours the opt-out link', async () => {
    await expired({ email: 'first@example.com' });
    await enqueue();
    const { rows } = await db.pg.query<{ token: string }>(
      `select token from checkout_recovery_emails`,
    );
    await db.as({ role: 'service_role' });
    expect(await call(db, 'api_checkout_recovery_opt_out', { token: rows[0]!.token })).toEqual({
      ok: true,
    });
    expect(await call(db, 'api_checkout_recovery_opt_out', { token: 'nope' })).toEqual({
      ok: false,
    });
    await db.asOwner();
    // 31 days later the 30-day cap no longer applies — the suppression still does.
    await db.pg.exec(`update checkout_recovery_emails set created_at = now() - interval '31 days'`);
    await expired({ email: 'first@example.com', ago: '2 hours 30 minutes' });
    expect(await enqueue()).toBe(0);
  });

  it('is closed to anon and authenticated', async () => {
    const { rows } = await db.pg.query<Record<string, boolean>>(`
      select
        has_table_privilege('anon', 'checkout_recovery_emails', 'select') as anon_read,
        has_table_privilege('authenticated', 'email_suppressions', 'insert') as auth_write,
        has_function_privilege('anon', 'api_enqueue_checkout_recovery(jsonb)', 'execute') as anon_enq,
        has_function_privilege('authenticated', 'api_checkout_recovery_opt_out(jsonb)', 'execute') as auth_opt
    `);
    expect(rows[0]).toEqual({
      anon_read: false,
      auth_write: false,
      anon_enq: false,
      auth_opt: false,
    });
  });
});
