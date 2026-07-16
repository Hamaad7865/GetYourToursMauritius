import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration-history integrity (review item 8).
 *
 * Four migration version prefixes were duplicated (…617220000, …729000000, …733000000, …810000000
 * — each held two files), which makes apply order tooling-dependent, and the ledger backfill's
 * `on conflict (version) do nothing` silently dropped the second member of each pair while also
 * lagging behind the migrations directory. The duplicates are renamed (+1 second, order-preserving)
 * and these tests keep both problems from coming back.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const BACKFILL = join(process.cwd(), 'supabase', 'backfill-migration-ledger.sql');

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

describe('migration version prefixes', () => {
  it('every migration has a UNIQUE version prefix (apply order must never be tooling-dependent)', () => {
    const byPrefix = new Map<string, string[]>();
    for (const f of files) {
      const prefix = f.split('_')[0]!;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }
    const dupes = [...byPrefix.entries()].filter(([, names]) => names.length > 1);
    expect(dupes, `duplicate version prefixes: ${JSON.stringify(dupes)}`).toEqual([]);
  });

  it('every prefix is a well-formed 14-digit timestamp', () => {
    for (const f of files) {
      expect(f, `${f} must start with a 14-digit version`).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    }
  });
});

describe('backfill-migration-ledger.sql mirrors the migrations directory 1:1', () => {
  const sql = readFileSync(BACKFILL, 'utf8');
  const rows = [...sql.matchAll(/\('(\d{14})',\s*'([a-z0-9_]+)'\)/g)].map((m) => ({
    version: m[1]!,
    name: m[2]!,
  }));

  it('lists exactly one row per migration file, version AND name matching', () => {
    const expected = files
      .map((f) => {
        const version = f.split('_')[0]!;
        return { version, name: f.slice(version.length + 1).replace(/\.sql$/, '') };
      })
      .sort((a, b) => a.version.localeCompare(b.version));
    const actual = [...rows].sort((a, b) => a.version.localeCompare(b.version));
    // A mismatch here means a migration was added/renamed without updating the ledger backfill —
    // the exact drift that let it silently omit rows before.
    expect(actual).toEqual(expected);
  });

  it('has no duplicate versions (each would be silently dropped by on-conflict-do-nothing)', () => {
    const versions = rows.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
