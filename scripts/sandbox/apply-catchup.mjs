// Apply ONLY supabase/catch-up.sql to the SANDBOX database — a schema sync that brings an
// existing (setup.sql-seeded) sandbox up to the latest migrations. Idempotent, schema-only:
// it does NOT reseed the catalogue, availability, or bookings, so your test data is untouched.
//
//   node scripts/sandbox/apply-catchup.mjs
//
// Reads SUPABASE_DB_URL from .env.local (port-5432 direct/pooler string). Mirrors how
// setup-sandbox.ts applies the file (whole file as one batch, ssl rejectUnauthorized:false).
// Hard guard: refuses to run against the production project ref.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();
const PRODUCTION_REFS = ['dwjkfowhrrvdiqligxcj'];

function loadEnvLocal() {
  const out = {};
  const path = join(root, '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function buildConfig(url) {
  const m = url.match(/^postgres(?:ql)?:\/\/(.+)$/i);
  if (!m) throw new Error('SUPABASE_DB_URL must start with postgres:// or postgresql://');
  const rest = m[1];
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

const env = { ...loadEnvLocal(), ...process.env };
const dbUrl = env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(
    '\n✗ Missing SUPABASE_DB_URL in .env.local (the port-5432 direct connection string).\n',
  );
  process.exit(1);
}
const hitRef = PRODUCTION_REFS.find((ref) => dbUrl.includes(ref));
if (hitRef) {
  console.error(
    `\n✗ REFUSING TO RUN: SUPABASE_DB_URL points at the production project (${hitRef}).\n`,
  );
  process.exit(1);
}

const cfg = buildConfig(dbUrl);
console.log(`Connecting to ${cfg.host}:${cfg.port} (db=${cfg.database})…`);
const sql = readFileSync(join(root, 'supabase', 'catch-up.sql'), 'utf8');
console.log(
  `Applying supabase/catch-up.sql (${sql.split(/\r?\n/).length} lines) — schema sync, no reseed…`,
);
const client = new pg.Client(cfg);
const t0 = Date.now();
try {
  await client.connect();
  await client.query(sql);
  console.log(
    `\n✓ Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. Sandbox schema is now up to date.`,
  );
  console.log('  Reload the sandbox and try checkout again.');
} catch (e) {
  console.error('\n✗ FAILED:', e.message);
  if (e.position) console.error('  (error position in the SQL:', e.position + ')');
  process.exitCode = 1;
} finally {
  await client.end();
}
