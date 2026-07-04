import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * supabase/bootstrap.sql = the full migration history concatenated, for standing up a FRESH database in
 * one paste (catch-up.sql is only a delta for the existing DB). This proves the concatenation actually
 * runs from scratch — the whole schema + functions build with nothing pre-existing but the auth shim.
 */
describe('bootstrap.sql builds the full schema from an empty database', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    // Supabase primitives the migrations reference (auth schema, roles, is_staff …) — same as the live DB has.
    await pg.exec(readFileSync(join(process.cwd(), 'tests', 'db', 'auth-shim.sql'), 'utf8'));
    await pg.exec(readFileSync(join(process.cwd(), 'supabase', 'bootstrap.sql'), 'utf8'));
  }, 60_000);

  afterAll(async () => {
    await pg.close();
  });

  it('creates the core tables that catch-up.sql assumes already exist', async () => {
    const { rows } = await pg.query<{ b: string | null; a: string | null; o: string | null }>(
      `select to_regclass('public.bookings') as b, to_regclass('public.activities') as a, to_regclass('public.activity_options') as o`,
    );
    expect(rows[0]).toMatchObject({ b: 'bookings', a: 'activities', o: 'activity_options' });
  });

  it('creates the key booking + catalogue functions', async () => {
    const { rows } = await pg.query<{ proname: string }>(
      `select proname from pg_proc where proname in ('api_book', 'api_get_activity', 'create_booking') order by proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['api_book', 'api_get_activity', 'create_booking']);
  });

  it('includes the latest additive columns (age bands, per-option time, activity sort)', async () => {
    const { rows } = await pg.query<{ col: string }>(
      `select column_name as col from information_schema.columns
        where (table_name = 'activity_option_prices' and column_name in ('min_age','max_age'))
           or (table_name = 'activity_options' and column_name in ('duration_minutes','start_window'))
           or (table_name = 'activities' and column_name = 'sort')`,
    );
    expect(rows.map((r) => r.col).sort()).toEqual(
      ['duration_minutes', 'max_age', 'min_age', 'sort', 'start_window'].sort(),
    );
  });
});
