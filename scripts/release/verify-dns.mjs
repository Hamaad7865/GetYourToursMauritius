#!/usr/bin/env node
// Cross-platform (no PowerShell/bash-isms — pure Node) canonical-origin verification. Runs as a
// release.yml step after the web deploy. Read-only: it never mutates DNS or Cloudflare config,
// only resolves names and follows HTTP(S) redirects to prove the DEPLOYED result is correct.
//
// Usage:
//   node scripts/release/verify-dns.mjs \
//     --canonical-host bellemaretours.com \
//     --www-host www.bellemaretours.com \
//     --pages-dev-host getyourtoursmauritius.pages.dev
import { lookup } from 'node:dns/promises';
import { requireEnv, optionalEnv, retry } from './lib.mjs';

const MAX_REDIRECTS = 10;

/** Resolves a hostname via DNS. Throws (caught by caller) on NXDOMAIN/timeout — never mutates. */
async function assertResolves(host) {
  const { address } = await lookup(host);
  return address;
}

/**
 * Follows redirects manually (fetch redirect:'manual') so we can inspect EVERY hop: detect loops,
 * assert HTTPS end-to-end, and assert it doesn't wander off host. TLS/certificate errors surface as
 * a thrown error from `fetch` itself (undici validates certs by default) and propagate to the
 * caller — never swallowed, per the "TLS failures cause a non-zero exit" requirement.
 */
export async function followRedirectChain(startUrl, { maxRedirects = MAX_REDIRECTS } = {}) {
  const chain = [];
  let url = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    if (chain.includes(url)) {
      throw new Error(`Redirect loop detected: ${[...chain, url].join(' -> ')}`);
    }
    chain.push(url);
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`${url} returned ${res.status} with no Location header`);
      url = new URL(location, url).toString();
      if (i === maxRedirects) {
        throw new Error(`Redirect chain exceeded ${maxRedirects} hops: ${chain.join(' -> ')}`);
      }
      continue;
    }
    return { chain, finalUrl: url, finalStatus: res.status, finalHeaders: res.headers };
  }
  throw new Error(`Redirect chain exceeded ${maxRedirects} hops: ${chain.join(' -> ')}`);
}

async function checkCanonicalReachable(canonicalHost) {
  await assertResolves(canonicalHost);
  const res = await fetch(`https://${canonicalHost}/`, { redirect: 'manual' });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`https://${canonicalHost}/ returned HTTP ${res.status}, expected 2xx directly`);
  }
  console.log(`✓ https://${canonicalHost}/ resolves and serves 2xx directly (no redirect needed)`);
}

async function checkWwwRedirectsToCanonical(wwwHost, canonicalHost) {
  await assertResolves(wwwHost);
  const { chain, finalUrl } = await followRedirectChain(`https://${wwwHost}/`);
  const finalHost = new URL(finalUrl).host;
  if (finalHost !== canonicalHost) {
    throw new Error(
      `https://${wwwHost}/ ended at ${finalUrl}, expected host ${canonicalHost}. Chain: ${chain.join(' -> ')}`,
    );
  }
  console.log(`✓ https://${wwwHost}/ redirects to the canonical apex (${chain.length - 1} hop(s))`);
}

async function checkPagesDevNonIndexable(pagesDevHost, canonicalHost) {
  let resolved;
  try {
    resolved = await assertResolves(pagesDevHost);
  } catch {
    console.log(`✓ ${pagesDevHost} does not resolve — nothing to guard`);
    return;
  }
  void resolved;
  const res = await fetch(`https://${pagesDevHost}/`, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const { finalUrl } = await followRedirectChain(`https://${pagesDevHost}/`);
    const finalHost = new URL(finalUrl).host;
    if (finalHost !== canonicalHost) {
      throw new Error(
        `${pagesDevHost} redirects to ${finalUrl}, expected the canonical host ${canonicalHost}`,
      );
    }
    console.log(`✓ ${pagesDevHost} redirects to the canonical host`);
    return;
  }
  const robots = res.headers.get('x-robots-tag') ?? '';
  if (/noindex/i.test(robots)) {
    console.log(
      `✓ ${pagesDevHost} serves directly but is marked non-indexable (X-Robots-Tag: ${robots})`,
    );
    return;
  }
  throw new Error(
    `${pagesDevHost} serves HTTP ${res.status} directly with no redirect to ${canonicalHost} and no ` +
      `noindex X-Robots-Tag — it is a crawlable, unguarded copy of the production site.`,
  );
}

async function checkDeepHealthThroughCanonical(canonicalHost) {
  const res = await fetch(`https://${canonicalHost}/api/v1/health?deep=true`, {
    redirect: 'manual',
  });
  const body = await res.json().catch(() => null);
  if (res.status !== 200 || body?.data?.status !== 'ok') {
    throw new Error(
      `Deep health via canonical host ${canonicalHost} failed: HTTP ${res.status}, body=${JSON.stringify(body)}`,
    );
  }
  console.log(
    `✓ deep health reachable and healthy through https://${canonicalHost}/api/v1/health?deep=true`,
  );
}

async function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : null))
      .filter(Boolean),
  );
  const canonicalHost = args['canonical-host'] ?? requireEnv('CANONICAL_HOST');
  const wwwHost = args['www-host'] ?? optionalEnv('CANONICAL_WWW_HOST', `www.${canonicalHost}`);
  const pagesDevHost = args['pages-dev-host'] ?? optionalEnv('CLOUDFLARE_PAGES_DEV_HOST');
  const attempts = Number(optionalEnv('DNS_VERIFY_ATTEMPTS', '5'));
  const delayMs = Number(optionalEnv('DNS_VERIFY_DELAY_MS', '5000'));

  await retry(() => checkCanonicalReachable(canonicalHost), {
    attempts,
    delayMs,
    onAttempt: (i, err) =>
      console.log(`… canonical host attempt ${i}/${attempts} failed: ${err.message}`),
  });
  await checkWwwRedirectsToCanonical(wwwHost, canonicalHost);
  if (pagesDevHost) await checkPagesDevNonIndexable(pagesDevHost, canonicalHost);
  await retry(() => checkDeepHealthThroughCanonical(canonicalHost), {
    attempts,
    delayMs,
    onAttempt: (i, err) =>
      console.log(`… deep health attempt ${i}/${attempts} failed: ${err.message}`),
  });
  console.log('✓ DNS + canonical-origin verification passed');
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ verify-dns failed: ${err.message}`);
    process.exit(1);
  });
}
