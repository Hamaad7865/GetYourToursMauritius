/**
 * Applies supabase/setup.sql to a real Supabase database over its connection
 * string — no copy/paste, so a large file can't be truncated or mangled in transit.
 *
 * 1. Supabase dashboard: Settings -> Database -> Connection string -> URI (with password).
 * 2. Put it in .env.local as:  SUPABASE_DB_URL=postgresql://postgres:...@...:5432/postgres
 *    (Use the direct or "Session pooler" string on port 5432, not the 6543 txn pooler.)
 * 3. Run:  npm run db:setup
 *
 * On a SQL error it prints the exact line/column + surrounding context so any genuine
 * issue is pinpointed immediately.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(root, '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const url = env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    'Missing SUPABASE_DB_URL.\n' +
      'Add it to .env.local — Supabase: Settings -> Database -> Connection string -> URI\n' +
      '(include your DB password; use the :5432 direct/session string, not :6543).',
  );
  process.exit(1);
}

const sql = readFileSync(join(root, 'supabase', 'setup.sql'), 'utf8');

function locate(position: number): string {
  const upto = sql.slice(0, position);
  const line = upto.split('\n').length;
  const col = position - upto.lastIndexOf('\n');
  const all = sql.split('\n');
  const from = Math.max(0, line - 3);
  const ctx = all
    .slice(from, line + 1)
    .map((text, i) => `  ${String(from + i + 1).padStart(5)}${from + i + 1 === line ? ' >' : '  '} ${text}`)
    .join('\n');
  return `at line ${line}, col ${col}:\n${ctx}`;
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log('Connected. Applying supabase/setup.sql …');
  await client.query(sql);
  const { rows } = await client.query<{ n: number }>(
    'select count(*)::int as n from activities',
  );
  console.log(`✓ Applied. activities rows: ${rows[0]?.n ?? 0}`);
} catch (error) {
  const e = error as { code?: string; message?: string; position?: string };
  if (e.position) {
    console.error(`✗ ${e.code ?? ''} ${e.message ?? ''}\n${locate(Number(e.position))}`);
  } else {
    console.error('✗', e.message ?? error);
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
