import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';

/**
 * Replaying a booking must not mint a hold nobody claims.
 *
 * create_booking's idempotency check runs before it ever looks at p_hold_id, so on a replay it
 * returns the existing booking and never attaches the hold it was handed. The ORIGINAL hold is by
 * then consumed (booking_id set), so api_book's reuse SELECT — which requires `booking_id is null` —
 * cannot match it, and the old code went on to call create_hold. That fresh hold was never claimed by
 * anything: it sat active, counted by used_capacity, for its whole TTL.
 *
 * On a nearly-full departure it is worse than wasted capacity: create_hold raises
 * insufficient_capacity, so a legitimate retry of a booking that ALREADY SUCCEEDED fails, and the
 * caller is told the booking did not happen when it did.
 *
 * Fixed in 20260903000000_book_replay_no_orphan_hold.
 */
const CUSTOMER = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';

describe('api_book replay does not orphan a hold', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;

  async function newOccurrence(capacity: number): Promise<string> {
    await db.asOwner();
    return (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', $3) returning id`,
        [optionId, operatorId, capacity],
      )
    ).rows[0]!.id;
  }

  async function holdCount(occurrenceId: string): Promise<number> {
    await db.asOwner();
    const n = (
      await db.pg.query<{ n: string }>(
        `select count(*) as n from booking_holds where session_occurrence_id = $1 and status = 'active'`,
        [occurrenceId],
      )
    ).rows[0]!.n;
    return Number(n);
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'replay-tour', 'activity', 'Replay Tour', 'Sightseeing tours', 'published') returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('leaves exactly one hold — the consumed original — after a replay', async () => {
    const occ = await newOccurrence(20);
    // create_hold is service-role only (the server reserves the hold); an owner-created hold has a
    // null created_by, which is exactly the ownerless guest-checkout shape api_book's reuse accepts.
    await db.asOwner();
    // `select * from` expands the composite booking_holds return into columns. Selecting the call
    // itself yields one opaque record whose `.id` is undefined, which silently books with NO holdId —
    // api_book then mints its own hold and the test measures the wrong thing entirely.
    const hold = (
      await db.pg.query<{ id: string }>(`select * from create_hold($1::uuid, 2, $2)`, [
        occ,
        'replay-hold-key',
      ])
    ).rows[0]!;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const payload = {
      occurrenceId: occ,
      holdId: hold.id,
      party: { Adult: 2 },
      customerName: 'Replay Guest',
      customerEmail: 'replay-guest@example.com',
      source: 'web' as const,
      idempotencyKey: 'replay-hold-book',
    };
    const first = await apiBook<{ ref: string }>(db, payload);
    expect(await holdCount(occ)).toBe(1);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const replay = await apiBook<{ ref: string }>(db, payload);

    expect(replay.ref).toBe(first.ref);
    // Before the fix this was 2: the consumed original plus an orphan nothing would ever claim.
    expect(await holdCount(occ)).toBe(1);
  });

  /**
   * The symptom that actually reaches a customer. With the departure fully committed to this party,
   * the orphan hold could not be created — so the replay raised insufficient_capacity and the caller
   * was told a booking that had succeeded had failed.
   */
  it('replays cleanly on a departure with no spare capacity', async () => {
    const occ = await newOccurrence(2); // exactly this party, nothing spare
    // create_hold is service-role only (the server reserves the hold); an owner-created hold has a
    // null created_by, which is exactly the ownerless guest-checkout shape api_book's reuse accepts.
    await db.asOwner();
    const hold = (
      await db.pg.query<{ id: string }>(`select * from create_hold($1::uuid, 2, $2)`, [
        occ,
        'replay-full-hold',
      ])
    ).rows[0]!;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const payload = {
      occurrenceId: occ,
      holdId: hold.id,
      party: { Adult: 2 },
      customerName: 'Full Departure',
      customerEmail: 'full@example.com',
      source: 'web' as const,
      idempotencyKey: 'replay-full-book',
    };
    const first = await apiBook<{ ref: string }>(db, payload);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const replay = await apiBook<{ ref: string }>(db, payload);
    expect(replay.ref).toBe(first.ref);
    expect(await holdCount(occ)).toBe(1);
  });

  it('a genuinely new booking on the same occurrence still gets its own hold', async () => {
    const occ = await newOccurrence(20);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await apiBook<{ ref: string }>(db, {
      occurrenceId: occ,
      party: { Adult: 2 },
      customerName: 'First Party',
      customerEmail: 'first@example.com',
      source: 'web',
      idempotencyKey: 'distinct-book-a',
    });
    await apiBook<{ ref: string }>(db, {
      occurrenceId: occ,
      party: { Adult: 2 },
      customerName: 'Second Party',
      customerEmail: 'second@example.com',
      source: 'web',
      idempotencyKey: 'distinct-book-b',
    });
    // Two real bookings, two real holds — the guard keys on the idempotency key, not the occurrence.
    expect(await holdCount(occ)).toBe(2);
  });
});
