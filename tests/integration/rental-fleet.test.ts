import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * The rental fleet is admin-managed + WhatsApp-only (no booking/payment). This proves the two halves:
 *  - the public read `api_list_rental_vehicles` returns ONLY active vehicles, ordered, with the seeded
 *    €36 / €20 rates — the exact shape the /rent picker renders;
 *  - RLS: an authenticated staff user can create / edit / remove vehicles through the real admin helpers,
 *    while a non-staff user is silently denied (RLS USING filters the row → 0 rows changed).
 */
const STAFF = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';
const CUSTOMER = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { loadRentalFleet, createRentalVehicle, updateRentalVehicle, deleteRentalVehicle } =
  await import('@/lib/admin/rental');

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

type Listed = { slug: string; name: string; dailyRateEur: number; category: string; seats: number };

describe('rental fleet: public list RPC + admin RLS', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Cust', 'customer')`,
      [CUSTOMER],
    );
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  it('lists the 6 seeded vehicles, ordered, with the €36 / €20 rates (anon)', async () => {
    await db.as(null);
    const items = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    expect(items).toHaveLength(6);
    // Ordered by sort: cars first (€36), then scooters (€20).
    expect(items[0]).toMatchObject({ slug: 'nissan-march', dailyRateEur: 36, seats: 5 });
    expect(items.find((v) => v.slug === 'suzuki-ertiga')).toMatchObject({
      category: 'family',
      seats: 7,
    });
    expect(items.filter((v) => v.category === 'scooter').every((v) => v.dailyRateEur === 20)).toBe(
      true,
    );
  });

  it('lets staff create, edit and remove vehicles; the list reflects active only', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await createRentalVehicle({
      slug: 'toyota-aqua',
      name: 'Toyota Aqua',
      category: 'economy',
      seats: 5,
      transmission: 'automatic',
      airCon: true,
      imageUrl: null,
      dailyRateEur: 40,
      depositEur: 100,
      sort: 25,
      active: true,
    });
    // Deactivate a seeded vehicle -> it drops out of the public list.
    await updateRentalVehicle({
      slug: 'sym-crox',
      name: 'SYM Crox',
      category: 'scooter',
      seats: 2,
      transmission: 'automatic',
      airCon: false,
      imageUrl: null,
      dailyRateEur: 22,
      depositEur: 0,
      sort: 50,
      active: false,
    });

    await db.as(null);
    const items = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    const slugs = items.map((v) => v.slug);
    expect(slugs).toContain('toyota-aqua');
    expect(slugs).not.toContain('sym-crox'); // inactive -> hidden
    expect(items.find((v) => v.slug === 'toyota-aqua')).toMatchObject({ dailyRateEur: 40 });

    await db.as({ sub: STAFF, role: 'authenticated' });
    await deleteRentalVehicle('toyota-aqua');
    await db.as(null);
    const after = await call<Listed[]>(db, 'api_list_rental_vehicles', {});
    expect(after.map((v) => v.slug)).not.toContain('toyota-aqua');
  });

  it('silently denies a non-staff write (RLS)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await updateRentalVehicle({
      slug: 'nissan-march',
      name: 'Hacked',
      category: 'economy',
      seats: 5,
      transmission: 'automatic',
      airCon: true,
      imageUrl: null,
      dailyRateEur: 1,
      depositEur: 0,
      sort: 10,
      active: true,
    });

    await db.asOwner();
    const { rows } = await db.pg.query<{ name: string; daily_rate_minor: number }>(
      `select name, daily_rate_minor from rental_vehicles where slug = 'nissan-march'`,
    );
    expect(rows[0]).toMatchObject({ name: 'Nissan March', daily_rate_minor: 3600 }); // unchanged
  });

  it('explains, instead of leaking Postgres, when a vehicle is still on a booking', async () => {
    // booking_custom_items.rental_vehicle_slug is ON DELETE RESTRICT on purpose: a priced booking
    // line must keep naming the vehicle it was sold as. Postgres answers with a raw 23503 string,
    // which the fleet screen used to rethrow verbatim — the operator saw a constraint name and no
    // way to act on it.
    await db.asOwner();
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, payment_state, total_minor, currency, customer_name, customer_email, source)
         values ('RENT-1', 'confirmed', 'paid', 6000, 'EUR', 'Rental Guest', 'rental@example.com', 'web')
         returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_custom_items
         (booking_id, position, kind, description, rental_vehicle_slug,
          quantity, unit_amount_minor, subtotal_minor)
       values ($1, 1, 'rental', 'Nissan Note, 3 days', 'nissan-note', 3, 2000, 6000)`,
      [bookingId],
    );

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(deleteRentalVehicle('nissan-note')).rejects.toThrow(/appears on 1 booking line/i);

    // The vehicle is still there — the RESTRICT held and nothing was half-applied.
    await db.asOwner();
    expect(
      (await db.pg.query(`select 1 from rental_vehicles where slug = 'nissan-note'`)).rows,
    ).toHaveLength(1);
  });

  it('never reports "0 booking lines" when the count itself failed', async () => {
    // The count is a second read, and it can fail on its own: PostgREST's schema cache not yet aware
    // of booking_custom_items right after a deploy, an RLS denial, a dropped connection. Swallowing
    // that error and reporting its absent result as zero tells the operator the vehicle "appears on 0
    // booking lines and cannot be removed" — self-contradictory, and it hides the real cause.
    await db.asOwner();
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, payment_state, total_minor, currency, customer_name, customer_email, source)
         values ('RENT-2', 'confirmed', 'paid', 6000, 'EUR', 'Rental Guest', 'rental2@example.com', 'web')
         returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_custom_items
         (booking_id, position, kind, description, rental_vehicle_slug,
          quantity, unit_amount_minor, subtotal_minor)
       values ($1, 1, 'rental', 'Suzuki Ertiga, 2 days', 'suzuki-ertiga', 2, 2000, 4000)`,
      [bookingId],
    );

    const real = hoisted.shim!;
    const broken = {
      message: 'Could not find the table public.booking_custom_items in the schema cache',
    };
    hoisted.shim = {
      ...real,
      from: (table: string) =>
        table === 'booking_custom_items'
          ? ({
              select: () => ({
                eq: () => Promise.resolve({ data: null, count: null, error: broken }),
              }),
            } as never)
          : real.from(table),
    } as SupabaseShim;

    try {
      await db.as({ sub: STAFF, role: 'authenticated' });
      const err = await deleteRentalVehicle('suzuki-ertiga').then(
        () => null,
        (e: unknown) => e,
      );
      expect(err, 'the RESTRICT delete silently succeeded').toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message, 'a failed count was reported as zero booking lines').not.toMatch(/\b0\b/);
      expect(message, 'the operator is not told the vehicle is still in use').toMatch(
        /at least one/i,
      );
      expect(message, 'the alternative action is missing').toMatch(/active/i);
    } finally {
      hoisted.shim = real;
    }
  });

  it('loads the fleet through the admin helper (staff), newest sort order', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const fleet = await loadRentalFleet();
    expect(fleet.length).toBeGreaterThanOrEqual(6);
    expect(fleet[0]!.sort).toBeLessThanOrEqual(fleet[fleet.length - 1]!.sort);
  });
});
