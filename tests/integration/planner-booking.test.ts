import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Money path: the planner's parallel `vehicle_custom` pricing books at the planner's OWN flat
 * per-vehicle rates (Standard €95 / SUV €100 / 6-seater €110 / Van €150 / Coach €250, cap 22),
 * read from `planner_pricing` — WITHOUT disturbing the shipped sightseeing `vehicle` pricing
 * (70/85/85/125/225). Runs the real api_book against the real schema (PGlite).
 */

interface BookingDto {
  totalEur: number;
  items: Array<{ priceLabel: string; quantity: number; pax: number | null }>;
}

async function call<T>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('planner vehicle_custom booking', () => {
  let db: TestDb;
  let customOcc: string;
  let sightOcc: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const opId = (
      await db.pg.query<{ id: string }>(`select id from operators where slug = 'belle-mare-tours'`)
    ).rows[0]!.id;

    // Planner activity (vehicle_custom) + occurrence.
    const customAct = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, title, category, pricing_mode, is_custom_planner, status)
         values ($1, 'custom-road-trip', 'Custom Road Trip', 'Sightseeing tours', 'vehicle_custom', true, 'published')
         returning id`,
        [opId],
      )
    ).rows[0]!.id;
    const customOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Private vehicle') returning id`,
        [customAct],
      )
    ).rows[0]!.id;
    customOcc = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, $2, now() + interval '3 days', now() + interval '3 days 6 hours', 20, 'open') returning id`,
        [customOpt, opId],
      )
    ).rows[0]!.id;

    // Sightseeing activity (vehicle) + occurrence — regression guard.
    const sightAct = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, title, category, pricing_mode, status)
         values ($1, 'south-sightseeing', 'South Sightseeing', 'Sightseeing tours', 'vehicle', 'published')
         returning id`,
        [opId],
      )
    ).rows[0]!.id;
    const sightOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Private vehicle') returning id`,
        [sightAct],
      )
    ).rows[0]!.id;
    sightOcc = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, $2, now() + interval '3 days', now() + interval '3 days 6 hours', 20, 'open') returning id`,
        [sightOpt, opId],
      )
    ).rows[0]!.id;

    await db.as(null); // book as the anonymous public
  });

  afterAll(async () => {
    await db.close();
  });

  async function book(occ: string, party: number, suv: boolean, key: string): Promise<BookingDto> {
    return call<BookingDto>(db, 'api_book', {
      occurrenceId: occ,
      party: { Adult: party },
      suv,
      customerName: 'Test Traveller',
      customerEmail: 'test@example.com',
      source: 'web',
      idempotencyKey: key,
    });
  }

  it('prices the planner brackets from planner_pricing, reserving ONE vehicle with pax on board', async () => {
    const standard = await book(customOcc, 2, false, 'pl-standard-1');
    expect(standard.totalEur).toBe(95);
    expect(standard.items[0]!.priceLabel).toBe('Standard car');
    expect(standard.items[0]!.quantity).toBe(1);
    expect(standard.items[0]!.pax).toBe(2);

    expect((await book(customOcc, 3, true, 'pl-suv-1')).totalEur).toBe(100);
    expect((await book(customOcc, 6, false, 'pl-six-1')).totalEur).toBe(110);
    expect((await book(customOcc, 10, false, 'pl-van-1')).totalEur).toBe(150);
    expect((await book(customOcc, 20, false, 'pl-coach-1')).totalEur).toBe(250);
  });

  it('rejects a planner party over the cap of 22', async () => {
    await expect(book(customOcc, 23, false, 'pl-over-1')).rejects.toThrow();
  });

  it('leaves the sightseeing vehicle pricing untouched (€70 for a party of 2)', async () => {
    expect((await book(sightOcc, 2, false, 'sight-1')).totalEur).toBe(70);
  });
});
