/**
 * Apply the live-catalogue dump to the SANDBOX.
 *
 *   1. (first, with PROD creds) npx tsx scripts/dump-catalogue.ts   → regenerates
 *      supabase/seed-live-catalogue.sql from production (read-only, no PII).
 *   2. (with SANDBOX .env.local)  npm run sandbox:from-live         → this script.
 *
 * It replaces the sandbox catalogue + all pricing/fare config with production's real
 * data, rebuilds ~185 days of availability, and re-creates the fake bookings against
 * the real catalogue. The dump contains NO bookings, payments, customers or PII.
 *
 * Safety: refuses to run against the production project (never writes prod).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();
const PRODUCTION_REFS = ['dwjkfowhrrvdiqligxcj'];

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
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

const env = { ...loadEnvLocal(), ...process.env };
const dbUrl = env.SUPABASE_DB_URL;
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
if (!dbUrl) {
  console.error('✗ Missing SUPABASE_DB_URL in .env.local');
  process.exit(1);
}

const target = `${supabaseUrl} ${dbUrl}`;
const hitRef = PRODUCTION_REFS.find((ref) => target.includes(ref));
if (hitRef) {
  console.error(
    `\n✗ REFUSING TO RUN: target points at the production project (${hitRef}).\n` +
      '  This replaces the catalogue and re-seeds bookings — sandbox only.\n',
  );
  process.exit(1);
}

const dumpFile = 'supabase/seed-live-catalogue.sql';
if (!existsSync(join(root, dumpFile))) {
  console.error(
    `\n✗ ${dumpFile} not found. Generate it first from PRODUCTION (read-only):\n` +
      '    SUPABASE_DB_URL="<prod :5432 URI>" npx tsx scripts/dump-catalogue.ts\n',
  );
  process.exit(1);
}

const client = new pg.Client(buildClientConfig(dbUrl));

try {
  await client.connect();
  console.log(`\nSandbox target: ${supabaseUrl || dbUrl}`);

  // The dump refuses to run unless this session opts in first (guards a mis-paste
  // into the wrong project). Same connection, so the SET is visible to its guard.
  await client.query("set bmt.allow_catalogue_replace = 'yes'");

  console.log('  · applying live catalogue (replaces catalogue + rebuilds availability)…');
  await client.query(readFileSync(join(root, dumpFile), 'utf8'));
  console.log(`  ✓ ${dumpFile}`);

  console.log('  · re-seeding fake bookings against the real catalogue…');
  await client.query('begin');
  try {
    await client.query(readFileSync(join(root, 'scripts/sandbox/sandbox-bookings.sql'), 'utf8'));
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  console.log('  ✓ scripts/sandbox/sandbox-bookings.sql');

  const { rows } = await client.query<{ what: string; n: string }>(`
    select 'published activities' as what, count(*)::text as n from activities where status='published'
    union all select 'availability slots', count(*)::text from session_occurrences where status='open'
    union all select 'sandbox bookings',   count(*)::text from bookings where notes='sandbox-seed'
    order by what`);
  console.log('\n──────────────────────────────────────────────');
  console.log('✓ Sandbox now mirrors the live catalogue.\n');
  for (const r of rows) console.log(`  ${r.n.padStart(5)}  ${r.what}`);
  console.log('──────────────────────────────────────────────\n');
} catch (e) {
  console.error(`\n✗ ${(e as Error).message ?? e}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
