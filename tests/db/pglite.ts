import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const AUTH_SHIM = join(ROOT, 'tests', 'db', 'auth-shim.sql');

/**
 * Per-process cache of SQL file contents, keyed by absolute path. Each `createTestDb` call would
 * otherwise re-open every migration with `readFileSync`; under vitest's parallel workers two tests in
 * the same process opening the same file concurrently can trip a Windows-only file-handle race
 * ("UNKNOWN: unknown error, open …_ops.sql"). Reading each file at most once and serving the rest from
 * memory removes the concurrent-open contention while keeping full test parallelism.
 */
const sqlCache = new Map<string, string>();
function readSqlCached(path: string): string {
  let sql = sqlCache.get(path);
  if (sql === undefined) {
    sql = readFileSync(path, 'utf8');
    sqlCache.set(path, sql);
  }
  return sql;
}

// `sub` is optional: a service_role token carries no user id (auth.uid() resolves to null).
export type JwtClaims = { sub?: string; role?: string; email?: string } & Record<string, unknown>;

export interface TestDb {
  pg: PGlite;
  /** Switch RLS context: set the Postgres role + JWT claims like Supabase does. null = anonymous. */
  as(claims: JwtClaims | null): Promise<void>;
  /** Back to the superuser/owner context (bypasses RLS) for seeding/setup. */
  asOwner(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Spins up an in-process Postgres (PGlite), applies the Supabase auth shim, then
 * every migration in supabase/migrations in filename order. This is REAL Postgres,
 * so plpgsql, SELECT FOR UPDATE, constraints and RLS all behave as in production.
 *
 * Limitation: single connection — proves logic (capacity, idempotency, policies),
 * not true multi-transaction race contention (a deploy-time property).
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(readSqlCached(AUTH_SHIM));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pg.exec(readSqlCached(join(MIGRATIONS_DIR, file)));
  }

  return {
    pg,
    async as(claims) {
      if (claims === null) {
        await pg.exec(`reset role;`);
        await pg.query(`select set_config('request.jwt.claims', '', false)`);
        await pg.exec(`set role anon;`);
        return;
      }
      const role = claims.role === 'service_role' ? 'service_role' : 'authenticated';
      await pg.exec(`reset role;`);
      await pg.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify(claims),
      ]);
      await pg.exec(`set role ${role};`);
    },
    async asOwner() {
      await pg.exec(`reset role;`);
      await pg.query(`select set_config('request.jwt.claims', '', false)`);
    },
    async close() {
      await pg.close();
    },
  };
}
