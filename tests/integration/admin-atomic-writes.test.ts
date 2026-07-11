import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The three staff-only, single-transaction admin RPCs added in
 * migration 20260617220000_admin_atomic_writes:
 *   - api_swap_category_positions  (was two client UPDATEs)
 *   - set_daily_capacity_atomic    (was activity update + slot propagate + materialize)
 *   - stop_availability_atomic     (was clear capacity + close busy + delete empty)
 * Each must do the full operation atomically and reject non-staff callers.
 */
const STAFF = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';
const CUSTOMER = 'c7c7c7c7-c7c7-c7c7-c7c7-c7c7c7c7c7c7';

describe('admin atomic writes (staff-only transactional RPCs)', () => {
  let db: TestDb;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    operatorId = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Atomic Co', 'atomic-co') returning id`,
      )
    ).rows[0]!.id;
    // A staff account (drives is_staff()) and a plain customer (must be rejected).
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Cust', 'customer')`,
      [CUSTOMER],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function newActivity(
    slug: string,
    capacity: number | null,
  ): Promise<{ activityId: string; optionId: string }> {
    await db.asOwner();
    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, title, category, status, daily_capacity, duration_minutes)
         values ($1, $2, $2, 'Sightseeing tours', 'published', $3, 120) returning id`,
        [operatorId, slug, capacity],
      )
    ).rows[0]!.id;
    const optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Shared', 0) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionId],
    );
    return { activityId, optionId };
  }

  describe('api_swap_category_positions', () => {
    it('swaps two categories positions atomically', async () => {
      await db.asOwner();
      const rows = (
        await db.pg.query<{ id: string; position: number }>(
          `insert into categories (name, slug, position) values
             ('Swap A', 'swap-a', 100), ('Swap B', 'swap-b', 101)
           returning id, position`,
        )
      ).rows;
      const a = rows.find((r) => r.position === 100)!;
      const b = rows.find((r) => r.position === 101)!;

      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select api_swap_category_positions($1::uuid, $2::uuid)`, [a.id, b.id]);

      await db.asOwner();
      const after = (
        await db.pg.query<{ id: string; position: number }>(
          `select id, position from categories where id in ($1, $2)`,
          [a.id, b.id],
        )
      ).rows;
      expect(after.find((r) => r.id === a.id)!.position).toBe(101);
      expect(after.find((r) => r.id === b.id)!.position).toBe(100);
    });

    it('raises category_not_found when an id does not exist', async () => {
      await db.asOwner();
      const a = (
        await db.pg.query<{ id: string }>(
          `insert into categories (name, slug, position) values ('Swap C', 'swap-c', 200) returning id`,
        )
      ).rows[0]!.id;
      await db.as({ sub: STAFF, role: 'authenticated' });
      await expect(
        db.pg.query(
          `select api_swap_category_positions($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
          [a],
        ),
      ).rejects.toThrow(/category_not_found/);
    });

    it('rejects a non-staff caller', async () => {
      await db.asOwner();
      const rows = (
        await db.pg.query<{ id: string }>(
          `insert into categories (name, slug, position) values
             ('Swap D', 'swap-d', 300), ('Swap E', 'swap-e', 301) returning id`,
        )
      ).rows;
      await db.as({ sub: CUSTOMER, role: 'authenticated' });
      await expect(
        db.pg.query(`select api_swap_category_positions($1::uuid, $2::uuid)`, [
          rows[0]!.id,
          rows[1]!.id,
        ]),
      ).rejects.toThrow(/forbidden/);
      await db.asOwner();
    });
  });

  describe('set_daily_capacity_atomic', () => {
    it('sets capacity, propagates to future slots, and materializes the window', async () => {
      const { activityId, optionId } = await newActivity('cap-atomic', null);
      // A pre-existing future slot with a stale capacity that must be brought up to the new value.
      await db.pg.query(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, $2, now() + interval '2 days', now() + interval '2 days' + interval '2 hours', 2, 'open')`,
        [optionId, operatorId],
      );

      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
        JSON.stringify({ activityId, capacity: 9 }),
      ]);

      await db.asOwner();
      const cap = (
        await db.pg.query<{ daily_capacity: number }>(
          `select daily_capacity from activities where id = $1`,
          [activityId],
        )
      ).rows[0]!.daily_capacity;
      expect(cap).toBe(9);

      const slots = (
        await db.pg.query<{ n: number; min: number; max: number }>(
          `select count(*)::int as n, min(capacity)::int as min, max(capacity)::int as max
           from session_occurrences where activity_option_id = $1 and starts_at >= now()`,
          [optionId],
        )
      ).rows[0]!;
      expect(slots.n).toBeGreaterThan(0); // materialize created the open-ended window
      expect(slots.min).toBe(9); // every future slot (incl. the stale one) now carries 9
      expect(slots.max).toBe(9);
    });

    it('rejects a non-staff caller', async () => {
      const { activityId } = await newActivity('cap-atomic-forbidden', null);
      await db.as({ sub: CUSTOMER, role: 'authenticated' });
      await expect(
        db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
          JSON.stringify({ activityId, capacity: 5 }),
        ]),
      ).rejects.toThrow(/forbidden/);
      await db.asOwner();
    });
  });

  describe('stop_availability_atomic', () => {
    it('clears capacity, closes a booked slot, and deletes empty slots', async () => {
      const { activityId, optionId } = await newActivity('stop-atomic', 6);
      // An empty future slot (should be DELETED) and a booked future slot (should be CLOSED, kept).
      const empty = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, now() + interval '3 days', now() + interval '3 days' + interval '2 hours', 6, 'open')
           returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
      const booked = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, now() + interval '4 days', now() + interval '4 days' + interval '2 hours', 6, 'open')
           returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
      // Give the booked slot a real booking item so it must be preserved (closed, not deleted).
      const bookingId = (
        await db.pg.query<{ id: string }>(
          `insert into bookings (ref, status, payment_state, total_minor, currency, customer_name, customer_email, source)
           values ('ATOMIC-1', 'confirmed', 'paid', 5000, 'EUR', 'X', 'x@example.com', 'web') returning id`,
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into booking_items
           (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, $3, 'Adult', 1, 5000, 5000)`,
        [bookingId, booked, optionId],
      );

      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select stop_availability_atomic($1::jsonb)`, [
        JSON.stringify({ activityId }),
      ]);

      await db.asOwner();
      const cap = (
        await db.pg.query<{ daily_capacity: number | null }>(
          `select daily_capacity from activities where id = $1`,
          [activityId],
        )
      ).rows[0]!.daily_capacity;
      expect(cap).toBeNull();

      const emptyGone = (
        await db.pg.query(`select 1 from session_occurrences where id = $1`, [empty])
      ).rows.length;
      expect(emptyGone).toBe(0); // empty future slot deleted

      const bookedStatus = (
        await db.pg.query<{ status: string }>(
          `select status from session_occurrences where id = $1`,
          [booked],
        )
      ).rows[0]!.status;
      expect(bookedStatus).toBe('closed'); // booked future slot kept but closed
    });

    it('rejects a non-staff caller', async () => {
      const { activityId } = await newActivity('stop-atomic-forbidden', 6);
      await db.as({ sub: CUSTOMER, role: 'authenticated' });
      await expect(
        db.pg.query(`select stop_availability_atomic($1::jsonb)`, [JSON.stringify({ activityId })]),
      ).rejects.toThrow(/forbidden/);
      await db.asOwner();
    });
  });
});
