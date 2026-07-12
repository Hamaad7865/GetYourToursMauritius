import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';

async function call<T>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

// Last second of "today" (Mauritius local) and noon "tomorrow" (Mauritius local).
const TODAY_END_MU = `(((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp at time zone 'Indian/Mauritius') - interval '1 second'`;
const TOMORROW_NOON_MU = `(((now() at time zone 'Indian/Mauritius')::date + 1)::timestamp + interval '12 hours') at time zone 'Indian/Mauritius'`;
/** Noon, N days out (Mauritius local) — for the per-activity lead-time tests. */
const noonInDaysMu = (n: number): string =>
  `(((now() at time zone 'Indian/Mauritius')::date + ${n})::timestamp + interval '12 hours') at time zone 'Indian/Mauritius'`;

describe('audit fixes', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  describe('no same-day bookings — earliest bookable day is tomorrow (Mauritius)', () => {
    let optionId: string;
    let todaySlot: string;
    let tomorrowSlot: string;

    beforeAll(async () => {
      await db.asOwner();
      const operatorId = (
        await db.pg.query<{ id: string }>(
          `insert into operators (name, slug) values ('Tmrw Co', 'tmrw-co') returning id`,
        )
      ).rows[0]!.id;
      const activityId = (
        await db.pg.query<{ id: string }>(
          `insert into activities (operator_id, slug, title, category, status, daily_capacity, duration_minutes)
           values ($1, 'tmrw-tour', 'Tmrw Tour', 'Sightseeing tours', 'published', 6, 120) returning id`,
          [operatorId],
        )
      ).rows[0]!.id;
      optionId = (
        await db.pg.query<{ id: string }>(
          `insert into activity_options (activity_id, name, position) values ($1, 'Shared', 0) returning id`,
          [activityId],
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
        [optionId],
      );
      todaySlot = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, ${TODAY_END_MU}, ${TODAY_END_MU} + interval '2 hours', 6, 'open') returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
      tomorrowSlot = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, ${TOMORROW_NOON_MU}, ${TOMORROW_NOON_MU} + interval '2 hours', 6, 'open') returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
    });

    it('create_hold rejects a today occurrence (occurrence_too_soon)', async () => {
      await expect(
        db.pg.query(`select create_hold($1, 1, 'too-soon')`, [todaySlot]),
      ).rejects.toThrow(/occurrence_too_soon/);
    });

    it('create_hold accepts a tomorrow occurrence', async () => {
      const { rows } = await db.pg.query<{ id: string }>(
        `select * from create_hold($1, 1, 'ok-tmrw')`,
        [tomorrowSlot],
      );
      expect(rows[0]!.id).toBeTruthy();
    });

    it('api_list_availability never advertises today, only tomorrow+', async () => {
      await db.as(null);
      const slots = await call<Array<{ occurrenceId: string }>>(db, 'api_list_availability', {
        slug: 'tmrw-tour',
      });
      await db.asOwner();
      expect(slots.find((s) => s.occurrenceId === todaySlot)).toBeUndefined();
      expect(slots.find((s) => s.occurrenceId === tomorrowSlot)).toBeDefined();
    });
  });

  describe('per-activity minimum advance booking (min_advance_days = 3)', () => {
    let twoDaySlot: string;
    let threeDaySlot: string;

    beforeAll(async () => {
      await db.asOwner();
      const operatorId = (
        await db.pg.query<{ id: string }>(
          `insert into operators (name, slug) values ('Lead Co', 'lead-co') returning id`,
        )
      ).rows[0]!.id;
      const activityId = (
        await db.pg.query<{ id: string }>(
          `insert into activities (operator_id, slug, title, category, status, daily_capacity, duration_minutes, min_advance_days)
           values ($1, 'lead-tour', 'Lead Tour', 'Sightseeing tours', 'published', 6, 120, 3) returning id`,
          [operatorId],
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
      twoDaySlot = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, ${noonInDaysMu(2)}, ${noonInDaysMu(2)} + interval '2 hours', 6, 'open') returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
      threeDaySlot = (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
           values ($1, $2, ${noonInDaysMu(3)}, ${noonInDaysMu(3)} + interval '2 hours', 6, 'open') returning id`,
          [optionId, operatorId],
        )
      ).rows[0]!.id;
    });

    it('create_hold rejects a slot sooner than the lead time (occurrence_too_soon)', async () => {
      await expect(
        db.pg.query(`select create_hold($1, 1, 'lead-too-soon')`, [twoDaySlot]),
      ).rejects.toThrow(/occurrence_too_soon/);
    });

    it('create_hold accepts a slot at the lead time', async () => {
      const { rows } = await db.pg.query<{ id: string }>(
        `select * from create_hold($1, 1, 'lead-ok')`,
        [threeDaySlot],
      );
      expect(rows[0]!.id).toBeTruthy();
    });

    it('api_list_availability hides slots inside the lead window', async () => {
      await db.as(null);
      const slots = await call<Array<{ occurrenceId: string }>>(db, 'api_list_availability', {
        slug: 'lead-tour',
      });
      await db.asOwner();
      expect(slots.find((s) => s.occurrenceId === twoDaySlot)).toBeUndefined();
      expect(slots.find((s) => s.occurrenceId === threeDaySlot)).toBeDefined();
    });
  });

  describe('F23 — replaying an unowned guest booking key requires the right email', () => {
    let occurrenceId: string;
    const KEY = 'guest-replay-key';

    beforeAll(async () => {
      const seeded = await seedOccurrence(db, 5); // occurrence is 2 days out → bookable
      occurrenceId = seeded.occurrenceId;
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
        [seeded.optionId],
      );
      // A historical GUEST booking (user_id NULL). Anon can no longer execute api_book (lockdown), so
      // create it as the server would have (service_role: auth.uid() is null → unowned booking).
      await db.as({ role: 'service_role' });
      await apiBook(db, {
        occurrenceId,
        party: { Adult: 1 },
        idempotencyKey: KEY,
        customerName: 'Real Guest',
        customerEmail: 'guest@example.com',
        source: 'web',
      });
      await db.asOwner();
    });

    it('an AUTHENTICATED caller replaying the key with a mismatched email is refused', async () => {
      await db.as({
        sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        role: 'authenticated',
        email: 'attacker@evil.com',
      });
      // apiBook derives actorUserId from the current (attacker) session, so the F23 guard fires exactly
      // as it would in production (server passes the verified caller id).
      await expect(
        apiBook(db, {
          occurrenceId,
          party: { Adult: 1 },
          idempotencyKey: KEY,
          customerEmail: 'attacker@evil.com',
          source: 'web',
        }),
      ).rejects.toThrow(/forbidden/);
      await db.asOwner();
    });

    it('a retry with the right guest email still returns the booking', async () => {
      // The retry also arrives via the server path (service_role, no auth.uid()) — F23's email match
      // is what authorizes returning the row.
      await db.as({ role: 'service_role' });
      const dto = await apiBook<{ ref: string }>(db, {
        occurrenceId,
        party: { Adult: 1 },
        idempotencyKey: KEY,
        customerEmail: 'guest@example.com',
        source: 'web',
      });
      await db.asOwner();
      expect(dto.ref).toBeTruthy();
    });
  });

  describe('release_hold authorization', () => {
    it('is not executable by a plain authenticated customer', async () => {
      await db.as({ sub: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', role: 'authenticated' });
      await expect(
        db.pg.query(`select release_hold('00000000-0000-0000-0000-000000000000'::uuid)`),
      ).rejects.toThrow(/permission denied/i);
      await db.asOwner();
    });
  });
});
