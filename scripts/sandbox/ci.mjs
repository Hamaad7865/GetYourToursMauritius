#!/usr/bin/env node
// Helpers for .github/workflows/sandbox.yml — the throwaway TEST SITE on Cloudflare Pages.
//
// Everything that decides whether a sandbox deploy is SAFE lives here, as pure functions with unit
// tests (tests/unit/sandbox-ci.test.ts), not inline in workflow YAML. Nearly every default in this
// repo points at PRODUCTION (the repo-level GitHub variables, the root wrangler.toml, the Peach
// account), so the mistakes this file exists to make impossible are:
//   * a sandbox build wired to the production database or a mix of two Supabase projects' keys;
//   * a "sandbox" deploy landing on the production Pages project (or any project not named sandbox);
//   * a sandbox site taking real card payments (LIVE Peach endpoint);
//   * a public duplicate of the live site being indexed, or its traffic reaching the live analytics.
//
// Node builtins only, so it runs with a bare `node` on the GitHub runner BEFORE `npm ci` — a
// misconfigured run fails in seconds, not after a five-minute build.
//
// Usage (each subcommand reads its inputs from the environment; nothing secret is ever printed):
//   node scripts/sandbox/ci.mjs resolve            guard rails, find/create the Pages project, apply its settings
//   node scripts/sandbox/ci.mjs build-env          write the ephemeral .env.production.local
//   node scripts/sandbox/ci.mjs pin-wrangler       point the CI workspace's wrangler.toml at the sandbox
//   node scripts/sandbox/ci.mjs health             post-deploy health check
//   node scripts/sandbox/ci.mjs maintenance        best-effort housekeeping (tops up availability)
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs, retry } from '../release/lib.mjs';

/* ── what the sandbox must never touch ─────────────────────────────────────────────────────────── */

/** Supabase project refs that are PRODUCTION. Extended at runtime by PRODUCTION_SUPABASE_REF. */
export const PRODUCTION_SUPABASE_REFS = ['dwjkfowhrrvdiqligxcj'];
/** Cloudflare Pages projects that are PRODUCTION (root wrangler.toml names the first). */
export const PRODUCTION_PAGES_PROJECTS = ['bellemaretours', 'getyourtoursmauritius'];
export const PRODUCTION_HOSTS = [
  'bellemaretours.com',
  'www.bellemaretours.com',
  'getyourtoursmauritius.com',
  'www.getyourtoursmauritius.com',
];

export const DEFAULT_PROJECT = 'belle-mare-sandbox';
/** Must match wrangler.toml — a unit test compares them so they cannot drift. */
export const COMPATIBILITY_DATE = '2025-02-01';
export const COMPATIBILITY_FLAGS = ['nodejs_compat'];

/* ── the sandbox's settings, in ONE table (used by the workflow, this file and the uploader) ───── */

/**
 * gh       the GitHub secret/variable name — always SANDBOX_*, so nothing here can ever fall back to a
 *          production value stored under the un-prefixed name;
 * kind     how the uploader stores it on GitHub ('secret' is masked in logs, 'variable' is not);
 * local    the matching name in a developer's .env.local (what the uploader reads);
 * runtime  the name it takes on the Cloudflare Pages project (null = CI-only, never sent there);
 * type     Cloudflare env-var type on the Pages project.
 */
export const SANDBOX_SETTINGS = [
  {
    gh: 'SANDBOX_SUPABASE_URL',
    kind: 'variable',
    local: 'NEXT_PUBLIC_SUPABASE_URL',
    runtime: 'NEXT_PUBLIC_SUPABASE_URL',
    type: 'plain_text',
    required: true,
  },
  {
    gh: 'SANDBOX_SUPABASE_ANON_KEY',
    kind: 'secret',
    local: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    runtime: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    type: 'plain_text',
    required: true,
  },
  {
    gh: 'SANDBOX_SUPABASE_SERVICE_ROLE_KEY',
    kind: 'secret',
    local: 'SUPABASE_SERVICE_ROLE_KEY',
    runtime: 'SUPABASE_SERVICE_ROLE_KEY',
    type: 'secret_text',
    required: true,
  },
  {
    gh: 'SANDBOX_SUPABASE_JWT_SECRET',
    kind: 'secret',
    local: 'SUPABASE_JWT_SECRET',
    runtime: 'SUPABASE_JWT_SECRET',
    type: 'secret_text',
    required: true,
  },
  {
    gh: 'SANDBOX_INTERNAL_TASK_SECRET',
    kind: 'secret',
    local: 'INTERNAL_TASK_SECRET',
    runtime: 'INTERNAL_TASK_SECRET',
    type: 'secret_text',
    required: true,
  },
  {
    gh: 'SANDBOX_DB_URL',
    kind: 'secret',
    local: 'SUPABASE_DB_URL',
    runtime: null,
    type: null,
    required: true,
  },
  // Peach TEST credentials — all-or-nothing. Without them the hosted site cannot take a payment
  // (a production-like runtime refuses the payment stub), but everything up to checkout still works.
  {
    gh: 'SANDBOX_PEACH_CLIENT_ID',
    kind: 'secret',
    local: 'PEACH_CLIENT_ID',
    runtime: 'PEACH_CLIENT_ID',
    type: 'secret_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_CLIENT_SECRET',
    kind: 'secret',
    local: 'PEACH_CLIENT_SECRET',
    runtime: 'PEACH_CLIENT_SECRET',
    type: 'secret_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_MERCHANT_ID',
    kind: 'secret',
    local: 'PEACH_MERCHANT_ID',
    runtime: 'PEACH_MERCHANT_ID',
    type: 'secret_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_ENTITY_ID',
    kind: 'secret',
    local: 'PEACH_ENTITY_ID',
    runtime: 'PEACH_ENTITY_ID',
    type: 'plain_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_WEBHOOK_SECRET',
    kind: 'secret',
    local: 'PEACH_WEBHOOK_SECRET',
    runtime: 'PEACH_WEBHOOK_SECRET',
    type: 'secret_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_AUTH_BASE_URL',
    kind: 'variable',
    local: 'PEACH_AUTH_BASE_URL',
    runtime: 'PEACH_AUTH_BASE_URL',
    type: 'plain_text',
    group: 'peach',
  },
  {
    gh: 'SANDBOX_PEACH_CHECKOUT_BASE_URL',
    kind: 'variable',
    local: 'PEACH_CHECKOUT_BASE_URL',
    runtime: 'PEACH_CHECKOUT_BASE_URL',
    type: 'plain_text',
    group: 'peach',
  },
];

/** Peach members the app cannot create a checkout without (see peachConfigFromEnv). */
const PEACH_REQUIRED = [
  'SANDBOX_PEACH_CLIENT_ID',
  'SANDBOX_PEACH_CLIENT_SECRET',
  'SANDBOX_PEACH_MERCHANT_ID',
  'SANDBOX_PEACH_ENTITY_ID',
  'SANDBOX_PEACH_CHECKOUT_BASE_URL',
];

/** Runtime names this tool owns on the Pages project. Anything else on the project is left alone. */
export const DERIVED_RUNTIME_NAMES = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SITE_NOINDEX',
  'PEACH_ENVIRONMENT',
  'PEACH_WEBHOOK_URL',
];
export const MANAGED_RUNTIME_NAMES = /** @type {string[]} */ ([
  ...SANDBOX_SETTINGS.map((s) => s.runtime).filter(Boolean),
  ...DERIVED_RUNTIME_NAMES,
]);

/* ── pure helpers ──────────────────────────────────────────────────────────────────────────────── */

/** The claims of a JWT-shaped Supabase key, or null. Never verifies a signature — it only reads. */
export function decodeJwtClaims(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** `https://<ref>.supabase.co` → `<ref>` (a Supabase ref is 20 lowercase alphanumerics), else null. */
export function supabaseRefFromUrl(url) {
  try {
    const m = new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function checkSupabaseKey({ name, value, ref, role, errors, warnings }) {
  const claims = decodeJwtClaims(value);
  if (claims) {
    if (claims.ref && claims.ref !== ref) {
      errors.push(
        `${name} belongs to Supabase project "${claims.ref}", not "${ref}" — keys from two different projects were mixed.`,
      );
    }
    if (claims.role && claims.role !== role) {
      errors.push(
        `${name} has role "${claims.role}" but must be a "${role}" key (are they swapped?).`,
      );
    }
    return;
  }
  if (value.startsWith('sb_')) {
    const wanted = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    if (!value.startsWith(wanted)) {
      errors.push(
        `${name} must be a ${role === 'anon' ? 'publishable' : 'secret'} key (${wanted}…).`,
      );
    }
    warnings.push(
      `${name} is a new-style Supabase key, so its project cannot be verified from the key.`,
    );
    return;
  }
  warnings.push(
    `${name} is not a recognisable Supabase key format, so its project cannot be verified.`,
  );
}

/**
 * Errors for a candidate Pages project name. Shared by the full check and by the steps that only
 * receive the project name, so the rule cannot drift between them.
 */
export function checkProjectName(project, extraProductionProjects = []) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$/.test(project)) {
    errors.push(
      `SANDBOX_PAGES_PROJECT "${project}" is not a valid Pages project name (lowercase letters, digits, hyphens).`,
    );
  }
  // A positive requirement, not just "not production": the token can deploy to EVERY project in the
  // Cloudflare account, so a typo must not be able to overwrite some other site.
  if (!project.includes('sandbox')) {
    errors.push(
      `SANDBOX_PAGES_PROJECT "${project}" must contain the word "sandbox" (guards against deploying over another site).`,
    );
  }
  const productionProjects = [...PRODUCTION_PAGES_PROJECTS, ...extraProductionProjects]
    .filter(Boolean)
    .map((p) => String(p).trim().toLowerCase());
  if (productionProjects.includes(project.toLowerCase())) {
    errors.push(`SANDBOX_PAGES_PROJECT "${project}" is the PRODUCTION Pages project. Refusing.`);
  }
  return errors;
}

/**
 * Errors for the two values the BUILD bakes into the client bundle. The build step is handed only
 * these (least privilege), so it checks them on its own instead of trusting an earlier step.
 */
export function checkBuildInputs({ supabaseUrl, anonKey, productionRef = '' }) {
  const errors = [];
  const warnings = [];
  const ref = supabaseRefFromUrl(supabaseUrl ?? '');
  if (!ref) {
    errors.push('SANDBOX_SUPABASE_URL must look like https://<project-ref>.supabase.co.');
    return { errors, warnings, ref: null };
  }
  if ([...PRODUCTION_SUPABASE_REFS, productionRef].filter(Boolean).includes(ref)) {
    errors.push(
      `SANDBOX_SUPABASE_URL points at the PRODUCTION Supabase project (${ref}). Refusing.`,
    );
  }
  if (!anonKey) errors.push('SANDBOX_SUPABASE_ANON_KEY is missing.');
  else
    checkSupabaseKey({
      name: 'SANDBOX_SUPABASE_ANON_KEY',
      value: anonKey,
      ref,
      role: 'anon',
      errors,
      warnings,
    });
  return { errors, warnings, ref };
}

/**
 * The guard rails. Pure: takes an env-like object, returns what is wrong (`errors`, the run must
 * stop) and what is merely worth knowing (`warnings`). Nothing here prints a value.
 *
 * `requireCloudflare` is false for the owner-run uploader, which only checks the Supabase/Peach
 * values before they leave the machine.
 */
export function checkSandboxConfig(env, { requireCloudflare = true } = {}) {
  const errors = [];
  const warnings = [];
  const get = (name) => String(env[name] ?? '').trim();
  const values = {};
  for (const s of SANDBOX_SETTINGS) {
    const v = get(s.gh);
    if (!v) continue;
    if (/[\r\n]/.test(v)) errors.push(`${s.gh} contains a line break.`);
    else values[s.gh] = v;
  }

  // ── Cloudflare ─────────────────────────────────────────────────────────────────────────────────
  if (requireCloudflare) {
    if (!get('CLOUDFLARE_API_TOKEN'))
      errors.push('CLOUDFLARE_API_TOKEN is not available to this workflow.');
    if (!get('CLOUDFLARE_ACCOUNT_ID'))
      errors.push('CLOUDFLARE_ACCOUNT_ID is not available to this workflow.');
  }

  // ── the Pages project ──────────────────────────────────────────────────────────────────────────
  const project = get('SANDBOX_PAGES_PROJECT') || DEFAULT_PROJECT;
  errors.push(...checkProjectName(project, [get('PRODUCTION_PAGES_PROJECT')]));

  // ── Supabase: must be a sandbox project, and every key must belong to that same project ────────
  const productionRefs = [...PRODUCTION_SUPABASE_REFS, get('PRODUCTION_SUPABASE_REF')].filter(
    Boolean,
  );
  const supabaseUrl = values.SANDBOX_SUPABASE_URL ?? '';
  const ref = supabaseRefFromUrl(supabaseUrl);
  for (const s of SANDBOX_SETTINGS.filter((x) => x.required)) {
    if (!values[s.gh]) errors.push(`${s.gh} is missing.`);
  }
  if (supabaseUrl && !ref) {
    errors.push('SANDBOX_SUPABASE_URL must look like https://<project-ref>.supabase.co.');
  }
  if (ref) {
    if (productionRefs.includes(ref)) {
      errors.push(
        `SANDBOX_SUPABASE_URL points at the PRODUCTION Supabase project (${ref}). Refusing.`,
      );
    }
    if (values.SANDBOX_SUPABASE_ANON_KEY) {
      checkSupabaseKey({
        name: 'SANDBOX_SUPABASE_ANON_KEY',
        value: values.SANDBOX_SUPABASE_ANON_KEY,
        ref,
        role: 'anon',
        errors,
        warnings,
      });
    }
    if (values.SANDBOX_SUPABASE_SERVICE_ROLE_KEY) {
      checkSupabaseKey({
        name: 'SANDBOX_SUPABASE_SERVICE_ROLE_KEY',
        value: values.SANDBOX_SUPABASE_SERVICE_ROLE_KEY,
        ref,
        role: 'service_role',
        errors,
        warnings,
      });
    }
    const db = values.SANDBOX_DB_URL;
    if (db) {
      for (const prod of productionRefs) {
        if (db.includes(prod))
          errors.push(`SANDBOX_DB_URL points at the PRODUCTION database (${prod}). Refusing.`);
      }
      if (!db.includes(ref)) {
        errors.push('SANDBOX_DB_URL is not the same Supabase project as SANDBOX_SUPABASE_URL.');
      }
      if (/:6543(\/|$|\?)/.test(db)) {
        warnings.push(
          'SANDBOX_DB_URL uses port 6543 (the transaction pooler), which cannot apply the schema file; use the session-pooler string on port 5432.',
        );
      }
      if (/@db\.[a-z0-9]{20}\.supabase\.co/.test(db)) {
        warnings.push(
          'SANDBOX_DB_URL uses the direct host (IPv6-only); GitHub runners are IPv4-only — use the session-pooler string (…pooler.supabase.com:5432).',
        );
      }
    }
  }
  if (values.SANDBOX_INTERNAL_TASK_SECRET && values.SANDBOX_INTERNAL_TASK_SECRET.length < 16) {
    errors.push('SANDBOX_INTERNAL_TASK_SECRET is too short (use at least 16 characters).');
  }

  // ── Peach: TEST endpoints only, all-or-nothing ─────────────────────────────────────────────────
  const peachGiven = SANDBOX_SETTINGS.filter((s) => s.group === 'peach' && values[s.gh]);
  const peachEnvironment = get('SANDBOX_PEACH_ENVIRONMENT');
  if (peachEnvironment && peachEnvironment !== 'test') {
    errors.push(
      `Peach environment is "${peachEnvironment}" — the sandbox may only use "test". Refusing.`,
    );
  }
  let peachConfigured = false;
  if (peachGiven.length === 0) {
    warnings.push(
      'No Peach TEST keys configured: the sandbox cannot take a payment (checkout fails closed). Everything before checkout still works.',
    );
  } else {
    const missing = PEACH_REQUIRED.filter((n) => !values[n]);
    if (missing.length) errors.push(`Peach is partly configured; missing: ${missing.join(', ')}.`);
    else peachConfigured = true;
    if (!values.SANDBOX_PEACH_WEBHOOK_SECRET) {
      warnings.push(
        'SANDBOX_PEACH_WEBHOOK_SECRET is not set: settlement will rely on the status re-query instead of webhooks.',
      );
    }
    for (const n of ['SANDBOX_PEACH_CHECKOUT_BASE_URL', 'SANDBOX_PEACH_AUTH_BASE_URL']) {
      if (values[n] && !/test|sandbox/i.test(values[n])) {
        errors.push(
          `${n} does not look like a Peach TEST/sandbox endpoint — it may be LIVE. Refusing.`,
        );
      }
    }
  }

  // ── optional custom site URL ───────────────────────────────────────────────────────────────────
  const siteUrlOverride = get('SANDBOX_SITE_URL');
  if (siteUrlOverride) {
    let host = '';
    try {
      const u = new URL(siteUrlOverride);
      host = u.hostname.toLowerCase();
      if (u.protocol !== 'https:') errors.push('SANDBOX_SITE_URL must be https.');
    } catch {
      errors.push('SANDBOX_SITE_URL is not a valid URL.');
    }
    const productionHosts = [
      ...PRODUCTION_HOSTS,
      get('CANONICAL_HOST').toLowerCase(),
      (() => {
        try {
          return new URL(get('PRODUCTION_URL')).hostname.toLowerCase();
        } catch {
          return '';
        }
      })(),
    ].filter(Boolean);
    if (host && (productionHosts.includes(host) || host === 'localhost')) {
      errors.push(
        `SANDBOX_SITE_URL host "${host}" is the production (or a local) address. Refusing.`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    config: {
      project,
      supabaseRef: ref,
      peachConfigured,
      siteUrlOverride: siteUrlOverride || null,
      values,
    },
  };
}

/** The ephemeral `.env.production.local` the build reads (Next inlines NEXT_PUBLIC_* from it). */
export function renderBuildEnv({ supabaseUrl, anonKey, siteUrl }) {
  for (const [k, v] of Object.entries({ supabaseUrl, anonKey, siteUrl })) {
    if (!v) throw new Error(`renderBuildEnv: ${k} is required`);
    if (/[\r\n]/.test(v)) throw new Error(`renderBuildEnv: ${k} contains a line break`);
  }
  return [
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `NEXT_PUBLIC_SITE_URL=${siteUrl}`,
    // Never index the sandbox (robots.txt + meta robots) …
    'NEXT_PUBLIC_SITE_NOINDEX=true',
    // … and keep its traffic out of the live Google Analytics: GoogleTagManager renders nothing
    // when the id is empty. (Empty, not unset — unset falls back to the production container.)
    'NEXT_PUBLIC_GTM_ID=',
    '',
  ].join('\n');
}

/**
 * The PATCH body for the Pages project: compatibility settings plus every runtime value this tool
 * owns. A value that is not provided is sent as `null`, which DELETES it — so removing a secret from
 * GitHub really removes it from the site on the next deploy. Names this tool does not own are never
 * mentioned, so anything the owner set by hand in the dashboard survives.
 */
export function buildPagesConfigPatch({
  values,
  siteUrl,
  peachConfigured,
  existingNames = /** @type {string[]} */ ([]),
}) {
  // `null` deletes — so send it ONLY for names that are really on the project. A brand-new project
  // has none, and asking the API to delete something that is not there is a needless way to fail.
  const existing = new Set(existingNames);
  /** @type {Record<string, { type: string, value: string } | null>} */
  const env = Object.fromEntries(
    MANAGED_RUNTIME_NAMES.filter((n) => existing.has(n)).map((n) => [n, null]),
  );
  for (const s of SANDBOX_SETTINGS) {
    if (s.runtime && values[s.gh]) env[s.runtime] = { type: s.type, value: values[s.gh] };
  }
  env.NEXT_PUBLIC_SITE_URL = { type: 'plain_text', value: siteUrl };
  env.NEXT_PUBLIC_SITE_NOINDEX = { type: 'plain_text', value: 'true' };
  if (peachConfigured) {
    env.PEACH_ENVIRONMENT = { type: 'plain_text', value: 'test' };
    env.PEACH_WEBHOOK_URL = {
      type: 'plain_text',
      value: `${siteUrl.replace(/\/+$/, '')}/api/v1/webhooks/payments`,
    };
  }
  return {
    deployment_configs: {
      production: {
        env_vars: env,
        compatibility_date: COMPATIBILITY_DATE,
        compatibility_flags: COMPATIBILITY_FLAGS,
      },
    },
  };
}

/** Rewrites the top-level `name = "…"` of a wrangler.toml, insisting it finds exactly one. */
export function pinWranglerProjectName(toml, project) {
  const re = /^name\s*=\s*"[^"]*"\s*$/m;
  if (!re.test(toml)) throw new Error('wrangler.toml has no top-level name = "…" line to pin');
  return toml.replace(re, `name = "${project}"`);
}

/** Reads a health response (200 body, or the details of a 503) into what must stop the run and what is only news. */
export function evaluateHealth(body, expectedSha) {
  const fatal = [];
  const warnings = [];
  const data = body?.data ?? body?.error?.details ?? null;
  if (!data || typeof data !== 'object') {
    return { fatal: ['the health endpoint did not return a health report'], warnings };
  }
  const checks = data.checks ?? {};
  if (data.live === true) fatal.push('the sandbox is running in LIVE payment mode');
  for (const key of [
    'supabaseConfigured',
    'serviceRoleConfigured',
    'siteUrlConfigured',
    'database',
  ]) {
    if (checks[key] === false) fatal.push(`health check "${key}" failed`);
  }
  if (checks.paymentsSafe === false) {
    warnings.push(
      'payments are unavailable (Peach TEST keys missing or incomplete) — checkout will fail closed',
    );
  }
  if (checks.internalTasksConfigured === false)
    warnings.push('INTERNAL_TASK_SECRET is not configured');
  if (expectedSha && data.releaseSha && data.releaseSha !== expectedSha) {
    warnings.push(
      `releaseSha is ${data.releaseSha}, expected ${expectedSha} (an older deployment may still be cached)`,
    );
  }
  return { fatal, warnings };
}

/**
 * What the DEPLOYED site must look like from outside, whatever the build claimed: not indexable, no
 * analytics, and actually serving pages. Checked against the real responses so a build where the
 * switches did not take (a `NEXT_PUBLIC_*` that never got inlined) fails the run instead of quietly
 * publishing a crawlable copy of the live site that reports into the live Google Analytics.
 */
export function evaluateSandboxSurface({ robotsText, homeHtml, homeStatus }) {
  const fatal = [];
  const robots = String(robotsText ?? '');
  const html = String(homeHtml ?? '');
  if (homeStatus !== 200) fatal.push(`the home page returned HTTP ${homeStatus}, not 200`);
  if (!/^\s*Disallow:\s*\/\s*$/m.test(robots)) {
    fatal.push('robots.txt does not disallow everything — the sandbox could be indexed');
  }
  if (/^\s*Sitemap:/im.test(robots)) fatal.push('robots.txt advertises a sitemap');
  // Any <meta> tag that is the robots tag AND says noindex — whatever order Next writes its attributes in.
  const hasNoindexMeta = (html.match(/<meta\b[^>]*>/gi) ?? []).some(
    (tag) => /name="robots"/i.test(tag) && /noindex/i.test(tag),
  );
  if (homeStatus === 200 && !hasNoindexMeta) {
    fatal.push('the home page has no noindex robots meta tag');
  }
  if (/googletagmanager\.com/i.test(html)) {
    fatal.push(
      'the home page loads Google Tag Manager — test traffic would reach the live analytics',
    );
  }
  return fatal;
}

/* ── Cloudflare Pages API ──────────────────────────────────────────────────────────────────────── */

const API_BASE = 'https://api.cloudflare.com/client/v4';

function redact(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out;
}

async function cf(
  { fetchImpl = fetch, token, secrets = /** @type {string[]} */ ([]) },
  method,
  path,
  body,
) {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Cloudflare returned a non-JSON response (${res.status}) for ${method} ${path}: ${redact(text.slice(0, 200), secrets)}`,
    );
  }
  return { status: res.status, ok: res.ok && parsed.success !== false, body: parsed };
}

function apiErrors(body) {
  return (body?.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || 'unknown error';
}

const normaliseHost = (s) =>
  String(s ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

/**
 * Finds the sandbox Pages project, creating it (direct-upload, no Git link) when it does not exist.
 * Returns its stable address. Refuses a project that IS linked to Git: Cloudflare's own auto-deploy
 * would then race this workflow's, which is the failure the production pipeline also guards against.
 */
export async function ensureProject({
  fetchImpl,
  token,
  accountId,
  project,
  secrets = /** @type {string[]} */ ([]),
  retryDelayMs = 2000,
}) {
  const client = { fetchImpl, token, secrets };
  const base = `/accounts/${accountId}/pages/projects`;
  const existing = await retry(() => cf(client, 'GET', `${base}/${project}`), {
    attempts: 3,
    delayMs: retryDelayMs,
  });
  if (existing.ok) {
    const r = existing.body.result ?? {};
    if (r.source) {
      throw new Error(
        `Pages project "${project}" is connected to Git. The sandbox must be a direct-upload project (delete it in the dashboard and let this workflow recreate it).`,
      );
    }
    return {
      created: false,
      subdomain: normaliseHost(r.subdomain),
      branch: r.production_branch || 'main',
      envNames: Object.keys(r.deployment_configs?.production?.env_vars ?? {}),
    };
  }
  if (existing.status !== 404) {
    throw new Error(
      `Cloudflare API error reading Pages project "${project}": ${existing.status} ${apiErrors(existing.body)}`,
    );
  }
  const created = await cf(client, 'POST', base, { name: project, production_branch: 'main' });
  if (!created.ok) {
    throw new Error(
      `Cloudflare API error creating Pages project "${project}": ${created.status} ${apiErrors(created.body)}`,
    );
  }
  const r = created.body.result ?? {};
  return {
    created: true,
    subdomain: normaliseHost(r.subdomain),
    branch: r.production_branch || 'main',
    envNames: [],
  };
}

/** PATCHes the project, then reads it back and confirms every value we meant to set is really there. */
export async function syncProjectConfig({
  fetchImpl,
  token,
  accountId,
  project,
  patch,
  secrets = /** @type {string[]} */ ([]),
}) {
  const client = { fetchImpl, token, secrets };
  const path = `/accounts/${accountId}/pages/projects/${project}`;
  const updated = await cf(client, 'PATCH', path, patch);
  if (!updated.ok) {
    throw new Error(
      `Cloudflare API error updating Pages project "${project}": ${updated.status} ${apiErrors(updated.body)}`,
    );
  }
  const back = await cf(client, 'GET', path);
  if (!back.ok)
    throw new Error(`Could not read back Pages project "${project}": ${apiErrors(back.body)}`);
  const live = back.body.result?.deployment_configs?.production?.env_vars ?? {};
  const wanted = patch.deployment_configs.production.env_vars;
  const missing = [];
  const stale = [];
  for (const [name, spec] of Object.entries(wanted)) {
    if (spec === null && live[name] != null) stale.push(name);
    if (spec !== null && live[name] == null) missing.push(name);
  }
  if (missing.length || stale.length) {
    throw new Error(
      `Pages project "${project}" did not take the settings (missing: ${missing.join(', ') || 'none'}; still present: ${stale.join(', ') || 'none'}).`,
    );
  }
  return {
    set: Object.entries(wanted)
      .filter(([, v]) => v !== null)
      .map(([k]) => k),
    removed: Object.entries(wanted)
      .filter(([, v]) => v === null)
      .map(([k]) => k),
  };
}

/* ── CLI ───────────────────────────────────────────────────────────────────────────────────────── */

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function secretValues(check) {
  return [...Object.values(check.config.values), process.env.CLOUDFLARE_API_TOKEN ?? ''];
}

function runPreflight() {
  const check = checkSandboxConfig(process.env);
  for (const w of check.warnings) console.log(`::warning::${w}`);
  if (!check.ok) {
    for (const e of check.errors) console.log(`::error::${e}`);
    console.error(
      '\n✗ The sandbox is not configured safely, so nothing was built or deployed.\n' +
        '  Set the missing values with:  npm run sandbox:secrets   (see docs/handbook/sandbox.md)\n',
    );
    process.exit(1);
  }
  return check;
}

async function cmdResolve() {
  const check = runPreflight();
  const { project, siteUrlOverride } = check.config;
  const found = await ensureProject({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    project,
    secrets: secretValues(check),
  });
  if (!found.subdomain)
    throw new Error(`Cloudflare did not report a *.pages.dev address for "${project}".`);
  const siteUrl = siteUrlOverride ?? `https://${found.subdomain}`;
  console.log(
    `✓ Guard rails passed. Sandbox project "${project}" ${found.created ? 'created' : 'found'}.`,
  );
  console.log(
    `  Site: ${siteUrl}   Supabase project: ${check.config.supabaseRef}   Peach test keys: ${check.config.peachConfigured ? 'yes' : 'no'}`,
  );
  // Apply the runtime settings NOW, before the (slow) build. They only take effect for the NEXT
  // deployment, so the site that is live in the meantime is untouched — and this way the one step
  // that holds every secret is also the only step that needs them.
  const patch = buildPagesConfigPatch({
    values: check.config.values,
    siteUrl,
    peachConfigured: check.config.peachConfigured,
    existingNames: found.envNames,
  });
  const done = await syncProjectConfig({
    token: process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    project,
    patch,
    secrets: secretValues(check),
  });
  console.log(
    `✓ Pages project settings applied (${done.set.length} set, ${done.removed.length} cleared).`,
  );
  console.log(`  set: ${done.set.join(', ')}`);
  setOutput('project', project);
  setOutput('branch', found.branch);
  setOutput('site_url', siteUrl);
}

function failWith(errors) {
  for (const e of errors) console.log(`::error::${e}`);
  console.error(
    '\n✗ Refusing to continue — see the errors above. Nothing was built or deployed.\n',
  );
  process.exit(1);
}

function cmdBuildEnv() {
  const supabaseUrl = process.env.SANDBOX_SUPABASE_URL ?? '';
  const anonKey = process.env.SANDBOX_SUPABASE_ANON_KEY ?? '';
  const siteUrl = process.env.SANDBOX_RESOLVED_SITE_URL ?? '';
  const check = checkBuildInputs({
    supabaseUrl,
    anonKey,
    productionRef: process.env.PRODUCTION_SUPABASE_REF,
  });
  if (check.errors.length) failWith(check.errors);
  const text = renderBuildEnv({ supabaseUrl, anonKey, siteUrl });
  writeFileSync('.env.production.local', text);
  console.log('wrote .env.production.local with:');
  // Names only — never the values.
  console.log(
    text
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('=')[0])
      .join('\n'),
  );
}

function cmdPinWrangler() {
  const project = process.env.SANDBOX_RESOLVED_PROJECT ?? '';
  const errors = checkProjectName(project, [process.env.PRODUCTION_PAGES_PROJECT]);
  if (errors.length) failWith(errors);
  const path = 'wrangler.toml';
  writeFileSync(path, pinWranglerProjectName(readFileSync(path, 'utf8'), project));
  console.log(`✓ wrangler.toml in this CI workspace now names "${project}" (never committed).`);
}

async function cmdHealth(args) {
  const url = (args.url ?? process.env.SANDBOX_RESOLVED_SITE_URL ?? '').replace(/\/+$/, '');
  const sha = args.sha ?? process.env.GITHUB_SHA ?? '';
  if (!url) throw new Error('health: --url is required');
  // A fresh deployment takes a few seconds to answer on its stable address, so retry — but only
  // until the site answers with a health REPORT (200, or a 503 that carries one).
  const body = await retry(
    async () => {
      const res = await fetch(`${url}/api/v1/health?deep=true`, {
        headers: { 'cache-control': 'no-cache' },
      });
      const json = await res.json().catch(() => null);
      if (!json || (res.status !== 200 && res.status !== 503))
        throw new Error(`HTTP ${res.status}`);
      return json;
    },
    {
      attempts: 12,
      delayMs: 5000,
      onAttempt: (i, err) => console.log(`  waiting for the site (attempt ${i}: ${err.message})`),
    },
  );
  const { fatal, warnings } = evaluateHealth(body, sha);
  for (const w of warnings) console.log(`::warning::${w}`);
  if (fatal.length) {
    for (const f of fatal) console.log(`::error::${f}`);
    process.exit(1);
  }
  console.log(
    `✓ ${url} is up (${body?.data?.status ?? body?.error?.details?.status ?? 'unknown'}).`,
  );

  // The public surface: not indexable, no analytics, serving pages.
  const robotsRes = await fetch(`${url}/robots.txt`, { headers: { 'cache-control': 'no-cache' } });
  const homeRes = await fetch(`${url}/`, { headers: { 'cache-control': 'no-cache' } });
  const surface = evaluateSandboxSurface({
    robotsText: await robotsRes.text(),
    homeHtml: await homeRes.text(),
    homeStatus: homeRes.status,
  });
  if (surface.length) {
    for (const f of surface) console.log(`::error::${f}`);
    process.exit(1);
  }
  console.log('✓ Public surface: not indexable, no analytics, home page serving.');
}

async function cmdMaintenance(args) {
  const url = (args.url ?? process.env.SANDBOX_RESOLVED_SITE_URL ?? '').replace(/\/+$/, '');
  const secret = process.env.SANDBOX_INTERNAL_TASK_SECRET;
  if (!url || !secret) {
    console.log('::warning::maintenance skipped (no site URL or task secret).');
    return;
  }
  // Best effort: the production cron does this every 5 minutes; the sandbox has no cron, so one call
  // per deploy tops up bookable dates and expires stale holds. Never fails the deploy.
  try {
    const res = await fetch(`${url}/api/v1/internal/maintenance`, {
      method: 'POST',
      headers: { 'x-internal-secret': secret },
    });
    console.log(`  maintenance responded HTTP ${res.status}`);
    if (!res.ok)
      console.log(
        `::warning::maintenance returned HTTP ${res.status} — bookable dates were not topped up.`,
      );
  } catch (err) {
    console.log(`::warning::maintenance call failed: ${err.message}`);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (command) {
    case 'resolve':
      return cmdResolve();
    case 'build-env':
      return cmdBuildEnv();
    case 'pin-wrangler':
      return cmdPinWrangler();
    case 'health':
      return cmdHealth(args);
    case 'maintenance':
      return cmdMaintenance(args);
    default:
      throw new Error(
        `unknown command "${command ?? ''}" (resolve | build-env | pin-wrangler | health | maintenance)`,
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ sandbox ci failed: ${err.message}`);
    process.exit(1);
  });
}
