#!/usr/bin/env node
// Polls the cron Worker's liveness endpoint until it reports the release we just deployed.
//
// WHY A POLL, not a single curl: a Workers deploy is eventually consistent — for a few seconds after
// `wrangler deploy` returns, the edge can still serve the PREVIOUS version. The original inline check
// used `curl --retry --retry-all-errors`, which only retries transport/HTTP errors; a 200 carrying a
// stale body is not an error, so it never retried and failed the release on a perfectly good deploy.
// Retry has to wrap the ASSERTION, not just the fetch (same shape as verify-health.mjs).
//
// Usage:
//   node scripts/release/verify-worker-liveness.mjs --url https://gytm-cron.<subdomain>.workers.dev \
//     --expected-sha <sha>
import { requireEnv, optionalEnv, retry, parseArgs } from './lib.mjs';

/** Pure assertion over an already-fetched liveness body. Unit-testable without a network call. */
export function assertWorkerLive(body, expectedSha) {
  const errors = [];
  if (body?.status !== 'alive') errors.push(`status is "${body?.status}", expected "alive"`);
  if (body?.releaseSha !== expectedSha) {
    errors.push(`releaseSha is "${body?.releaseSha}", expected "${expectedSha}"`);
  }
  // Presence only — the value is never read or logged.
  if (body?.internalTaskSecretConfigured !== true) {
    errors.push('internalTaskSecretConfigured is not true');
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = (args.url ?? requireEnv('CRON_WORKER_URL')).replace(/\/+$/, '');
  const expectedSha = args['expected-sha'] ?? requireEnv('RELEASE_SHA');
  const attempts = Number(args.attempts ?? optionalEnv('WORKER_VERIFY_ATTEMPTS', '10'));
  const delayMs = Number(args['delay-ms'] ?? optionalEnv('WORKER_VERIFY_DELAY_MS', '5000'));

  const body = await retry(
    async () => {
      const res = await fetch(`${url}/`, { headers: { 'cache-control': 'no-cache' } });
      const json = await res.json().catch(() => null);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
      const errors = assertWorkerLive(json, expectedSha);
      if (errors.length > 0) throw new Error(errors.join('; '));
      return json;
    },
    {
      attempts,
      delayMs,
      onAttempt: (i, err) =>
        console.log(`… worker liveness attempt ${i}/${attempts} not ready yet: ${err.message}`),
    },
  );

  console.log(
    `✓ gytm-cron liveness confirms release ${body.releaseSha} (run ${body.releaseRunId}, siteUrl ${body.siteUrl})`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ verify-worker-liveness failed after retries: ${err.message}`);
    process.exit(1);
  });
}
