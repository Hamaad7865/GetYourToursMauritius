import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

/**
 * supabase/setup.sql is the ONE-PASTE FRESH-INSTALL bundle (every migration + the seed, in one
 * transaction) — it is what `npm run db:setup` applies to a brand-new Supabase project. This proves it
 * actually RUNS on an empty database.
 *
 * Why this test exists as well as setup-sql-parity: that one is a pure string compare between the
 * committed file and buildSetupSql(). A bundle that is perfectly in sync yet syntactically broken — or
 * whose seed trips a constraint added by a later migration — passes parity and then fails in the
 * Supabase SQL Editor, which is the worst place to find out.
 *
 * It also replaces the deleted bootstrap.sql test, and pins the property whose ABSENCE made
 * bootstrap.sql dangerous: on a freshly-provisioned DB the anon key must NOT be able to execute the
 * money-path RPCs. bootstrap.sql granted api_book/api_create_hold to anon and never revoked them (it
 * predated the 20260806–20260809 lockdown), so a database built from it could be booked against for
 * free with nothing but the public key. Guard the executed bundle, not just its text.
 */
describe('setup.sql provisions a fresh database', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    // The Supabase primitives a real project already has (auth schema, auth.uid(), the anon /
    // authenticated / service_role roles). buildSetupSql deliberately does NOT bundle these.
    await pg.exec(readFileSync(join(process.cwd(), 'tests', 'db', 'auth-shim.sql'), 'utf8'));
    await pg.exec(readFileSync(join(process.cwd(), 'supabase', 'setup.sql'), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    await pg.close();
  });

  it('builds the core tables and booking functions', async () => {
    const { rows: tables } = await pg.query<{
      b: string | null;
      a: string | null;
      o: string | null;
    }>(
      `select to_regclass('public.bookings') as b,
              to_regclass('public.activities') as a,
              to_regclass('public.activity_options') as o`,
    );
    expect(tables[0]).toMatchObject({ b: 'bookings', a: 'activities', o: 'activity_options' });

    const { rows: fns } = await pg.query<{ proname: string }>(
      `select proname from pg_proc
        where proname in ('api_book', 'api_get_activity', 'create_booking', 'append_payment_event')
        order by proname`,
    );
    expect(fns.map((r) => r.proname)).toEqual([
      'api_book',
      'api_get_activity',
      'append_payment_event',
      'create_booking',
    ]);
  });

  it('includes the LATEST migrations, not a stale subset', async () => {
    // Each of these lands in one of the newest migrations. A bundle that silently stops short — the
    // failure mode that made bootstrap.sql a security hole — fails here.
    const { rows } = await pg.query<{ seo: boolean; posts: string | null; priv: string | null }>(
      `select exists (select 1 from pg_enum e
                        join pg_type t on t.oid = e.enumtypid
                       where t.typname = 'user_role' and e.enumlabel = 'seo')      as seo,
              to_regclass('public.posts')                                          as posts,
              to_regclass('public.seo_redirects')                                  as priv`,
    );
    expect(rows[0]).toMatchObject({ seo: true, posts: 'posts', priv: 'seo_redirects' });
  });

  it('runs the seed (the operator row exists)', async () => {
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from operators`);
    expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('LOCKS the money-path RPCs away from the anon key', async () => {
    // The whole reason bootstrap.sql had to be deleted. `create function` implicitly grants EXECUTE to
    // PUBLIC, and anon is a member of PUBLIC — so this only holds if the lockdown migrations made it
    // into the bundle AND revoked from `public`, not merely from the named roles.
    const { rows } = await pg.query<{ fn: string; anon: boolean }>(
      `select fn, has_function_privilege('anon', fn, 'execute') as anon
         from unnest(array[
           'public.api_book(jsonb)',
           'public.api_create_hold(jsonb)',
           'public.api_record_payment_charge(jsonb)'
         ]) as fn`,
    );
    expect(rows.map((r) => ({ fn: r.fn, anon: r.anon }))).toEqual([
      { fn: 'public.api_book(jsonb)', anon: false },
      { fn: 'public.api_create_hold(jsonb)', anon: false },
      { fn: 'public.api_record_payment_charge(jsonb)', anon: false },
    ]);
  });
});
