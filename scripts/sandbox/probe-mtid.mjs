// What does Peach's /v2/checkout actually accept as `merchantTransactionId`?
//
// WHY: Peach support confirmed the cause of result code 800.100.156 on our follow-on charges —
// "the provided merchantTransactionId already have a previous successful transaction. As such, the
// same merchantTransactionId cannot be used for other transactions." Our booking ref is already 16
// characters, so before appending a uniqueness suffix we need the real length and charset limits,
// not the ones we assume.
//
// Creates checkout SESSIONS only (no card entered, nothing settles, no money moves).
//
//   node scripts/sandbox/probe-mtid.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function env() {
  const out = {};
  const p = join(process.cwd(), '.env.local');
  if (!existsSync(p)) return out;
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i === -1) continue;
    out[l.slice(0, i).trim()] = l
      .slice(i + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const e = { ...env(), ...process.env };
if ((e.PEACH_ENVIRONMENT ?? 'test') !== 'test') {
  throw new Error(`refusing to probe a non-test Peach environment (${e.PEACH_ENVIRONMENT})`);
}
const trim = (s) => s.replace(/\/+$/, '');

const tokenRes = await fetch(`${trim(e.PEACH_AUTH_BASE_URL)}/api/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: e.PEACH_CLIENT_ID,
    clientSecret: e.PEACH_CLIENT_SECRET,
    merchantId: e.PEACH_MERCHANT_ID,
  }),
});
if (!tokenRes.ok) throw new Error(`oauth failed ${tokenRes.status}: ${await tokenRes.text()}`);
const token = (await tokenRes.json()).access_token;
console.log('oauth ok\n');

const site = 'https://belle-mare-sandbox.vercel.app';
const stamp = Date.now().toString(36).toUpperCase();

// A realistic booking ref shape (BMT + 13 hex = 16 chars) plus candidate suffixes.
const ref16 = `BMT${stamp.padEnd(13, '0').slice(0, 13)}`;

const cases = {
  'plain 16 (today)': ref16,
  '18 — ref + "B2"': `${ref16}B2`,
  '19 — ref + "-B2"': `${ref16}-B2`,
  '20 — ref + "0002"': `${ref16}0002`,
  '24 chars': `${ref16}${stamp.slice(0, 8).padEnd(8, 'X')}`,
  '32 chars': `${ref16}${stamp.padEnd(16, 'X').slice(0, 16)}`,
  '40 chars': `${ref16}${stamp.padEnd(24, 'X').slice(0, 24)}`,
  '64 chars': `${ref16}${stamp.padEnd(48, 'X').slice(0, 48)}`,
  'underscore separator': `${ref16}_2`,
  'dot separator': `${ref16}.2`,
};

for (const [label, mtid] of Object.entries(cases)) {
  const res = await fetch(`${trim(e.PEACH_CHECKOUT_BASE_URL)}/v2/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: new URL(site).origin,
    },
    body: JSON.stringify({
      authentication: { entityId: e.PEACH_ENTITY_ID },
      merchantTransactionId: mtid,
      amount: '10.00',
      currency: 'MUR',
      paymentType: 'DB',
      nonce: crypto.randomUUID(),
      shopperResultUrl: `${site}/bookings/PROBE`,
    }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  console.log(`${label}  (len ${mtid.length})`);
  console.log(`  HTTP ${res.status}  checkoutId=${parsed?.checkoutId ?? '—'}`);
  if (!res.ok) console.log(`  body: ${text.slice(0, 300)}`);
}
