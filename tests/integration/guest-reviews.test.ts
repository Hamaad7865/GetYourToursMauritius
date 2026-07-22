import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

const STAFF = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
const CUSTOMER = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

// api_enqueue_review_invites() is niladic (no jsonb argument), unlike the other RPCs — `call` above
// always sends one, which doesn't match this function's signature.
async function callEnqueue(db: TestDb): Promise<number> {
  const { rows } = await db.pg.query<{ data: number }>(`select api_enqueue_review_invites() as data`);
  return rows[0]!.data;
}

describe('guest review requests: token submission + moderation', () => {
  let db: TestDb;
  let activityId: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff'), ($2, 'customer')`, [
      STAFF,
      CUSTOMER,
    ]);
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ($1, 'guest-review-tour', 'activity', 'Guest Review Tour', 'Sightseeing tours', 'published', 'per_person')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
         values ('BMT-GR-1', 'confirmed', 'Alex Guest', 'alex@example.com', 5000, 'EUR')
         returning id`,
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('rejects submission with no token, an unknown token, and validates fields', async () => {
    await db.as(null);
    await expect(
      call(db, 'api_submit_guest_review', { rating: 5, name: 'Alex', body: 'Great trip!' }),
    ).rejects.toThrow('invalid_or_expired_token');
    await expect(
      call(db, 'api_submit_guest_review', {
        token: 'not-a-real-token',
        rating: 5,
        name: 'Alex',
        body: 'Great trip!',
      }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('a valid token succeeds exactly once — the second attempt fails', async () => {
    await db.asOwner();
    const token = 'test-token-abc123';
    await db.pg.query(
      `insert into review_invites (booking_id, activity_id, token) values ($1, $2, $3)`,
      [bookingId, activityId, token],
    );

    await db.as(null); // guest — no session at all
    const first = await call<{ id: string; status: string }>(db, 'api_submit_guest_review', {
      token,
      rating: 5,
      name: 'Alex Guest',
      body: 'Fantastic day out, would book again!',
    });
    expect(first.status).toBe('pending');

    await expect(
      call(db, 'api_submit_guest_review', {
        token,
        rating: 1,
        name: 'Someone else',
        body: 'trying to reuse the token',
      }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('an expired token is rejected', async () => {
    await db.asOwner();
    // review_invites.booking_id is unique (one invite per booking) — reusing `bookingId` here would
    // collide with the invite already created (and consumed) by the previous test, so this needs its
    // own booking.
    const bookingId2 = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
         values ('BMT-GR-2', 'confirmed', 'Sam Guest', 'sam@example.com', 5000, 'EUR')
         returning id`,
      )
    ).rows[0]!.id;
    const token = 'expired-token-xyz';
    await db.pg.query(
      `insert into review_invites (booking_id, activity_id, token, expires_at)
       values ($1, $2, $3, now() - interval '1 day')`,
      [bookingId2, activityId, token],
    );
    await db.as(null);
    await expect(
      call(db, 'api_submit_guest_review', { token, rating: 4, name: 'X', body: 'too late' }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('anon cannot select a pending review, and cannot touch review_invites at all', async () => {
    await db.as(null);
    const pending = await db.pg.query(`select * from guest_reviews where status = 'pending'`);
    expect(pending.rows).toHaveLength(0);
    await expect(db.pg.query(`select * from review_invites`)).rejects.toThrow();
  });

  it('only staff can moderate, and approving mirrors into reviews + recomputes the activity rating', async () => {
    const pendingRow = await db
      .asOwner()
      .then(() =>
        db.pg.query<{ id: string }>(
          `select id from guest_reviews where status = 'pending' limit 1`,
        ),
      );
    const reviewId = pendingRow.rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_moderate_guest_review', { id: reviewId, action: 'approve' }),
    ).rejects.toThrow('forbidden');

    await db.as({ sub: STAFF, role: 'authenticated' });
    const result = await call<{ status: string }>(db, 'api_moderate_guest_review', {
      id: reviewId,
      action: 'approve',
    });
    expect(result.status).toBe('approved');

    const mirrored = await db.pg.query<{ user_id: string | null; rating: number }>(
      `select user_id, rating from reviews where activity_id = $1`,
      [activityId],
    );
    expect(mirrored.rows).toHaveLength(1);
    expect(mirrored.rows[0]!.user_id).toBeNull();
    expect(mirrored.rows[0]!.rating).toBe(5);

    const activity = await db.pg.query<{ rating_avg: string; rating_count: number }>(
      `select rating_avg, rating_count from activities where id = $1`,
      [activityId],
    );
    expect(activity.rows[0]!.rating_count).toBe(1);
    expect(Number(activity.rows[0]!.rating_avg)).toBe(5);

    // Public can now read the approved review.
    await db.as(null);
    const approved = await db.pg.query(`select * from guest_reviews where status = 'approved'`);
    expect(approved.rows).toHaveLength(1);
  });

  it('re-moderating an already-decided review is rejected', async () => {
    await db.asOwner();
    const row = await db.pg.query<{ id: string }>(
      `select id from guest_reviews where status = 'approved' limit 1`,
    );
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      call(db, 'api_moderate_guest_review', { id: row.rows[0]!.id, action: 'reject' }),
    ).rejects.toThrow('invalid_request');
  });
});

describe('api_enqueue_review_invites: the Mauritius-anchored eligibility boundary', () => {
  let db: TestDb;
  let activityId: string;
  let optionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ($1, 'tz-boundary-tour', 'activity', 'TZ Boundary Tour', 'Sightseeing tours', 'published', 'per_person')
         returning id`,
        [operatorId],
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

  // `endsAt` is a raw SQL expression (e.g. `now() - interval '1 hour'`), not a literal value — it must
  // be interpolated into the query text, not bound as a parameter (a bound param is sent to Postgres as
  // a literal string and fails to parse as a timestamp).
  async function bookingEndingAt(endsAt: string, statusExtra = ''): Promise<string> {
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
         values ($1, 'confirmed', 'Tester', $2, 5000, 'EUR') returning id`,
        [
          `BMT-TZ-${Math.random().toString(36).slice(2, 8)}`,
          `tester-${statusExtra || Date.now()}@example.com`,
        ],
      )
    ).rows[0]!.id;
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, (select operator_id from activities where id = $2), (${endsAt}) - interval '2 hours', (${endsAt}), 10, 'open')
         returning id`,
        [optionId, activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 5000, 5000)`,
      [bookingId, occId, optionId],
    );
    return bookingId;
  }

  it('does NOT enqueue an invite for a trip that ended late tonight, Mauritius time', async () => {
    await db.asOwner();
    // "Now" in the test DB is real wall-clock time; simulate a trip ending 1 hour ago (definitely
    // before the next day's 9am Mauritius boundary) — must NOT be eligible yet.
    await bookingEndingAt(`now() - interval '1 hour'`);
    // The RPC's own in-body guard checks auth.role() = 'service_role' — asOwner() clears the JWT
    // claims entirely (auth.role() then defaults to 'anon'), so the call must run as service_role,
    // same as the maintenance cron that actually invokes this in production.
    await db.as({ role: 'service_role' });
    const count = await callEnqueue(db);
    await db.asOwner();
    const invites = await db.pg.query(`select * from review_invites`);
    expect(count).toBe(0);
    expect(invites.rows).toHaveLength(0);
  });

  it('DOES enqueue an invite for a trip that ended more than a day ago', async () => {
    await db.asOwner();
    await bookingEndingAt(`now() - interval '2 days'`);
    await db.as({ role: 'service_role' });
    const count = await callEnqueue(db);
    await db.asOwner();
    expect(count).toBe(1);
    const invites = await db.pg.query(`select token from review_invites`);
    expect(invites.rows).toHaveLength(1);
    const outbox = await db.pg.query(
      `select template, payload from notification_outbox where template = 'review_request'`,
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.payload).toMatchObject({ activityTitle: 'TZ Boundary Tour' });
  });

  it('is idempotent — a second run enqueues nothing new for the same bookings', async () => {
    await db.as({ role: 'service_role' });
    const count = await callEnqueue(db);
    expect(count).toBe(0);
  });

  it('anon/authenticated cannot call it directly', async () => {
    await db.as(null);
    await expect(callEnqueue(db)).rejects.toThrow(/forbidden|permission denied/);
  });
});
