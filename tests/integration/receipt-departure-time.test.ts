import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence, type SeedResult } from '../db/seed';

/**
 * The guest's confirmation email + invoice printed `12:00 MUT` for every tour: the day-slot's
 * placeholder clock (materialize_availability puts every slot at noon). The real departure is the start
 * time staff type on the activity (`extra.startWindow`) or its option (`activity_options.start_window`).
 * 20261027120000 returns it from api_booking_receipt as `startWindow`, as typed, for the app to parse —
 * the option's own first, the same precedence as the public "at a glance" facts.
 */
describe('api_booking_receipt — the tour start time', () => {
  let db: TestDb;
  let seed: SeedResult;
  let bookingId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    seed = await seedOccurrence(db, 20);
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId: seed.occurrenceId,
      party: { Adult: 2 },
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      source: 'web',
      idempotencyKey: 'receipt-departure-12345678',
    });
    await db.asOwner();
    bookingId = (
      await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [booking.ref])
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  async function receipt(): Promise<Record<string, unknown>> {
    const { rows } = await db.pg.query<{ data: Record<string, unknown> }>(
      `select api_booking_receipt($1::jsonb) as data`,
      [JSON.stringify({ bookingId })],
    );
    return rows[0]!.data;
  }

  async function setStartTimes(activity: string | null, option: string | null): Promise<void> {
    await db.pg.query(
      `update activities
          set extra = case when $2::text is null then coalesce(extra, '{}'::jsonb) - 'startWindow'
                           else coalesce(extra, '{}'::jsonb) || jsonb_build_object('startWindow', $2::text)
                      end
        where id = $1`,
      [seed.activityId, activity],
    );
    await db.pg.query(`update activity_options set start_window = $2 where id = $1`, [
      seed.optionId,
      option,
    ]);
  }

  it('carries no start time when none is set', async () => {
    await setStartTimes(null, null);
    const r = await receipt();
    expect(r).toHaveProperty('startWindow', null);
    // The slot instant still dates the booking — only its clock is a placeholder.
    expect(r.when).toBeTruthy();
  });

  it("carries the activity's start time as typed", async () => {
    await setStartTimes('09:00 - 17:00', null);
    expect((await receipt()).startWindow).toBe('09:00 - 17:00');
  });

  it("prefers the option's own start time", async () => {
    await setStartTimes('09:00', '16:00');
    expect((await receipt()).startWindow).toBe('16:00');
  });

  it("treats a blank option start time as unset and falls back to the activity's", async () => {
    await setStartTimes('09:00', '   ');
    expect((await receipt()).startWindow).toBe('09:00');
  });

  it('leaves the line items exactly as they were', async () => {
    const items = (await receipt()).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ priceLabel: 'Adult', quantity: 2 });
    expect(items[0]).not.toHaveProperty('startWindow');
  });
});
