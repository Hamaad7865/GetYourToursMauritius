import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * THE ROUTE MUST OUTLIVE THE BROWSER TAB.
 *
 * A Custom Road Trip (`pricing_mode = 'vehicle_custom'`) is a full-day private vehicle whose entire
 * deliverable is the list of places. That list used to travel from the AI planner to checkout through
 * a single sessionStorage key — nothing server-side saw it until api_book. On 9 Aug 2026 booking
 * BMTFF77DC5CDD471 confirmed and was PAID with `custom_itinerary` NULL: a full day of driving sold,
 * with no route and no way to recover one, because booking_holds had nowhere to keep a copy.
 *
 * So the route is now captured at HOLD time — the first moment the server hears about the booking —
 * and read back at pay when the browser no longer has it. These tests pin that contract against the
 * real migrated schema, including the two ways it could silently rot: a replayed hold blanking a
 * stored route, and api_hold_route reporting the wrong pricing mode (which is what decides whether a
 * missing route is fatal).
 */
const CUSTOMER = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';
const ROUTE = [
  { title: 'Bois Cheri Tea Factory', area: 'South', lat: -20.4263291, lng: 57.5256586 },
  { title: 'Chamarel Seven Coloured Earth', area: 'South', lat: -20.4400767, lng: 57.3731676 },
];

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('a held custom trip keeps its route server-side', () => {
  let db: TestDb;
  let customOcc: string;
  let plainOcc: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    // Two activities: the planner product, and an ordinary per-person tour that must be unaffected.
    const mk = async (slug: string, mode: string): Promise<string> => {
      const act = (
        await db.pg.query<{ id: string }>(
          `insert into activities (operator_id, slug, title, category, status, pricing_mode)
           values ($1, $2, $3, 'Taxi Sightseeing tours', 'published', $4) returning id`,
          [operatorId, slug, slug, mode],
        )
      ).rows[0]!.id;
      const opt = (
        await db.pg.query<{ id: string }>(
          `insert into activity_options (activity_id, name) values ($1, 'Private vehicle') returning id`,
          [act],
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into activity_option_prices (activity_option_id, label, amount_minor)
         values ($1, 'Per vehicle', 10000)`,
        [opt],
      );
      return (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
           values ($1, $2, now() + interval '30 days', now() + interval '30 days 8 hours', 20)
           returning id`,
          [opt, operatorId],
        )
      ).rows[0]!.id;
    };
    customOcc = await mk('custom-road-trip-t', 'vehicle_custom');
    plainOcc = await mk('catamaran-t', 'per_person');
    await db.as({ role: 'service_role' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores the route the planner sent with the hold', async () => {
    const hold = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: customOcc,
      people: 2,
      idempotencyKey: 'route-1',
      userId: CUSTOMER,
      itinerary: ROUTE,
    });
    const { rows } = await db.pg.query<{ custom_itinerary: typeof ROUTE }>(
      `select custom_itinerary from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(rows[0]!.custom_itinerary).toEqual(ROUTE);
  });

  it('hands the stored route back with the occurrence’s pricing mode', async () => {
    const hold = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: customOcc,
      people: 2,
      idempotencyKey: 'route-2',
      userId: CUSTOMER,
      itinerary: ROUTE,
    });
    const ctx = await call<{ pricingMode: string; itinerary: typeof ROUTE }>(db, 'api_hold_route', {
      occurrenceId: customOcc,
      holdId: hold.holdId,
    });
    // The mode comes from the OCCURRENCE, never the caller — it is what decides whether a missing
    // route is fatal, so a client able to assert it could opt out of the check.
    expect(ctx.pricingMode).toBe('vehicle_custom');
    expect(ctx.itinerary).toEqual(ROUTE);
  });

  it('never lets a replayed hold blank a route it already stored', async () => {
    // create_hold returns the EXISTING hold for a repeated idempotency key. The planner retries on a
    // flaky network, and the retry can carry no route (the day was cleared, the tab reloaded) — if
    // that overwrote, the durable copy would be destroyed by the very retry meant to be harmless.
    const first = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: customOcc,
      people: 2,
      idempotencyKey: 'route-replay',
      userId: CUSTOMER,
      itinerary: ROUTE,
    });
    const replay = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: customOcc,
      people: 2,
      idempotencyKey: 'route-replay',
      userId: CUSTOMER,
      itinerary: null,
    });
    expect(replay.holdId).toBe(first.holdId);
    const { rows } = await db.pg.query<{ custom_itinerary: typeof ROUTE }>(
      `select custom_itinerary from booking_holds where id = $1`,
      [first.holdId],
    );
    expect(rows[0]!.custom_itinerary).toEqual(ROUTE);
  });

  it('treats an empty array as no route, so it cannot mask a lost one', async () => {
    // `[]` is what a day with every stop removed serializes to. Storing it would satisfy the
    // "has a route" test at pay while still being undeliverable — the exact failure, one layer along.
    const hold = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: customOcc,
      people: 2,
      idempotencyKey: 'route-empty',
      userId: CUSTOMER,
      itinerary: [],
    });
    const { rows } = await db.pg.query<{ custom_itinerary: unknown }>(
      `select custom_itinerary from booking_holds where id = $1`,
      [hold.holdId],
    );
    expect(rows[0]!.custom_itinerary).toBeNull();
  });

  it('leaves every other activity alone — no route, no column, no complaint', async () => {
    const hold = await call<{ holdId: string }>(db, 'api_create_hold', {
      occurrenceId: plainOcc,
      people: 2,
      idempotencyKey: 'route-plain',
      userId: CUSTOMER,
    });
    const ctx = await call<{ pricingMode: string; itinerary: unknown }>(db, 'api_hold_route', {
      occurrenceId: plainOcc,
      holdId: hold.holdId,
    });
    expect(ctx.pricingMode).toBe('per_person');
    expect(ctx.itinerary).toBeNull();
  });

  it('answers with a null route rather than failing when there is no hold at all', async () => {
    // api_book can be reached with no hold id (the hold is optional). The lookup must still resolve,
    // because the SERVICE decides what a missing route means — a throw here would 500 the booking.
    const ctx = await call<{ pricingMode: string; itinerary: unknown }>(db, 'api_hold_route', {
      occurrenceId: customOcc,
      holdId: null,
    });
    expect(ctx.pricingMode).toBe('vehicle_custom');
    expect(ctx.itinerary).toBeNull();
  });
});
