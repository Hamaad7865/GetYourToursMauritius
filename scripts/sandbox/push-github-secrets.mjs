#!/usr/bin/env node
// Copies the SANDBOX settings from your local `.env.local` into this repository's GitHub
// secrets/variables (as SANDBOX_*), so .github/workflows/sandbox.yml can build and deploy the hosted
// test site. YOU run it — the values never pass through anyone else.
//
//   npm run sandbox:secrets              # shows what it will upload, asks before doing it
//   npm run sandbox:secrets -- --dry-run # shows the plan only, changes nothing
//   npm run sandbox:secrets -- --status  # lists which SANDBOX_* settings GitHub already has
//   npm run sandbox:secrets -- --no-peach  # skip the Peach group (no card payments on the sandbox)
//
// Safety, in the order it acts:
//   1. It reads ONLY an allowlist of names (see SANDBOX_SETTINGS) — email, WhatsApp, Google service
//      accounts, Vercel tokens and everything else in .env.local are never read into the plan.
//   2. It runs the same guard rails the workflow runs (scripts/sandbox/ci.mjs) BEFORE uploading:
//      a production Supabase project, keys from two different projects, or a live Peach endpoint
//      stop it right here, on your machine.
//   3. It prints setting NAMES only, never a value, and passes each secret to `gh` over stdin so it
//      never appears in a process list.
// Needs the GitHub CLI (`gh`), logged in with access to this repository.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../release/lib.mjs';
import {
  SANDBOX_SETTINGS,
  checkSandboxConfig,
  jwtSecretMatchesToken,
  supabaseRefFromUrl,
} from './ci.mjs';

/** Parses a dotenv-style file. Later duplicates win, quotes are stripped, comments are ignored. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    out[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Turns a parsed .env.local into the SANDBOX_* environment the guard rails understand, plus the
 * list of settings that would be uploaded. Only allowlisted names are ever read.
 */
export function buildUploadPlan(local, { noPeach = false } = {}) {
  const env = {};
  const plan = [];
  const notInLocal = [];
  /** @type {Array<{ gh: string, local: string, reason: string }>} */
  const skipped = [];
  for (const s of SANDBOX_SETTINGS) {
    if (noPeach && s.group === 'peach') continue;
    const value = String(local[s.local] ?? '').trim();
    if (value) {
      env[s.gh] = value;
      plan.push({ gh: s.gh, kind: s.kind });
    } else if (s.required) {
      notInLocal.push(s.local);
    }
  }
  // The JWT secret has no project name of its own, so prove it is THIS project's before it goes
  // anywhere: it must sign the project's own keys. One that does not — typically PRODUCTION's, left in
  // a file that was copied from the production one — is withheld, loudly, and everything else still
  // uploads. The sandbox does not need it (it verifies tokens through its own public keys).
  const jwtName = 'SANDBOX_SUPABASE_JWT_SECRET';
  if (env[jwtName]) {
    const verdicts = ['SANDBOX_SUPABASE_ANON_KEY', 'SANDBOX_SUPABASE_SERVICE_ROLE_KEY']
      .filter((name) => env[name])
      .map((name) => jwtSecretMatchesToken(env[name], env[jwtName]));
    if (verdicts.includes('mismatch')) {
      delete env[jwtName];
      plan.splice(
        plan.findIndex((p) => p.gh === jwtName),
        1,
      );
      skipped.push({
        gh: jwtName,
        local: 'SUPABASE_JWT_SECRET',
        reason: 'not-this-projects-secret',
      });
    }
  }
  // Checked, never uploaded: the guard rails refuse anything but Peach "test".
  if (!noPeach && local.PEACH_ENVIRONMENT)
    env.SANDBOX_PEACH_ENVIRONMENT = local.PEACH_ENVIRONMENT.trim();
  const check = checkSandboxConfig(env, { requireCloudflare: false });
  return { env, plan, notInLocal, skipped, check };
}

function gh(args, input) {
  const r = spawnSync('gh', args, { input, encoding: 'utf8' });
  if (r.error)
    throw new Error(
      `could not run "gh" (${r.error.message}) — install the GitHub CLI and run "gh auth login"`,
    );
  return r;
}

function detectRepo() {
  const r = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (r.status !== 0) throw new Error(`gh could not identify this repository: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function status(repo) {
  const names = { secret: new Set(), variable: new Set() };
  for (const kind of ['secret', 'variable']) {
    const r = gh([kind, 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name']);
    if (r.status !== 0) throw new Error(`gh ${kind} list failed: ${r.stderr.trim()}`);
    for (const n of r.stdout.split(/\r?\n/).filter(Boolean)) names[kind].add(n);
  }
  console.log(`\nSANDBOX_* settings on ${repo} (names only):\n`);
  for (const s of SANDBOX_SETTINGS) {
    const there = names[s.kind].has(s.gh);
    const label = s.required ? 'required' : 'optional';
    console.log(
      `  ${there ? '✓' : s.required ? '✗' : '·'} ${s.gh.padEnd(38)} ${s.kind.padEnd(8)} ${label}`,
    );
  }
  const missing = SANDBOX_SETTINGS.filter((s) => s.required && !names[s.kind].has(s.gh));
  console.log(
    missing.length
      ? `\n${missing.length} required setting(s) missing — run: npm run sandbox:secrets\n`
      : '\nAll required settings are present.\n',
  );
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo ?? detectRepo();
  if (args.status) return status(repo);

  const file = args.file ?? '.env.local';
  if (!existsSync(file)) throw new Error(`${file} not found — run this from the repository root.`);
  const { plan, notInLocal, skipped, check } = buildUploadPlan(
    parseEnvFile(readFileSync(file, 'utf8')),
    { noPeach: Boolean(args['no-peach']) },
  );

  console.log(`\nSandbox settings found in ${file} (names only — values are never printed):\n`);
  for (const p of plan) console.log(`  ✓ ${p.gh.padEnd(38)} ${p.kind}`);
  for (const n of notInLocal) console.log(`  ✗ ${n} is not in ${file}`);
  for (const k of skipped) {
    console.log(`  ⚠ ${k.gh.padEnd(38)} NOT uploaded — see below`);
  }
  if (check.config.supabaseRef) console.log(`\n  Supabase project: ${check.config.supabaseRef}`);
  console.log(`  Peach test keys: ${check.config.peachConfigured ? 'yes' : 'no'}`);
  console.log(
    `  Mail (all of it diverted to one inbox): ${check.config.emailConfigured ? 'yes' : 'no'}`,
  );
  for (const w of check.warnings) console.log(`  ⚠ ${w}`);
  for (const k of skipped) {
    console.log(
      `\n  ⚠ ${k.local} in ${file} was NOT uploaded: it is not the sandbox project's JWT secret.\n` +
        `    It signs a DIFFERENT project's keys — very likely production's, which is what a copied-over\n` +
        `    file carries. The sandbox verifies tokens with its own public signing keys and does not need\n` +
        `    it, so nothing is lost. You may want to remove that line from ${file} so production's\n` +
        `    signing secret is not sitting in a sandbox file.`,
    );
  }
  if (!check.ok) {
    console.error('\n✗ Nothing was uploaded. Fix these first:\n');
    for (const e of check.errors) console.error(`  - ${e}`);
    console.error(
      `\n  (This file must point at your SANDBOX Supabase project, not production. Production is refused.)\n`,
    );
    process.exit(1);
  }
  if (args['dry-run']) {
    console.log(`\nDry run: would upload ${plan.length} settings to ${repo}. Nothing changed.\n`);
    return;
  }
  if (
    !args.yes &&
    !(await confirm(`\nUpload ${plan.length} settings to ${repo}? Type "yes" to continue: `))
  ) {
    console.log('Cancelled. Nothing was uploaded.');
    return;
  }

  let failed = 0;
  for (const p of plan) {
    const value = check.config.values[p.gh];
    const r =
      p.kind === 'secret'
        ? gh(['secret', 'set', p.gh, '--repo', repo], value)
        : gh(['variable', 'set', p.gh, '--repo', repo, '--body', value]);
    if (r.status === 0) console.log(`  ✓ ${p.kind} ${p.gh}`);
    else {
      failed += 1;
      console.error(`  ✗ ${p.gh}: ${r.stderr.trim()}`);
    }
  }
  if (failed) process.exit(1);
  const ref = supabaseRefFromUrl(check.config.values.SANDBOX_SUPABASE_URL);
  console.log(`\nDone. The sandbox is wired to Supabase project ${ref}.`);
  console.log('Next: deploy with  npm run sandbox:deploy   (see docs/handbook/sandbox.md).\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
