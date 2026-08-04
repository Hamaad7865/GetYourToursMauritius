import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence, seedPrivateOption } from '../db/seed';

/**
 * Trips/day × guests/trip (20260908000000): `daily_capacity` stays the day's POOL in its historic
 * units, and the NEW fact — guests_per_trip (activity default, option override) — caps how many
 * guests ONE booking may hold on a shared option. What's worth guarding:
 *   * create_booking refuses a shared party above the cap (option override beats activity default),
 *     and a NULL cap keeps the old uncapped behaviour — existing activities change nothing;
 *   * api_get_activity exposes the effective cap per option, so the widget can stop the party
 *     selector before the server has to refuse;
 *   * set_daily_capacity_atomic writes the two numbers everywhere the availability screen needs:
 *     pool + default at the activity, override at the option — and for a PRIVATE option routes the
 *     guests number into private_max_guests, refusing values under what the base price covers
 *     (which would otherwise trip the pricing table constraint into a 500).
 */
const STAFF = 'b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8';

describe('guests-per-trip capacity', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses one booking above the activity-level cap; at the cap books fine', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 36); // pool: 36 guests/day
    await db.pg.query(`update activities set guests_per_trip = 12 where id = $1`, [
      seed.activityId,
    ]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    await db.as(null);
    await expect(
      apiBook(db, {
        occurrenceId: seed.occurrenceId,
        expectedSlug: rows[0]!.slug,
        party: { Adult: 13 }, // one boat seats 12 — however big the day's pool is
        customerName: 'Too Many',
        customerEmail: 'toomany@example.com',
        source: 'web',
        idempotencyKey: 'trip-cap-over',
      }),
    ).rejects.toThrow(/exceeds_max_guests/);

    const ok = await apiBook<{ totalEur: number }>(db, {
      occurrenceId: seed.occurrenceId,
      expectedSlug: rows[0]!.slug,
      party: { Adult: 12 },
      customerName: 'Full Boat',
      customerEmail: 'fullboat@example.com',
      source: 'web',
      idempotencyKey: 'trip-cap-at',
    });
    expect(ok.totalEur).toBe(900); // 12 × €75
  });

  it('the option override beats the activity default, and NULL stays uncapped', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 30);
    // Activity says 20; THIS option's boat only seats 4.
    await db.pg.query(`update activities set guests_per_trip = 20 where id = $1`, [
      seed.activityId,
    ]);
    await db.pg.query(`update activity_options set guests_per_trip = 4 where id = $1`, [
      seed.optionId,
    ]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    await db.as(null);
    await expect(
      apiBook(db, {
        occurrenceId: seed.occurrenceId,
        expectedSlug: rows[0]!.slug,
        party: { Adult: 5 },
        customerName: 'Over Option',
        customerEmail: 'overopt@example.com',
        source: 'web',
        idempotencyKey: 'trip-cap-opt-over',
      }),
    ).rejects.toThrow(/exceeds_max_guests/);

    // A legacy activity (no caps anywhere) books any party the pool allows — unchanged behaviour.
    await db.asOwner();
    const legacy = await seedOccurrence(db, 30);
    const { rows: lrows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [legacy.activityId],
    );
    await db.as(null);
    const big = await apiBook<{ totalEur: number }>(db, {
      occurrenceId: legacy.occurrenceId,
      expectedSlug: lrows[0]!.slug,
      party: { Adult: 16 },
      customerName: 'Legacy Big',
      customerEmail: 'legacy@example.com',
      source: 'web',
      idempotencyKey: 'trip-cap-legacy',
    });
    expect(big.totalEur).toBe(1200); // 16 × €75, no refusal
  });

  it('api_get_activity exposes the effective guests/trip per option (override, else default)', async () => {
    await db.asOwner();
    const seed = await seedOccurrence(db, 24);
    await db.pg.query(`update activities set guests_per_trip = 8 where id = $1`, [seed.activityId]);
    const { rows: opt2 } = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name, guests_per_trip) values ($1, 'Big boat', 15) returning id`,
      [seed.activityId],
    );
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    const dto = await (async () => {
      const { rows: r } = await db.pg.query<{
        data: { options: Array<{ id: string; guestsPerTrip: number | null }> };
      }>(`select api_get_activity($1::jsonb) as data`, [JSON.stringify({ slug: rows[0]!.slug })]);
      return r[0]!.data;
    })();
    const bySelf = new Map(dto.options.map((o) => [o.id, o.guestsPerTrip]));
    expect(bySelf.get(seed.optionId)).toBe(8); // inherits the activity default
    expect(bySelf.get(opt2[0]!.id)).toBe(15); // its own override
  });

  describe('set_daily_capacity_atomic — the two numbers', () => {
    it('activity path stores pool + guests/trip together', async () => {
      await db.asOwner();
      const seed = await seedOccurrence(db, 10);
      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
        JSON.stringify({ activityId: seed.activityId, capacity: 36, guestsPerTrip: 12 }),
      ]);
      await db.asOwner();
      const { rows } = await db.pg.query<{ daily_capacity: number; guests_per_trip: number }>(
        `select daily_capacity, guests_per_trip from activities where id = $1`,
        [seed.activityId],
      );
      expect(rows[0]).toEqual({ daily_capacity: 36, guests_per_trip: 12 });
    });

    it('option path writes the shared override, guests-only update included; inherit clears it', async () => {
      await db.asOwner();
      const seed = await seedOccurrence(db, 10);
      await db.as({ sub: STAFF, role: 'authenticated' });
      // Guests-only update (no capacity): must not invent a pool override.
      await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
        JSON.stringify({ activityId: seed.activityId, optionId: seed.optionId, guestsPerTrip: 6 }),
      ]);
      await db.asOwner();
      let { rows } = await db.pg.query<{ daily_capacity: number | null; guests_per_trip: number }>(
        `select daily_capacity, guests_per_trip from activity_options where id = $1`,
        [seed.optionId],
      );
      expect(rows[0]).toEqual({ daily_capacity: null, guests_per_trip: 6 });
      // Inherit clears both overrides.
      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
        JSON.stringify({ activityId: seed.activityId, optionId: seed.optionId, inherit: true }),
      ]);
      await db.asOwner();
      ({ rows } = await db.pg.query<{ daily_capacity: number | null; guests_per_trip: number }>(
        `select daily_capacity, guests_per_trip from activity_options where id = $1`,
        [seed.optionId],
      ));
      expect(rows[0]).toEqual({ daily_capacity: null, guests_per_trip: null });
    });

    it("a private option's guests/trip lands in private_max_guests, floored at the base's covered heads", async () => {
      await db.asOwner();
      const seed = await seedOccurrence(db, 10);
      const priv = await seedPrivateOption(db, seed, {
        baseMinor: 65000,
        included: 4,
        extraMinor: 8000,
        maxGuests: 10,
        tripsPerDay: 2,
      });
      await db.as({ sub: STAFF, role: 'authenticated' });
      await db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
        JSON.stringify({ activityId: seed.activityId, optionId: priv.optionId, guestsPerTrip: 12 }),
      ]);
      await db.asOwner();
      const { rows } = await db.pg.query<{ private_max_guests: number; guests_per_trip: number }>(
        `select private_max_guests, guests_per_trip from activity_options where id = $1`,
        [priv.optionId],
      );
      // Routed to the private cap; the shared column stays untouched (it's meaningless there).
      expect(rows[0]).toEqual({ private_max_guests: 12, guests_per_trip: null });

      // Below the covered heads → a clean refusal, not a constraint blowup.
      await db.as({ sub: STAFF, role: 'authenticated' });
      await expect(
        db.pg.query(`select set_daily_capacity_atomic($1::jsonb)`, [
          JSON.stringify({
            activityId: seed.activityId,
            optionId: priv.optionId,
            guestsPerTrip: 3,
          }),
        ]),
      ).rejects.toThrow(/invalid_request/);
      await db.asOwner();
    });
  });
});
