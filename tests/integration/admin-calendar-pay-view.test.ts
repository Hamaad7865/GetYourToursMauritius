import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';

/**
 * The Calendar's payment chip reads the shared "Part paid" rule (back-office redesign, phase 2).
 *
 * `paymentView()` needs a booking's deposit and total besides its ledger state, so the day-sheet
 * reads now carry `deposit_minor` (and the return-leg read `total_minor` too). This runs the return-leg
 * read against the REAL schema and staff RLS and feeds its rows to the real mapper:
 *
 *  - a deposit-confirmed booking (ledger 'paid', balance still owed) reads `part_paid`, the same words
 *    the Bookings list and Today use, and a booking paid in full reads `paid`;
 *  - a signed-in customer reads none of it.
 *
 * (The occurrence and custom-line reads embed related tables, which this test harness cannot run;
 * they select the same `deposit_minor` column through the same `BOOKING_FIELDS` list.)
 */

const STAFF = 'd6d6d6d6-d6d6-d6d6-d6d6-d6d6d6d6d6d6';
const CUSTOMER = 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { mapReturnLegs } = await import('@/lib/admin/calendar');
const { TRANSFER_SELECT } = await import('@/lib/admin/bookings');

/** The return-leg read's own columns (RETURN_LEG_SELECT without its booking_items embed). */
const LEG_COLUMNS = `id, ref, status, payment_state, customer_name, customer_email, customer_phone,
  source, created_at, notes, pickup_location, dropoff_location, balance_due_minor, total_minor,
  deposit_minor, ${TRANSFER_SELECT}`;

async function bookingId(db: TestDb, key: string): Promise<{ id: string; total: number }> {
  const { rows } = await db.pg.query<{ id: string; total_minor: number }>(
    `select id, total_minor from bookings where idempotency_key = $1`,
    [key],
  );
  return { id: rows[0]!.id, total: Number(rows[0]!.total_minor) };
}

describe('Calendar return-leg read carries what the "Part paid" rule needs', () => {
  let db: TestDb;
  let fullId = '';
  let depositId = '';

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Owner', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Guest', 'customer')`,
      [CUSTOMER],
    );
    hoisted.shim = makeSupabaseShim(db.pg);

    const seed = await seedOccurrence(db, 10);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    for (const key of ['leg-full', 'leg-deposit']) {
      await apiBook(db, {
        occurrenceId: seed.occurrenceId,
        expectedSlug: rows[0]!.slug,
        party: { Adult: 2 },
        customerName: key === 'leg-full' ? 'Paid Party' : 'Deposit Party',
        customerEmail: `${key}@example.com`,
        source: 'web',
        idempotencyKey: key,
      });
    }
    await db.asOwner();
    const full = await bookingId(db, 'leg-full');
    const deposit = await bookingId(db, 'leg-deposit');
    fullId = full.id;
    depositId = deposit.id;

    // Seeded as the states the money path leaves behind (the shape is what is under test here, not
    // settlement): one paid in full, one a deposit-confirmed quote booking with its balance owed.
    // Both are return transfers whose departure leg falls on 20 Nov.
    await db.pg.query(
      `update bookings
          set status = 'confirmed', payment_state = 'paid', deposit_minor = 0,
              balance_due_minor = 0, trip_direction = 'return', return_date = '2026-11-20',
              return_time = '18:30'
        where id = $1`,
      [full.id],
    );
    await db.pg.query(
      `update bookings
          set status = 'confirmed', payment_state = 'paid', deposit_minor = $2,
              balance_due_minor = $3, trip_direction = 'return', return_date = '2026-11-20',
              return_time = '18:30'
        where id = $1`,
      [deposit.id, 3000, deposit.total - 3000],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function readLegs() {
    const { data, error } = await hoisted
      .shim!.from('bookings')
      .select(LEG_COLUMNS)
      .eq('trip_direction', 'return')
      .order('id', { ascending: true });
    if (error) throw error;
    return (data as Array<Record<string, unknown>>).map((r) => ({ ...r, booking_items: [] }));
  }

  it('staff read the deposit and total, and the leg reads "Part paid" only while a balance is owed', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    try {
      const raw = await readLegs();
      expect(raw).toHaveLength(2);
      const legs = mapReturnLegs(raw as never);
      const byId = new Map(legs.map((l) => [l.bookingId, l]));
      expect(byId.get(fullId)!.payView).toBe('paid');
      expect(byId.get(depositId)!.payView).toBe('part_paid');
      expect(byId.get(depositId)!.balanceDueEur).toBeGreaterThan(0);
    } finally {
      await db.asOwner();
    }
  });

  it('a signed-in customer reads nothing', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    try {
      expect(await readLegs()).toEqual([]);
    } finally {
      await db.asOwner();
    }
  });
});
