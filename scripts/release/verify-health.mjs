#!/usr/bin/env node
// Polls the deployed /api/v1/health?deep=true with bounded retries and asserts the release actually
// landed: HTTP 200, status "ok", database reachable, internal tasks configured, production safety
// checks pass, and — the whole point — the returned releaseSha equals the artifact SHA this
// workflow just deployed. A stale Cloudflare edge cache or a deploy that silently didn't take would
// otherwise report green.
//
// Usage:
//   node scripts/release/verify-health.mjs --url https://bellemaretours.com --expected-sha <sha>
import { requireEnv, optionalEnv, retry, parseArgs } from './lib.mjs';

/** Pure assertion over an already-fetched health body. Unit-testable without a network call. */
export function assertHealthy(body, expectedSha) {
  const errors = [];
  if (body?.data?.status !== 'ok') errors.push(`status is "${body?.data?.status}", expected "ok"`);
  const checks = body?.data?.checks ?? {};
  if (checks.database !== true) errors.push('checks.database is not true');
  if (checks.internalTasksConfigured !== true)
    errors.push('checks.internalTasksConfigured is not true');
  for (const key of [
    'supabaseConfigured',
    'serviceRoleConfigured',
    'paymentsSafe',
    'legacyAuthDisabled',
    'siteUrlConfigured',
  ]) {
    if (checks[key] !== undefined && checks[key] !== true) errors.push(`checks.${key} is not true`);
  }
  if (body?.data?.releaseSha !== expectedSha) {
    errors.push(`releaseSha is "${body?.data?.releaseSha}", expected "${expectedSha}"`);
  }
  return errors;
}

async function fetchHealthOnce(url) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/v1/health?deep=true`, {
    headers: { 'cache-control': 'no-cache' },
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? requireEnv('PRODUCTION_URL');
  const expectedSha = args['expected-sha'] ?? requireEnv('RELEASE_SHA');
  const attempts = Number(args.attempts ?? optionalEnv('HEALTH_VERIFY_ATTEMPTS', '10'));
  const delayMs = Number(args['delay-ms'] ?? optionalEnv('HEALTH_VERIFY_DELAY_MS', '6000'));

  const body = await retry(
    async () => {
      const b = await fetchHealthOnce(url);
      const errors = assertHealthy(b, expectedSha);
      if (errors.length > 0) throw new Error(errors.join('; '));
      return b;
    },
    {
      attempts,
      delayMs,
      onAttempt: (i, err) =>
        console.log(`… health check attempt ${i}/${attempts} failed: ${err.message}`),
    },
  );

  console.log(
    `✓ deep health healthy at ${url}: releaseSha=${body.data.releaseSha} environment=${body.data.environment}`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ verify-health failed after retries: ${err.message}`);
    process.exit(1);
  });
}
