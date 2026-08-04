import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';

/**
 * The per-activity supplements (the lobster lunch upgrade and friends) on the REAL money path —
 * MANY per activity since 20260908000000 (activity_supplements → booking_supplements).
 *
 * The whole point of this feature is that the owner names AND prices each one himself, which makes
 * them the add-ons whose prices are neither constants nor a global config table. So the thing worth
 * guarding is that every price still comes from the DB and never from the payload: the client sends
 * ids + counts, the server resolves and multiplies. Everything else here is the same discipline
 * every other add-on needs — clamp to the party, survive an idempotency replay, ignore foreign ids,
 * and stay silent on an activity that sells nothing.
 */
const CUSTOMER = 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

type BookingSupplement = { name: string; qty: number; unitEur: number; totalEur: number };

describe('per-activity supplements', () => {
  let db: TestDb;
  let occurrenceId: string;
  let activityId: string;
  let slug: string;
  let lobsterId: string;
  let snorkelId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const seed = await seedOccurrence(db, 10); // per_person activity, one 'Adult' 7500 tier
    occurrenceId = seed.occurrenceId;
    activityId = seed.activityId;
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [seed.activityId],
    );
    slug = rows[0]!.slug;
    const { rows: supps } = await db.pg.query<{ id: string }>(
      `insert into activity_supplements (activity_id, name, name_fr, price_minor, position)
       values ($1, 'Lobster for lunch', 'Homard au déjeuner', 2500, 0),
              ($1, 'Snorkel gear', null, 800, 1)
       returning id`,
      [activityId],
    );
    lobsterId = supps[0]!.id;
    snorkelId = supps[1]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_get_activity ships every supplement with id, name and per-person price', async () => {
    const data = await call<{
      supplements: Array<{ id: string; name: string; priceEur: number }>;
    }>(db, 'api_get_activity', { slug });
    expect(data.supplements).toEqual([
      { id: lobsterId, name: 'Lobster for lunch', priceEur: 25 },
      { id: snorkelId, name: 'Snorkel gear', priceEur: 8 },
    ]);
  });

  it('prefers the French label per supplement but keeps the English fallback and price', async () => {
    const fr = await call<{
      supplements: Array<{ id: string; name: string; priceEur: number }>;
    }>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.supplements).toEqual([
      { id: lobsterId, name: 'Homard au déjeuner', priceEur: 25 },
      // No FR label → falls back to the English name; the price is never translated.
      { id: snorkelId, name: 'Snorkel gear', priceEur: 8 },
    ]);
  });

  it('charges each DB price per guest who wanted it, and snapshots every label', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{
      ref: string;
      totalEur: number;
      supplements: BookingSupplement[];
    }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      supplements: [
        { id: lobsterId, qty: 2 },
        { id: snorkelId, qty: 3 },
      ],
      customerName: 'Supplement Tester',
      customerEmail: 'supp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-1',
    });
    expect(booking.totalEur).toBe(299); // 3 × €75 + 2 × €25 + 3 × €8
    expect(booking.supplements).toEqual([
      { name: 'Lobster for lunch', qty: 2, unitEur: 25, totalEur: 50 },
      { name: 'Snorkel gear', qty: 3, unitEur: 8, totalEur: 24 },
    ]);
  });

  it('is not re-charged when the same idempotency key is replayed', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const replay = await apiBook<{ totalEur: number; supplements: BookingSupplement[] }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      supplements: [
        { id: lobsterId, qty: 2 },
        { id: snorkelId, qty: 3 },
      ],
      customerName: 'Supplement Tester',
      customerEmail: 'supp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-1',
    });
    // Unguarded, the replay would add another €74 to a booking that may already be paying.
    expect(replay.totalEur).toBe(299);
    expect(replay.supplements).toHaveLength(2);
  });

  it('clamps every count to the party, and aggregates a duplicated id instead of double-inserting', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ totalEur: number; supplements: BookingSupplement[] }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 2 },
      supplements: [
        { id: lobsterId, qty: 99 }, // more lobsters than guests is not payable
        { id: lobsterId, qty: 2 }, // a duplicated id must not become a second row / second charge
      ],
      customerName: 'Greedy Tester',
      customerEmail: 'greedy@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-clamp',
    });
    expect(booking.supplements).toEqual([
      { name: 'Lobster for lunch', qty: 2, unitEur: 25, totalEur: 50 },
    ]);
    expect(booking.totalEur).toBe(200); // 2 × €75 + 2 × €25 — never 101 × €25
  });

  it("ignores another activity's supplement id (zero-trust by id)", async () => {
    await db.asOwner();
    const other = await seedOccurrence(db, 10);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [other.activityId],
    );
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ totalEur: number; supplements: BookingSupplement[] }>(db, {
      occurrenceId: other.occurrenceId,
      expectedSlug: rows[0]!.slug,
      party: { Adult: 2 },
      // A hand-edited payload quoting the FIRST activity's supplement on an activity that sells none.
      supplements: [{ id: lobsterId, qty: 2 }],
      customerName: 'No Supplement',
      customerEmail: 'nosupp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-none',
    });
    expect(booking.totalEur).toBe(150); // 2 × €75, nothing added
    expect(booking.supplements).toEqual([]);
  });

  it('migrated the legacy single-supplement columns into activity_supplements once', async () => {
    await db.asOwner();
    // The 20260908000000 backfill ran during migration on an empty catalogue; prove the idempotent
    // shape directly: an activity with ONLY the frozen columns set gains exactly one row, and
    // re-running the same insert-where-not-exists adds nothing.
    const legacy = await seedOccurrence(db, 5);
    await db.pg.query(
      `update activities set supplement_name = 'Old lobster', supplement_minor = 1200 where id = $1`,
      [legacy.activityId],
    );
    const backfill = `
      insert into activity_supplements (activity_id, name, name_fr, price_minor, position)
      select a.id, btrim(a.supplement_name), nullif(btrim(coalesce(t.supplement_name, '')), ''),
             coalesce(a.supplement_minor, 0), 0
      from activities a
      left join activity_translations t on t.activity_id = a.id and t.locale = 'fr'
      where nullif(btrim(coalesce(a.supplement_name, '')), '') is not null
        and not exists (select 1 from activity_supplements s where s.activity_id = a.id)`;
    await db.pg.exec(backfill);
    await db.pg.exec(backfill);
    const { rows } = await db.pg.query<{ name: string; price_minor: number }>(
      `select name, price_minor from activity_supplements where activity_id = $1`,
      [legacy.activityId],
    );
    expect(rows).toEqual([{ name: 'Old lobster', price_minor: 1200 }]);
  });
});
