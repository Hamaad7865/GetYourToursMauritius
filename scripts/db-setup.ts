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

/**
 * Tolerant connection-string parser: splits creds/host on the LAST '@' and user/password
 * on the FIRST ':', so an un-encoded special char in the password (e.g. '@', ':') still
 * parses correctly. Returns a pg config object (pg does not require URL-encoding there).
 */
function buildClientConfig(url: string): pg.ClientConfig {
  const m = url.match(/^postgres(?:ql)?:\/\/(.+)$/i);
  if (!m) throw new Error('SUPABASE_DB_URL must start with postgres:// or postgresql://');
  const rest = m[1]!;
  const at = rest.lastIndexOf('@');
  if (at === -1) throw new Error('SUPABASE_DB_URL is missing "@host"');
  const creds = rest.slice(0, at);
  let hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon === -1 ? creds : creds.slice(0, colon);
  const password = colon === -1 ? '' : creds.slice(colon + 1);
  let database = 'postgres';
  const slash = hostPart.indexOf('/');
  if (slash !== -1) {
    database = hostPart.slice(slash + 1).split('?')[0] || 'postgres';
    hostPart = hostPart.slice(0, slash);
  }
  const [host, portStr] = hostPart.split(':');
  return {
    host,
    port: portStr ? Number(portStr) : 5432,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  };
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

const client = new pg.Client(buildClientConfig(url));

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
    console.error('✗', e.code ?? '', e.message ?? error);
  }
  if (e.code && ['ENETUNREACH', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code)) {
    console.error(
      '\nCouldn\'t reach the host. The direct host (db.<ref>.supabase.co) is often IPv6-only.\n' +
        'Use the IPv4 "Session pooler" string from Supabase → Connect → Session pooler\n' +
        '(host like aws-0-<region>.pooler.supabase.com, user like postgres.<ref>).',
    );
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
