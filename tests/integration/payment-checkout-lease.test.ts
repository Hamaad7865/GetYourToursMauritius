import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc, pgliteServiceRoleRpc } from '../db/rpc';
import { apiBook } from '../db/book';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { createBooking } from '@/lib/services/bookings';

/**
 * Payment + hold hardening (migration 20260812000000; external review 2026-07-17 items 1 + 2).
 *
 * Item 1 — single-flight checkout lease: api_create_payment's reuse guard was check-then-act (the
 * checkout id is recorded only AFTER the Peach call), so two concurrent requests both saw "no
 * existing checkout" and both minted payable sessions. Peach's per-request nonce never dedupes.
 * The lease (payments.checkout_claimed_until) admits ONE caller to Peach; everyone else gets
 * checkoutPending until the winner's session is recorded, then reuses it.
 *
 * Item 2 — hold binding: attach never changed a hold's status, so a hold consumed by booking A
 * could be re-attached to booking B (two payable bookings, one capacity unit); the api_book reuse
 * path never checked the hold's owner; api_release_hold freed holds a booking stood on.
 */
const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const ALICE = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const BOB = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('single-flight checkout lease', () => {
  let db: TestDb;
  let bookingRef: string;
  let paymentId: string;

  type CreatePaymentOut = {
    paymentId: string;
    existingCheckoutId: string | null;
    checkoutPending?: boolean | null;
  };

  const createPayment = () =>
    call<CreatePaymentOut>(db, 'api_create_payment', {
      bookingRef,
      idempotencyKey: 'lease-pay-1',
    });

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    await db.pg.query(`insert into auth.users (id) values ($1)`, [ALICE]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [ALICE]);

    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    await db.as({ sub: ALICE, role: 'authenticated' });
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const booking = await createBooking(
      { ...ctx, db: pgliteServiceRoleRpc(db.pg) },
      {
        occurrenceId: rows[0]!.id,
        party: { 'Private group': 2 },
        customer: { name: 'Alice', email: 'alice@example.com' },
        idempotencyKey: 'lease-book-1',
      },
    );
    bookingRef = booking.ref;
    await db.as({ sub: ALICE, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  const leaseRow = async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{ checkout_claimed_until: string | null; n: number }>(
        `select p.checkout_claimed_until, (select count(*)::int from payments) as n
           from payments p where p.id = $1`,
        [paymentId],
      )
    ).rows[0]!;
    await db.as({ sub: ALICE, role: 'authenticated' });
    return row;
  };

  it('the first caller gets the claim (no reuse, no pending) and the lease is stamped', async () => {
    const out = await createPayment();
    paymentId = out.paymentId;
    expect(out.existingCheckoutId).toBeNull();
    expect(out.checkoutPending ?? null).toBeNull();

    const row = await leaseRow();
    expect(row.checkout_claimed_until).not.toBeNull();
    expect(new Date(row.checkout_claimed_until!).getTime()).toBeGreaterThan(Date.now());
  });

  it('a concurrent second caller is told checkoutPending — it must NOT call Peach', async () => {
    const out = await createPayment();
    expect(out.paymentId).toBe(paymentId); // same payment row — the race can't mint a second one
    expect(out.existingCheckoutId).toBeNull();
    expect(out.checkoutPending).toBe(true);

    const row = await leaseRow();
    expect(row.n).toBe(1); // and no duplicate payments row appeared
  });

  it('recording the checkout releases the lease and later callers REUSE that session', async () => {
    await db.as({ role: 'service_role' });
    await call(db, 'api_record_payment_checkout', { paymentId, checkoutId: 'chk_lease_1' });
    await db.as({ sub: ALICE, role: 'authenticated' });

    const out = await createPayment();
    expect(out.existingCheckoutId).toBe('chk_lease_1');
    expect(out.checkoutPending ?? null).toBeNull();

    const row = await leaseRow();
    expect(row.checkout_claimed_until).toBeNull();
  });

  it('a STALE recorded checkout (>25 min) is not reused — the caller claims and re-mints', async () => {
    await db.asOwner();
    await db.pg.query(
      `update payments set updated_at = now() - interval '26 minutes' where id = $1`,
      [paymentId],
    );
    await db.as({ sub: ALICE, role: 'authenticated' });

    const out = await createPayment();
    expect(out.existingCheckoutId).toBeNull(); // too old to trust — Peach sessions expire
    expect(out.checkoutPending ?? null).toBeNull(); // and the lease was free, so this caller claims
  });

  it('api_release_checkout_claim (failed Peach call) frees the lease for the next attempt', async () => {
    // The previous test left the lease claimed. Simulate the claimer's Peach call failing:
    await db.as({ role: 'service_role' });
    await call(db, 'api_release_checkout_claim', { paymentId });
    await db.as({ sub: ALICE, role: 'authenticated' });

    const out = await createPayment();
    expect(out.checkoutPending ?? null).toBeNull(); // claim granted immediately, no 90s sit-out
  });

  it('an expired lease self-heals (crash between claim and record)', async () => {
    await db.asOwner();
    await db.pg.query(
      `update payments set checkout_claimed_until = now() - interval '1 second' where id = $1`,
      [paymentId],
    );
    await db.as({ sub: ALICE, role: 'authenticated' });

    const out = await createPayment();
    expect(out.checkoutPending ?? null).toBeNull();
  });

  it('api_release_checkout_claim is server-only (grant layer)', async () => {
    await db.as({ sub: ALICE, role: 'authenticated' });
    await expect(call(db, 'api_release_checkout_claim', { paymentId })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('hold binding: one hold, one booking, its owner only', () => {
  let db: TestDb;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [ALICE, BOB]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer'), ($2, 'customer')`, [
      ALICE,
      BOB,
    ]);
    // Self-contained per-person fixture (the booking-flow.test.ts pattern): one option, one 'Adult'
    // tier, one future occurrence with plenty of capacity for the four bookings below.
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'bind-tour', 'activity', 'Bind Tour', 'Sightseeing tours', 'published') returning id`,
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
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Adult', 7000, null)`,
      [optId],
    );
    occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', 20) returning id`,
        [optId, operatorId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  /** Mint a hold exactly as the holds route does (service-role RPC + verified userId). */
  const mintHold = async (user: string | null, key: string, people = 2) => {
    await db.as({ role: 'service_role' });
    await call(db, 'api_create_hold', {
      occurrenceId,
      expectedSlug: null,
      people,
      idempotencyKey: key,
      userId: user,
    });
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `select id from booking_holds where idempotency_key like $1 || '%' order by created_at desc limit 1`,
      [key],
    );
    return rows[0]!.id;
  };

  const holdState = async (id: string) => {
    await db.asOwner();
    return (
      await db.pg.query<{ booking_id: string | null; status: string }>(
        `select booking_id, status from booking_holds where id = $1`,
        [id],
      )
    ).rows[0]!;
  };

  it('a hold consumed by booking A cannot be attached to booking B (create_booking)', async () => {
    const holdId = await mintHold(null, 'bind-a');
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select create_booking('bind-key-a', $1::uuid, 'A', 'a@example.com', null, 'web',
         '[{"price_label":"Adult","quantity":2}]'::jsonb)`,
      [holdId],
    );
    // Different idempotency key, same hold: without the guard this silently re-pointed booking_id.
    await expect(
      db.pg.query(
        `select create_booking('bind-key-b', $1::uuid, 'B', 'b@example.com', null, 'web',
           '[{"price_label":"Adult","quantity":2}]'::jsonb)`,
        [holdId],
      ),
    ).rejects.toThrow('hold_already_used');
  });

  it("api_book never consumes ANOTHER user's owned hold — it falls back to a fresh one", async () => {
    const alicesHold = await mintHold(ALICE, 'bind-owned');

    await db.as({ sub: BOB, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      holdId: alicesHold, // Bob quotes Alice's hold id (leaked/guessed)
      customerName: 'Bob',
      customerEmail: 'bob@example.com',
      source: 'web',
      idempotencyKey: 'bind-bob-1',
    });
    expect(booking.ref).toBeTruthy();

    // Alice's hold is untouched — still active, still unattached, still hers to use.
    const alices = await holdState(alicesHold);
    expect(alices.booking_id).toBeNull();
    expect(alices.status).toBe('active');

    // Bob's booking got its own fallback hold instead.
    const { rows } = await db.pg.query<{ id: string }>(
      `select h.id from booking_holds h join bookings b on b.id = h.booking_id
        where b.ref = $1`,
      [booking.ref],
    );
    expect(rows[0]!.id).not.toBe(alicesHold);
  });

  it("api_book DOES reuse the caller's own hold (the checkout flow)", async () => {
    const alicesHold = await mintHold(ALICE, 'bind-own-reuse');

    await db.as({ sub: ALICE, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      holdId: alicesHold,
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      source: 'web',
      idempotencyKey: 'bind-alice-1',
    });

    const state = await holdState(alicesHold);
    const { rows } = await db.pg.query<{ id: string }>(
      `select h.id from booking_holds h join bookings b on b.id = h.booking_id where b.ref = $1`,
      [booking.ref],
    );
    expect(rows[0]!.id).toBe(alicesHold); // reused, not a second hold
    expect(state.booking_id).not.toBeNull();
  });

  it('an OWNERLESS hold stays reusable by whoever holds its id (guest checkout flow)', async () => {
    const guestHold = await mintHold(null, 'bind-guest');

    // Guest booking: no session, no actorUserId.
    await db.as({ role: 'service_role' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 2 },
      holdId: guestHold,
      customerName: 'Guest',
      customerEmail: 'guest@example.com',
      source: 'web',
      idempotencyKey: 'bind-guest-1',
    });

    const { rows } = await db.pg.query<{ id: string }>(
      `select h.id from booking_holds h join bookings b on b.id = h.booking_id where b.ref = $1`,
      [booking.ref],
    );
    expect(rows[0]!.id).toBe(guestHold);
  });
});
