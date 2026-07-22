#!/usr/bin/env node
// The MAXIMUM safe, fully automated slice of the money path: real availability -> real hold -> real
// booking -> a real Peach CHECKOUT CREATION, against a dedicated sandbox/staging deployment. It
// stops there — see the header comment further down for exactly why, and what `payment-smoke`
// (webhook/reconciliation -> confirmed booking -> invoice) requires instead.
//
// Safety, non-negotiable:
//   - Refuses to run unless the target's OWN /api/v1/health reports paymentMode "test" and live
//     false. If the target is pointed at live Peach or looks like production, it aborts before
//     creating anything.
//   - PAYMENT_SMOKE_BASE_URL must be set and must NOT equal PRODUCTION_URL/CANONICAL_HOST — a second
//     fail-closed guard against accidentally running this against production.
//   - Every record it creates is tagged unmistakably synthetic (email local-part `smoke+<runId>-
//     <random>`, idempotency key prefixed `release-smoke-`) so it can be found and purged by a
//     human/cron sweep later — this script does not delete data itself (see "cleanup" below).
//   - Never enters a card number. Never completes the charge.
//
// Usage:
//   node scripts/release/peach-payment-probe.mjs --base-url https://staging.example.com
import { requireEnv, optionalEnv, parseArgs, redactSecrets } from './lib.mjs';
import { createClient } from '@supabase/supabase-js';

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  return { res, body };
}

/** Pure guard, unit-testable without a network call: is the probe target production itself? */
export function isSameHostAsProduction(baseUrl, prodUrl, canonicalHost) {
  const targetHost = new URL(baseUrl).host;
  if (prodUrl && new URL(prodUrl).host === targetHost) return true;
  if (canonicalHost && targetHost === canonicalHost) return true;
  return false;
}

async function assertSandboxTarget(baseUrl) {
  const prodUrl = optionalEnv('PRODUCTION_URL');
  const canonicalHost = optionalEnv('CANONICAL_HOST');
  if (isSameHostAsProduction(baseUrl, prodUrl, canonicalHost)) {
    throw new Error(
      `PAYMENT_SMOKE_BASE_URL (${baseUrl}) resolves to the SAME host as production ` +
        `(${prodUrl ?? canonicalHost}). Refusing to run a payment probe against production.`,
    );
  }

  const { res, body } = await getJson(`${baseUrl.replace(/\/+$/, '')}/api/v1/health`);
  if (res.status !== 200) {
    throw new Error(`Sandbox target health check failed: HTTP ${res.status}`);
  }
  if (body?.data?.live === true || body?.data?.paymentMode !== 'test') {
    throw new Error(
      `Sandbox target is NOT in Peach test mode (live=${body?.data?.live}, ` +
        `paymentMode=${body?.data?.paymentMode}). Refusing to create even a synthetic checkout ` +
        `against a live-payments target.`,
    );
  }
  console.log(`✓ target confirmed sandbox/test-mode: ${baseUrl} (paymentMode=test, live=false)`);
}

/** Mints a bearer JWT for the dedicated synthetic smoke-test user via Supabase password sign-in. */
async function signInSmokeUser() {
  const supabaseUrl = requireEnv('PAYMENT_SMOKE_SUPABASE_URL');
  const anonKey = requireEnv('PAYMENT_SMOKE_SUPABASE_ANON_KEY');
  const email = requireEnv('PAYMENT_SMOKE_USER_EMAIL');
  const password = requireEnv('PAYMENT_SMOKE_USER_PASSWORD');
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(
      `Failed to sign in the synthetic smoke-test user: ${error?.message ?? 'no session'}`,
    );
  }
  return data.session.access_token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args['base-url'] ?? requireEnv('PAYMENT_SMOKE_BASE_URL')).replace(/\/+$/, '');
  const activitySlug = args.slug ?? optionalEnv('PAYMENT_SMOKE_ACTIVITY_SLUG', 'north-tour');
  const runTag = optionalEnv('RELEASE_RUN_ID', String(Date.now()));

  await assertSandboxTarget(baseUrl);
  const token = await signInSmokeUser();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1) Availability — pick the next bookable occurrence with free seats.
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const { res: availRes, body: availBody } = await getJson(
    `${baseUrl}/api/v1/activities/${activitySlug}/availability?from=${from}&to=${to}`,
  );
  if (availRes.status !== 200)
    throw new Error(`availability check failed: HTTP ${availRes.status}`);
  const slot = (availBody?.data ?? []).find((s) => s.seatsLeft > 0);
  if (!slot)
    throw new Error(
      `No bookable occurrence with free seats for "${activitySlug}" in the next 60 days`,
    );
  console.log(`✓ availability: occurrence ${slot.occurrenceId} has ${slot.seatsLeft} seat(s) left`);

  // 2) Hold.
  const idempotencyKey = `release-smoke-hold-${runTag}-${crypto.randomUUID()}`;
  const { res: holdRes, body: holdBody } = await getJson(`${baseUrl}/api/v1/holds`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      occurrenceId: slot.occurrenceId,
      expectedSlug: activitySlug,
      people: 1,
      idempotencyKey,
    }),
  });
  if (holdRes.status !== 201) {
    throw new Error(
      `hold creation failed: HTTP ${holdRes.status} ${JSON.stringify(redactSecrets(JSON.stringify(holdBody)))}`,
    );
  }
  const holdId = holdBody.data.holdId;
  console.log(`✓ hold created: ${holdId} (expires ${holdBody.data.expiresAt})`);

  // 3) Booking — a clearly-synthetic customer identity.
  const syntheticEmail = `smoke+${runTag}-${crypto.randomUUID().slice(0, 8)}@bellemaretours.com`;
  const { res: bookRes, body: bookBody } = await getJson(`${baseUrl}/api/v1/bookings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      occurrenceId: slot.occurrenceId,
      expectedSlug: activitySlug,
      party: { Adult: 1 },
      holdId,
      customer: {
        name: `Release Smoke Test (${runTag})`,
        email: syntheticEmail,
        specialNotes:
          'SYNTHETIC — created by scripts/release/peach-payment-probe.mjs. Safe to purge.',
      },
      source: 'web',
      idempotencyKey: `release-smoke-booking-${runTag}-${crypto.randomUUID()}`,
    }),
  });
  if (bookRes.status !== 201) {
    throw new Error(
      `booking creation failed: HTTP ${bookRes.status} ${JSON.stringify(redactSecrets(JSON.stringify(bookBody)))}`,
    );
  }
  const bookingRef = bookBody.data.ref;
  console.log(
    `✓ booking created: ${bookingRef} (status=${bookBody.data.status}, synthetic email=${syntheticEmail})`,
  );

  // 4) Checkout creation — a REAL Peach sandbox checkout session/session id. STOP HERE.
  //
  // Completing the charge requires entering a card number into Peach's own hosted widget (an iframe
  // Peach controls, not this app's DOM), then either waiting for Peach's webhook or calling
  // POST /api/v1/payments/sync. Automating the card-entry step means either (a) driving a real
  // browser against a third-party-controlled, versioned UI this repo doesn't own and can't pin —
  // exactly the "interactive browser" case the task calls out as disqualifying an automated
  // "payment-smoke" label — or (b) storing test card details for programmatic entry, which the
  // safety rules for this pipeline prohibit outright regardless of them being Peach's own published
  // sandbox test numbers. So: this script proves the checkout CAN be created (auth, pricing, Peach
  // OAuth + create-checkout all work end-to-end) and no further. Completing the charge, confirming
  // via webhook/sync, and checking invoice availability is `payment-smoke` — an explicit human-
  // approved gate in release.yml (see docs/handbook/deployment.md "Payment smoke gate").
  const { res: payRes, body: payBody } = await getJson(`${baseUrl}/api/v1/payments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      bookingRef,
      idempotencyKey: `release-smoke-payment-${runTag}-${crypto.randomUUID()}`,
    }),
  });
  if (payRes.status !== 201) {
    throw new Error(
      `checkout creation failed: HTTP ${payRes.status} ${JSON.stringify(redactSecrets(JSON.stringify(payBody)))}`,
    );
  }
  console.log(
    `✓ Peach sandbox checkout created: checkoutId=${payBody.data.checkoutId} provider=${payBody.data.provider}`,
  );
  console.log(
    `✓ payment-probe passed: availability -> hold -> booking (${bookingRef}) -> Peach sandbox checkout ` +
      `creation, all verified. Charge completion is the manual payment-smoke gate.`,
  );
}

import { pathToFileURL } from 'node:url';
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`✗ peach-payment-probe failed: ${err.message}`);
    process.exit(1);
  });
}
