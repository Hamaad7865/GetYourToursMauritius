import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { releasePendingBooking } from '@/lib/services/bookings';

/**
 * "Remove" on an Awaiting-payment cart line (20260917000000).
 *
 * A `payment_pending` booking holds real seats and, until this RPC, nothing the customer could
 * reach would clear it: api_cancel_booking refuses anything that is not confirmed + paid, so the
 * only exits were the 30-minute hold timer and the maintenance sweep's grace window. The cart
 * showed a "Complete payment" button and no way out — which is precisely the dead end an upstream
 * payment failure leaves the customer in.
 *
 * The rule this suite pins is that the button can only ever do what the sweep would have done a few
 * minutes later, with the SAME money guard: a booking whose payment settled while the cart was open
 * must never be releasable by a click.
 */

const ALICE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAFF = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('api_release_pending_booking', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  async function book(key: string): Promise<string> {
    const oid = (await db.pg.query<{ id: string }>(`select id from session_occurrences limit 1`))
      .rows[0]!.id;
    const data = await apiBook<{ ref: string }>(db, {
      occurrenceId: oid,
      party: { Adult: 2 },
      customerName: 'Cust',
      customerEmail: 'cust@example.com',
      source: 'web',
      idempotencyKey: key,
    });
    return data.ref;
  }

  const statusOf = async (ref: string): Promise<string> =>
    (await db.pg.query<{ status: string }>(`select status from bookings where ref=$1`, [ref]))
      .rows[0]!.status;

  /** Call the RPC directly as whoever `db.as(…)` last impersonated — PGlite has one session, so the
   *  identity the RPC authorizes on is whatever the test set. */
  const release = async (ref: string): Promise<{ status: string; alreadyReleased?: boolean }> =>
    (
      await db.pg.query<{ data: { status: string; alreadyReleased?: boolean } }>(
        `select api_release_pending_booking(jsonb_build_object('ref', $1::text)) as data`,
        [ref],
      )
    ).rows[0]!.data;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    for (const uid of [ALICE, BOB, STAFF]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [uid]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [ALICE]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [BOB]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'rel-tour', 'activity', 'Release Tour', 'Sightseeing tours', 'published') returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optId],
    );
    await db.pg.query(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '3 days', now() + interval '3 days 3 hours', 50)`,
      [optId, operatorId],
    );
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('expires the booking, releases its hold and audits it as the customer’s own act', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-ok-1');
    expect(await statusOf(ref)).toBe('payment_pending');

    const res = await release(ref);
    expect(res.status).toBe('expired');
    expect(await statusOf(ref)).toBe('expired');

    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;

    // The seats come back NOW — the whole point of the button is not waiting out the hold.
    const holds = (
      await db.pg.query<{ status: string }>(
        `select h.status from booking_holds h join bookings bk on bk.id=h.booking_id where bk.ref=$1`,
        [ref],
      )
    ).rows;
    expect(holds.length).toBeGreaterThan(0);
    expect(holds.every((h) => h.status === 'released')).toBe(true);

    // Distinguishable from the sweep's 'auto_expire_booking' — one is us acting on a silent
    // customer, this is the customer acting for themselves.
    const audit = (
      await db.pg.query<{ actor_id: string | null; actor_role: string }>(
        `select actor_id, actor_role from audit_logs
          where action='release_pending_booking' and entity_id=$1`,
        [bid],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_id).toBe(ALICE);
    expect(audit[0]!.actor_role).toBe('customer');
  });

  it('reuses the sweep’s expiry transition, so the guest still gets exactly one expiry email', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-email-1');
    await release(ref);

    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;
    const notifs = Number(
      (
        await db.pg.query<{ n: string }>(
          `select count(*) n from notification_outbox where template='booking_expired' and booking_id=$1`,
          [bid],
        )
      ).rows[0]!.n,
    );
    expect(notifs).toBe(1);
  });

  it('is idempotent — a double-click reports the state instead of raising', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-idem-1');
    await release(ref);
    const second = await release(ref);
    expect(second.alreadyReleased).toBe(true);
    expect(second.status).toBe('expired');
  });

  it('REFUSES a booking with a settled payment — the money guard', async () => {
    // The webhook is asynchronous: the cart can render 'payment_pending' for a booking the database
    // has already been paid for. Releasing it would hand away seats the customer just bought.
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-paid-1');
    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;
    await db.pg.query(
      `insert into payments (booking_id, idempotency_key, amount_minor, status, paid_minor)
       values ($1, $2, 10000, 'paid', 10000)`,
      [bid, `pay-${bid}`],
    );

    await db.as({ sub: ALICE, role: 'authenticated' });
    await expect(release(ref)).rejects.toThrow(/payment_settled/);
    expect(await statusOf(ref)).toBe('payment_pending'); // untouched
  });

  it('REFUSES a booking flagged for settlement review, even with no paid row', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-review-1');
    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;
    await db.pg.query(
      `insert into payments (booking_id, idempotency_key, amount_minor, status, paid_minor, settlement_review_at)
       values ($1, $2, 10000, 'pending', 0, now())`,
      [bid, `rev-${bid}`],
    );

    await db.as({ sub: ALICE, role: 'authenticated' });
    await expect(release(ref)).rejects.toThrow(/payment_settled/);
  });

  it('REFUSES a confirmed booking — that is api_cancel_booking’s job, and it owes a refund', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-confirmed-1');
    await db.asOwner();
    await db.pg.query(`update bookings set status='confirmed', payment_state='paid' where ref=$1`, [
      ref,
    ]);

    await db.as({ sub: ALICE, role: 'authenticated' });
    await expect(release(ref)).rejects.toThrow(/not_releasable/);
    expect(await statusOf(ref)).toBe('confirmed');
  });

  it('REFUSES a stranger, and does not leak whether the ref exists beyond that', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-owner-1');

    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(release(ref)).rejects.toThrow(/forbidden/);
    await db.asOwner();
    expect(await statusOf(ref)).toBe('payment_pending');
  });

  it('lets staff release a customer’s pending booking, audited as staff', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-staff-1');

    await db.as({ sub: STAFF, role: 'authenticated' });
    expect((await release(ref)).status).toBe('expired');

    await db.asOwner();
    const bid = (await db.pg.query<{ id: string }>(`select id from bookings where ref=$1`, [ref]))
      .rows[0]!.id;
    const audit = (
      await db.pg.query<{ actor_role: string }>(
        `select actor_role from audit_logs where action='release_pending_booking' and entity_id=$1`,
        [bid],
      )
    ).rows[0]!;
    expect(audit.actor_role).toBe('staff');
  });

  it('raises booking_not_found for an unknown ref, and invalid_request with no ref', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    await expect(release('BMTNOPE0000000')).rejects.toThrow(/booking_not_found/);
    await expect(db.pg.query(`select api_release_pending_booking('{}'::jsonb)`)).rejects.toThrow(
      /invalid_request/,
    );
  });

  it('is reachable through the service layer, and its zod schema matches the RPC output', async () => {
    // Stays as ALICE: pgliteRpc runs in the session's identity, and the RPC authorizes on
    // auth.uid() — as owner, auth.uid() is null and the ownership branch correctly refuses.
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ref = await book('rel-service-1');
    const result = await releasePendingBooking(ctx, ref);
    expect(result).toMatchObject({ ref, status: 'expired' });
  });

  it('is not executable by anon (the grant is the outer gate)', async () => {
    const { rows } = await db.pg.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'api_release_pending_booking(jsonb)', 'execute') as ok`,
    );
    expect(rows[0]!.ok).toBe(false);
    const auth = await db.pg.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'api_release_pending_booking(jsonb)', 'execute') as ok`,
    );
    expect(auth.rows[0]!.ok).toBe(true);
  });
});
