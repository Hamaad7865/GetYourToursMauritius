import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Per-option duration + start time (Half day / Full day on one activity, different times). Proves
 * api_get_activity ships each option's own duration_minutes + start_window so the detail page can show
 * the right time when the customer toggles options.
 */
async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('per-option duration + start time', () => {
  let db: TestDb;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const seed = await seedOccurrence(db, 5);
    const { rows } = await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [seed.activityId]);
    slug = rows[0]!.slug;
    await db.pg.query(
      `update activity_options set name = 'Full day', duration_minutes = 540, start_window = '06:00' where id = $1`,
      [seed.optionId],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('api_get_activity ships the option’s own duration + start time', async () => {
    const data = await call<{ options: Array<{ name: string; durationMinutes: number | null; startWindow: string | null }> }>(
      db,
      'api_get_activity',
      { slug },
    );
    expect(data.options[0]).toMatchObject({ name: 'Full day', durationMinutes: 540, startWindow: '06:00' });
  });
});
