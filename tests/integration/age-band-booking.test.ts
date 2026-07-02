import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Age-band pricing end-to-end on the REAL money path: an activity with Adult (full) / Child (half) /
 * Infant (free) tiers, each carrying an age range. Proves (a) api_get_activity ships the age range to the
 * client, and (b) api_book prices EACH band from its own DB tier (zero-trust) — with the free infant still
 * occupying a seat (the owner's choice: everyone takes a seat). No server pricing code changed for this;
 * the multi-tier party was already priced per label — this guards that it stays correct.
 */
const CUSTOMER = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('age-band pricing on api_book / api_get_activity', () => {
  let db: TestDb;
  let occurrenceId: string;
  let optionId: string;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    const seed = await seedOccurrence(db, 10); // per_person activity with one 'Adult' 7500 tier
    occurrenceId = seed.occurrenceId;
    optionId = seed.optionId;
    const { rows } = await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [seed.activityId]);
    slug = rows[0]!.slug;
    // Turn the single tier into three age bands: Adult €56 (11+), Child €28 half (3–10), Infant €0 free (0–3).
    await db.pg.query(
      `update activity_option_prices set amount_minor = 5600, min_age = 11, max_age = null where activity_option_id = $1 and label = 'Adult'`,
      [optionId],
    );
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, min_age, max_age, position)
       values ($1, 'Child', 2800, 3, 10, 1), ($1, 'Infant', 0, 0, 3, 2)`,
      [optionId],
    );
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_get_activity ships each tier with its age range', async () => {
    const data = await call<{
      fromPriceEur: number;
      options: Array<{ prices: Array<{ label: string; amountEur: number; minAge: number | null; maxAge: number | null }> }>;
    }>(db, 'api_get_activity', { slug });
    const prices = data.options[0]!.prices;
    expect(prices.find((p) => p.label === 'Adult')).toMatchObject({ amountEur: 56, minAge: 11, maxAge: null });
    expect(prices.find((p) => p.label === 'Child')).toMatchObject({ amountEur: 28, minAge: 3, maxAge: 10 });
    expect(prices.find((p) => p.label === 'Infant')).toMatchObject({ amountEur: 0, minAge: 0, maxAge: 3 });
    // "From" price must be the cheapest PAID tier (Child €28), NOT the free infant €0.
    expect(data.fromPriceEur).toBe(28);
  });

  it('api_search_activities shows the cheapest PAID from-price (not the free infant)', async () => {
    await db.asOwner();
    const res = await call<{ items: Array<{ slug: string; fromPriceEur: number }> }>(db, 'api_search_activities', {
      pageSize: 50,
    });
    const item = res.items.find((i) => i.slug === slug);
    expect(item?.fromPriceEur).toBe(28);
  });

  it('api_book prices each band from its own tier; the free infant still takes a seat', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 2, Child: 1, Infant: 1 },
      customerName: 'Age Band Tester',
      customerEmail: 'ageband@example.com',
      source: 'web',
      idempotencyKey: 'ageband-book-1',
    });
    expect(booking.totalEur).toBe(140); // 2×56 + 1×28 + 1×0

    await db.asOwner();
    // Everyone (incl. the infant) occupies a seat → 4 held.
    const { rows: cap } = await db.pg.query<{ u: number }>(`select used_capacity($1) as u`, [occurrenceId]);
    expect(Number(cap[0]!.u)).toBe(4);
    // One booking line per band (Adult, Child, Infant).
    const { rows: items } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from booking_items bi
         join bookings b on b.id = bi.booking_id
        where b.idempotency_key = 'ageband-book-1'`,
    );
    expect(items[0]!.n).toBe(3);
  });
});
