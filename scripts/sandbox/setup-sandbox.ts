/**
 * One-command sandbox provisioner.
 *
 *   npm run sandbox:setup
 *
 * Points a FRESH, throwaway Supabase project at a fully-seeded copy of the app so
 * you can click through the real storefront, checkout and /admin against realistic
 * data — with ZERO risk to production (payments + email are stubbed in `next dev`).
 *
 * What it does, in order (every step is idempotent — safe to re-run):
 *   1. schema      → supabase/setup.sql            (only if the DB is empty)
 *   2. transfers   → supabase/catch-up.sql         (self-seeds airport/hotel transfers + rentals + fares)
 *   3. catalogue   → supabase/seed-catalogue.sql   (32 activities; operator UUID patched to this DB)
 *   4. regions     → supabase/seed-activity-regions.sql
 *   5. publish+avail→ scripts/sandbox/sandbox-seed.sql
 *   6. test users  → customer@sandbox.test + admin@sandbox.test (via the Auth Admin API)
 *   7. fake bookings→ scripts/sandbox/sandbox-bookings.sql
 *
 * Prerequisites — put these in .env.local (see docs/handbook/sandbox.md):
 *   NEXT_PUBLIC_SUPABASE_URL        https://<new-ref>.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   <fresh anon key>
 *   SUPABASE_SERVICE_ROLE_KEY       <fresh service-role key>
 *   SUPABASE_DB_URL                 postgresql://postgres:<pw>@<host>:5432/postgres   (port 5432, NOT 6543)
 *
 * Safety: this script REFUSES to run if the target looks like the production project.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const root = process.cwd();

// The production project — the one hard line this tool will never cross. A sandbox
// must be a DIFFERENT project; pointing this at prod would seed fake bookings into
// real data. Both the API URL and the DB URL are checked against it.
const PRODUCTION_REFS = ['dwjkfowhrrvdiqligxcj'];

// Test accounts created in the sandbox. Throwaway credentials for a throwaway DB.
const CUSTOMER = { email: 'customer@sandbox.test', password: 'Sandbox123!', name: 'Amelia Rose' };
const ADMIN = { email: 'admin@sandbox.test', password: 'Sandbox123!', name: 'Sandbox Admin' };

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

function requireEnv(key: string): string {
  const v = env[key];
  if (!v) {
    console.error(
      `\n✗ Missing ${key} in .env.local.\n` +
        '  See docs/handbook/sandbox.md for the four values a sandbox needs.\n',
    );
    process.exit(1);
  }
  return v;
}

const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const dbUrl = requireEnv('SUPABASE_DB_URL');
if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn(
    '! NEXT_PUBLIC_SUPABASE_ANON_KEY is not set — seeding will work, but `npm run dev`\n' +
      '  needs it for the browser client. Add it before running the app.',
  );
}

// --- Production guardrail ----------------------------------------------------
const target = `${supabaseUrl} ${dbUrl}`;
const hitRef = PRODUCTION_REFS.find((ref) => target.includes(ref));
if (hitRef) {
  console.error(
    `\n✗ REFUSING TO RUN: the target points at the production project (${hitRef}).\n` +
      '  This tool seeds fake bookings and test users — it must only ever touch a\n' +
      '  separate, throwaway Supabase project. Point .env.local at your sandbox project.\n',
  );
  process.exit(1);
}

const client = new pg.Client(buildClientConfig(dbUrl));

/** Applies a whole SQL file as a single batch, exactly like the Supabase SQL editor
 *  paste (the file manages its own transactions). Used for setup.sql / catch-up.sql. */
async function applyFileRaw(relPath: string, sqlOverride?: string): Promise<void> {
  const sql = sqlOverride ?? readFileSync(join(root, relPath), 'utf8');
  await client.query(sql);
  console.log(`  ✓ ${relPath}`);
}

/** Applies a SQL file atomically inside one transaction. Used for the small,
 *  self-contained seed files. */
async function applyFileTx(relPath: string, sqlOverride?: string): Promise<void> {
  const sql = sqlOverride ?? readFileSync(join(root, relPath), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('commit');
    console.log(`  ✓ ${relPath}`);
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

async function tableExists(qualified: string): Promise<boolean> {
  const { rows } = await client.query<{ reg: string | null }>('select to_regclass($1) as reg', [
    qualified,
  ]);
  return rows[0]?.reg != null;
}

/** Creates (or finds) an auth user and pins its profile role. Returns the user id. */
async function ensureUser(
  admin: SupabaseClient,
  spec: { email: string; password: string; name: string },
  role: 'customer' | 'admin',
): Promise<string> {
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({
    email: spec.email,
    password: spec.password,
    email_confirm: true,
    user_metadata: { full_name: spec.name },
  });
  if (created.error) {
    // Most likely "email already exists" on a re-run — look the user up instead.
    const list = await admin.auth.admin.listUsers({ perPage: 200 });
    userId = list.data?.users.find((u) => u.email === spec.email)?.id;
    if (!userId) throw new Error(`createUser failed for ${spec.email}: ${created.error.message}`);
  } else {
    userId = created.data.user?.id;
  }
  if (!userId) throw new Error(`No user id resolved for ${spec.email}`);

  // No handle_new_user trigger exists — the profiles row must be inserted. Running
  // as the DB owner bypasses the enforce_profile_role trigger, so role sticks.
  await client.query(
    `insert into profiles (id, full_name, role)
       values ($1, $2, $3::user_role)
     on conflict (id) do update set full_name = excluded.full_name, role = excluded.role`,
    [userId, spec.name, role],
  );
  console.log(`  ✓ ${role.padEnd(8)} ${spec.email}`);
  return userId;
}

async function main(): Promise<void> {
  console.log(`\nSandbox target: ${supabaseUrl}`);
  await client.connect();

  // 1) Schema — only if the DB is empty (setup.sql is a fresh-install bundle).
  console.log('\n[1/6] Schema');
  if (await tableExists('public.activities')) {
    console.log('  · activities table already present — skipping setup.sql');
  } else {
    await applyFileRaw('supabase/setup.sql');
  }

  // 2) Transfers, rentals and fares — self-seeded by catch-up.sql (idempotent).
  console.log('\n[2/6] Transfers, rentals & fares (catch-up.sql)');
  await applyFileRaw('supabase/catch-up.sql');

  // 3) Catalogue — 32 draft activities. The seed hard-codes an operator UUID that
  //    won't exist here, so rewrite it to this DB's belle-mare-tours operator id.
  console.log('\n[3/6] Catalogue (32 activities)');
  const { rows: op } = await client.query<{ id: string }>(
    `select id from operators where slug = 'belle-mare-tours' limit 1`,
  );
  const operatorId = op[0]?.id;
  if (!operatorId) throw new Error("operator 'belle-mare-tours' not found — did setup.sql run?");
  const catalogue = readFileSync(join(root, 'supabase/seed-catalogue.sql'), 'utf8').replaceAll(
    'bb34e08d-d570-491e-8ff6-ca9d401b2a82',
    operatorId,
  );
  await applyFileTx('supabase/seed-catalogue.sql', catalogue);

  // 4) Regions (per-person transport add-on home regions).
  console.log('\n[4/6] Activity regions');
  await applyFileTx('supabase/seed-activity-regions.sql');

  // 5) Publish + capacity + availability.
  console.log('\n[5/6] Publish + availability');
  await applyFileTx('scripts/sandbox/sandbox-seed.sql');

  // 6) Test users, then fake bookings (bookings can be owned by the customer).
  console.log('\n[6/6] Test users + fake bookings');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await ensureUser(admin, CUSTOMER, 'customer');
  await ensureUser(admin, ADMIN, 'admin');
  await applyFileTx('scripts/sandbox/sandbox-bookings.sql');

  // Summary.
  const { rows: counts } = await client.query<{ what: string; n: string }>(`
    select 'published activities' as what, count(*)::text as n from activities where status='published'
    union all select 'availability slots', count(*)::text from session_occurrences where status='open'
    union all select 'sandbox bookings',   count(*)::text from bookings where notes='sandbox-seed'
    order by what`);

  console.log('\n──────────────────────────────────────────────');
  console.log('✓ Sandbox ready.\n');
  for (const c of counts) console.log(`  ${c.n.padStart(5)}  ${c.what}`);
  console.log('\n  Logins (sign in from the app):');
  console.log(`    customer  ${CUSTOMER.email}  /  ${CUSTOMER.password}`);
  console.log(`    admin     ${ADMIN.email}  /  ${ADMIN.password}   → /admin`);
  console.log('\n  Next:  npm run dev   →   http://localhost:3000');
  console.log(
    '  Payments & email are stubbed in `next dev` — checkout completes with no Peach/Resend.',
  );
  console.log('──────────────────────────────────────────────\n');
}

try {
  await main();
} catch (e) {
  const err = e as { message?: string; position?: string };
  console.error(`\n✗ ${err.message ?? e}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
