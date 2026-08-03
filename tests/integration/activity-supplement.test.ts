import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';

/**
 * The per-activity supplement (the lobster lunch upgrade) on the REAL money path.
 *
 * The whole point of this feature is that the owner names AND prices it himself, which makes it the
 * one add-on whose price is neither a constant nor a global config table. So the thing worth guarding
 * is that the price still comes from the DB and never from the payload: the client sends a count, the
 * server multiplies. Everything else here is the same discipline every other add-on needs — clamp to
 * the party, survive an idempotency replay, and stay silent on an activity that has no supplement.
 */
const CUSTOMER = 'e2e2e2e2-e2e2-e2e2-e2e2-e2e2e2e2e2e2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('per-activity supplement', () => {
  let db: TestDb;
  let occurrenceId: string;
  let activityId: string;
  let slug: string;

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
    await db.pg.query(
      `update activities set supplement_name = 'Lobster for lunch', supplement_minor = 2500 where id = $1`,
      [activityId],
    );
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_get_activity ships the supplement name and per-person price', async () => {
    const data = await call<{ supplementName: string | null; supplementEur: number | null }>(
      db,
      'api_get_activity',
      { slug },
    );
    expect(data.supplementName).toBe('Lobster for lunch');
    expect(data.supplementEur).toBe(25);
  });

  it('prefers the French label but keeps the English price', async () => {
    await db.asOwner();
    await db.pg.query(
      `insert into activity_translations (activity_id, locale, supplement_name)
       values ($1, 'fr', 'Homard au déjeuner')`,
      [activityId],
    );
    const fr = await call<{ supplementName: string | null; supplementEur: number | null }>(
      db,
      'api_get_activity',
      { slug, locale: 'fr' },
    );
    expect(fr.supplementName).toBe('Homard au déjeuner');
    expect(fr.supplementEur).toBe(25);
  });

  it('charges the DB price per guest who wanted it, and snapshots the label', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{
      ref: string;
      totalEur: number;
      supplementName: string | null;
      supplementQty: number;
      supplementEur: number;
    }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      supplementQty: 2,
      customerName: 'Supplement Tester',
      customerEmail: 'supp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-1',
    });
    expect(booking.totalEur).toBe(275); // 3 × €75 + 2 × €25
    expect(booking.supplementName).toBe('Lobster for lunch');
    expect(booking.supplementQty).toBe(2);
    expect(booking.supplementEur).toBe(50);
  });

  it('is not re-charged when the same idempotency key is replayed', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const replay = await apiBook<{ totalEur: number; supplementQty: number }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 3 },
      supplementQty: 2,
      customerName: 'Supplement Tester',
      customerEmail: 'supp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-1',
    });
    // Unguarded, the replay would add another €50 to a booking that may already be paying.
    expect(replay.totalEur).toBe(275);
    expect(replay.supplementQty).toBe(2);
  });

  it('clamps the count to the party — more lobsters than guests is not payable', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ totalEur: number; supplementQty: number }>(db, {
      occurrenceId,
      expectedSlug: slug,
      party: { Adult: 2 },
      supplementQty: 99,
      customerName: 'Greedy Tester',
      customerEmail: 'greedy@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-clamp',
    });
    expect(booking.supplementQty).toBe(2);
    expect(booking.totalEur).toBe(200); // 2 × €75 + 2 × €25 — never 99 × €25
  });

  it('charges nothing on an activity with no supplement configured', async () => {
    await db.asOwner();
    const other = await seedOccurrence(db, 10);
    const { rows } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = $1`,
      [other.activityId],
    );
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{
      totalEur: number;
      supplementQty: number;
      supplementName: string | null;
    }>(db, {
      occurrenceId: other.occurrenceId,
      expectedSlug: rows[0]!.slug,
      party: { Adult: 2 },
      supplementQty: 2, // a hand-edited payload on an activity that sells no supplement
      customerName: 'No Supplement',
      customerEmail: 'nosupp@example.com',
      source: 'web',
      idempotencyKey: 'supplement-book-none',
    });
    expect(booking.totalEur).toBe(150); // 2 × €75, nothing added
    expect(booking.supplementQty).toBe(0);
    expect(booking.supplementName).toBeNull();
  });
});
