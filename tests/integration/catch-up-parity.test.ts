import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * supabase/catch-up.sql is the hand-maintained "apply everything to the drifting live DB" script the
 * operator pastes into the Supabase SQL editor. Nothing else exercised it, which is exactly how it
 * silently fell behind the migrations (it was missing the whole 20260617120000–120500 fix series).
 *
 * This guards it two ways:
 *  1. REGRESSION — apply every migration (the source of truth), then apply catch-up.sql ON TOP. If
 *     catch-up carries an OLDER body for any function the migrations later fixed, its create-or-replace
 *     overwrites the correct version and the normalised body no longer matches. When catch-up is in
 *     parity, applying it on top is a no-op.
 *  2. OMISSION — additive objects (a trigger, an index, a column default) are already present in the
 *     migrated DB, so #1 can't see them missing from the script. Assert their DDL is present in the
 *     catch-up.sql text directly.
 */

const CATCH_UP = readFileSync(join(process.cwd(), 'supabase', 'catch-up.sql'), 'utf8');

/** Collapse whitespace, strip line comments + case so equivalent bodies compare equal. */
const norm = (s: string): string =>
  s
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

async function functionBodies(db: TestDb): Promise<Map<string, string>> {
  const { rows } = await db.pg.query<{ sig: string; prosrc: string }>(
    `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosrc
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prolang <> (select oid from pg_language where lanname = 'internal')`,
  );
  return new Map(rows.map((r) => [r.sig, norm(r.prosrc)]));
}

describe('catch-up.sql stays in parity with the migrations', () => {
  let migrated: Map<string, string>;
  let patched: Map<string, string>;
  let db: TestDb;

  beforeAll(async () => {
    // One PGlite instance (this suite runs in parallel with the other PGlite suites — two full DBs
    // here contends for WASM memory and flakes). Snapshot every function body after the migrations,
    // then layer catch-up.sql on top and snapshot again: a body that changed is one catch-up ships
    // stale; an unchanged body means catch-up's create-or-replace matched the migration.
    db = await createTestDb();
    migrated = await functionBodies(db); // source of truth — the migrations
    await db.pg.exec(CATCH_UP); // layer catch-up.sql on top (must be idempotent)
    patched = await functionBodies(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies on top of a fully-migrated database without error', () => {
    // Reaching beforeAll's end means db.exec(CATCH_UP) ran clean (idempotent on a current DB).
    expect(patched.size).toBeGreaterThan(0);
  });

  it('ships no function with a body older than the migrations', () => {
    const drifted: string[] = [];
    for (const [sig, body] of migrated) {
      const after = patched.get(sig);
      if (after !== undefined && after !== body) drifted.push(sig);
    }
    expect(
      drifted,
      `catch-up.sql redefines these with a stale body (run the migration's version into catch-up): ${drifted.join(', ')}`,
    ).toEqual([]);
  });

  // Re-runs catch-up.sql against the SAME db beforeAll already patched (a second createTestDb here
  // contends for WASM memory and flakes — see beforeAll). That re-run is exactly the scenario this
  // guards: the operator pastes catch-up.sql after every deploy.
  it('preserves owner-tuned airport fares across a catch-up.sql re-run', async () => {
    // Simulate the owner tuning fares in /admin, away from the seeded placeholders.
    await db.pg.exec(
      `update airport_transfer_fare set sedan_minor = 9999, suv_minor = 8888 where zone = 'zone1'`,
    );

    // Re-run catch-up.sql, exactly as the operator does after a deploy.
    await db.pg.exec(CATCH_UP);

    const { rows } = await db.pg.query<{ sedan_minor: number; suv_minor: number }>(
      `select sedan_minor, suv_minor from airport_transfer_fare where zone = 'zone1'`,
    );
    // Before the guard, `drop table if exists airport_transfer_fare` fired unconditionally on every
    // run, so the tuned rates silently reverted to the seeded placeholders (5500/7000) — wiping the
    // owner's pricing with a completely green deploy.
    expect(rows[0]?.sedan_minor, 'catch-up.sql reset a tuned airport fare').toBe(9999);
    expect(rows[0]?.suv_minor, 'catch-up.sql reset a tuned airport fare').toBe(8888);
  });

  it('contains the additive objects from the 120000–120500 fix series', () => {
    const required: Array<[string, RegExp]> = [
      ['bookings_no_public_insert trigger (F2 forged-booking guard)', /bookings_no_public_insert/],
      ['notification lease column (F4 duplicate emails)', /locked_until/],
      ['leads rate-limit index (F7)', /leads_ip_created_idx/],
      ['30-minute hold default (F19)', /interval '30 minutes'/],
      ['reopen closed availability (F5)', /set status = 'open'/],
      ['availability past-slot filter (F16)', /starts_at > now\(\)/],
      ['generic rate-limit table (P0 wallet-DoS)', /create table if not exists rate_limits/],
      ['generic rate-limit function (P0 wallet-DoS)', /function api_rate_limit/],
    ];
    const missing = required.filter(([, re]) => !re.test(CATCH_UP)).map(([label]) => label);
    expect(missing, `catch-up.sql is missing: ${missing.join('; ')}`).toEqual([]);
  });
});
