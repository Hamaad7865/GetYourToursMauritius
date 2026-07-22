#!/usr/bin/env node
// Supabase migration-ledger gate, shared by two workflows:
//   - reconcile-supabase-ledger.yml (manual-only): drives the full reconciliation sequence.
//   - release.yml (every push to main, once reconciled): re-verifies parity before `db push`.
//
// Production has never run `supabase db push` — the live schema is applied by hand-pasting
// supabase/catch-up.sql (see docs/handbook/database.md), so supabase_migrations.schema_migrations
// started EMPTY even though the schema was fully up to date. Backfilling that ledger is a one-time,
// human-supervised operation (reconcile-supabase-ledger.yml) — this script never performs it
// silently, and every mode here is read-only except `push` (see below).
//
// Ledger reads go straight to Postgres (SUPABASE_DB_URL — the direct/session-pooler :5432 URI, see
// docs/handbook/database.md) rather than parsing `supabase migration list` table output: the CLI's
// human-readable table format isn't a documented, parseable contract, whereas
// `supabase_migrations.schema_migrations` is Supabase's own well-known ledger table. `supabase db
// push --dry-run` (a real, --help-verified flag) is still used for the final CLI-native
// confirmation, with its output scanned for local migration filenames to detect anything pending —
// filename-based so it doesn't depend on exact wording of the CLI's dry-run message.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { parseArgs, requireEnv, redactSecrets } from './lib.mjs';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
// Pinned — never resolve `supabase@latest` for a command that changes production migration history.
export const SUPABASE_CLI_VERSION = '2.109.1';

export function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const version = f.split('_')[0];
      return { version, name: f.slice(version.length + 1).replace(/\.sql$/, ''), file: f };
    });
}

/**
 * Pure comparison, unit-testable without a database. Fails on ANY of: a local migration missing
 * from the remote ledger (a "gap"), a remote-only version absent locally (drift/tampering), or the
 * two sets not matching exactly version-for-version (non-linear history).
 */
export function computeLedgerParity(local, remoteVersions) {
  const localVersions = local.map((m) => m.version);
  const remoteSet = new Set(remoteVersions);
  const localSet = new Set(localVersions);

  const missingFromRemote = localVersions.filter((v) => !remoteSet.has(v));
  const remoteOnly = remoteVersions.filter((v) => !localSet.has(v));

  const sortedLocal = [...localVersions].sort();
  const sortedRemote = [...remoteVersions].sort();
  const linear = JSON.stringify(sortedLocal) === JSON.stringify(sortedRemote);

  return {
    inSync: missingFromRemote.length === 0 && remoteOnly.length === 0 && linear,
    missingFromRemote,
    remoteOnly,
    linear,
  };
}

/** Scans `supabase db push --dry-run` output for any local migration filename/version (= pending). */
export function assertNoPendingMigrations(dryRunOutput, local) {
  const pending = local.filter(
    (m) => dryRunOutput.includes(m.file) || dryRunOutput.includes(m.version),
  );
  return { clean: pending.length === 0, pending };
}

async function queryRemoteLedgerVersions(dbUrl) {
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(
      'select version from supabase_migrations.schema_migrations order by version',
    );
    return rows.map((r) => r.version);
  } finally {
    await client.end();
  }
}

function runSupabaseCli(args) {
  try {
    // shell:true — see the comment in generate-manifest.mjs (Node's own documented approach for
    // spawning a Windows .cmd binary; `args` here are all fixed literals/trusted CLI flags, never
    // interpolated user input). No-op on Linux, where CI actually runs this.
    return execFileSync('npx', ['--yes', `supabase@${SUPABASE_CLI_VERSION}`, ...args], {
      encoding: 'utf8',
      env: process.env,
      shell: true,
    });
  } catch (err) {
    // execFileSync throws with stdout/stderr attached; surface both (redacted) so the workflow log
    // shows the real CLI error instead of just "exit code 1".
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    throw new Error(redactSecrets(out || err.message));
  }
}

async function modeStatus() {
  const local = localMigrations();
  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const remoteVersions = await queryRemoteLedgerVersions(dbUrl);
  const parity = computeLedgerParity(local, remoteVersions);
  console.log(
    JSON.stringify(
      { localCount: local.length, remoteCount: remoteVersions.length, ...parity },
      null,
      2,
    ),
  );
  if (!parity.inSync) {
    throw new Error(
      `Ledger is NOT in sync: ${parity.missingFromRemote.length} migration(s) missing from remote, ` +
        `${parity.remoteOnly.length} remote-only version(s). Run reconcile-supabase-ledger.yml first.`,
    );
  }
  console.log(
    `✓ ledger in sync: ${local.length} migrations, 1:1 with supabase_migrations.schema_migrations`,
  );
}

async function modeDryRun() {
  const local = localMigrations();
  const projectRef = requireEnv('SUPABASE_PROJECT_ID');
  const dbPassword = requireEnv('SUPABASE_DB_PASSWORD');
  runSupabaseCli(['link', '--project-ref', projectRef, '--password', dbPassword]);
  const output = runSupabaseCli(['db', 'push', '--dry-run', '--linked', '--password', dbPassword]);
  console.log(redactSecrets(output));
  const { clean, pending } = assertNoPendingMigrations(output, local);
  if (!clean) {
    throw new Error(
      `db push --dry-run reports pending historical migration(s): ${pending.map((m) => m.file).join(', ')}. ` +
        `The ledger must be fully reconciled before a normal release may run db push.`,
    );
  }
  console.log('✓ db push --dry-run reports no pending historical migrations');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (mode === 'status') return modeStatus();
  if (mode === 'dry-run') return modeDryRun();
  throw new Error(`Unknown --mode "${mode}" (expected: status | dry-run)`);
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ supabase-ledger failed: ${err.message}`);
    process.exit(1);
  });
}
