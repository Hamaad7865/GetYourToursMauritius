// Shared helpers for the release pipeline scripts (scripts/release/*.mjs). Kept dependency-free
// (Node builtins only) so every script here runs with a bare `node`, no install step, on the
// GitHub Actions ubuntu-latest runner.

/** Names that must never appear in logged output. Extend this list as new secrets are threaded in. */
const SECRET_ENV_NAMES = [
  'CLOUDFLARE_API_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_JWT_SECRET',
  'INTERNAL_TASK_SECRET',
  'PEACH_CLIENT_SECRET',
  'PEACH_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'SEND_EMAIL_HOOK_SECRET',
];

/**
 * Replaces every known-secret env value found verbatim inside `text` with a placeholder. Defence in
 * depth for scripts that print upstream API/CLI output they don't fully control (Cloudflare/Supabase
 * error bodies can echo back request fields). Never a substitute for simply not printing a secret.
 */
export function redactSecrets(text, env = process.env) {
  let out = text;
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (value && value.length >= 4) {
      out = out.split(value).join(`[REDACTED:${name}]`);
    }
  }
  return out;
}

/** Reads a required env var or throws a clear, non-secret-leaking error. */
export function requireEnv(name, env = process.env) {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Reads an optional env var, returning `fallback` (default undefined) when unset/empty. */
export function optionalEnv(name, fallback, env = process.env) {
  const value = env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Retries an async operation with linear backoff. Used for bounded-retry network checks (health,
 * DNS) — never for anything that mutates state, since a retried mutation could double-apply.
 */
export async function retry(fn, { attempts = 5, delayMs = 3000, onAttempt } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      onAttempt?.(i, err);
      if (i < attempts) await sleep(delayMs);
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses simple `--flag value` / `--flag=value` / `--boolean-flag` CLI args into an object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** True when a full git SHA (40 hex chars) or a short-but-plausible one (>=7 hex chars) is given. */
export function isPlausibleGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value);
}

export function fail(message) {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

export function ok(message) {
  console.log(`✓ ${message}`);
}
