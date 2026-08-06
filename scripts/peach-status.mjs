// Dev-only: query one or more Peach checkouts' authoritative status. Read-only — it never writes to
// the ledger (that's peach-reconcile.mjs) and never prints a credential.
//
// Usage: node scripts/peach-status.mjs <checkoutId...> [--env <file>]
//
// --env matters: production runs the LIVE Peach account while .env.local is usually sandbox, and a
// live checkout id queried against sandbox returns a bare `404 Checkout not found` — indistinguishable
// from a session that never existed. The banner prints the environment and API host for that reason;
// check it before believing a 404.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const envIdx = argv.findIndex((a) => a === '--env');
const envFile = envIdx === -1 ? '.env.local' : argv[envIdx + 1];
const checkoutIds = argv.filter((a, i) => !a.startsWith('--') && i !== envIdx + 1);
if (!checkoutIds.length) {
  console.log('usage: node scripts/peach-status.mjs <checkoutId...> [--env <file>]');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  // Trim BEFORE and AFTER unquoting: a copy-pasted secret often carries a trailing space or CR, and
  // the auth endpoint rejects it as "Invalid client ID or secret" — indistinguishable from wrong keys.
  if (m)
    env[m[1]] = m[2]
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
}
const trim = (u) => (u || '').replace(/\/+$/, '');
const AUTH = trim(env.PEACH_AUTH_BASE_URL || env.PEACH_CHECKOUT_BASE_URL);
const CHECKOUT = trim(env.PEACH_CHECKOUT_BASE_URL);
if (!CHECKOUT) {
  console.log(`no PEACH_CHECKOUT_BASE_URL in ${envFile}`);
  process.exitCode = 1;
}
// A bare host (secure.peachpayments.com) makes fetch throw an unhelpful parse error much later, at
// the first status call, long after the banner has printed a plausible-looking config.
for (const [name, url] of [
  ['PEACH_AUTH_BASE_URL', AUTH],
  ['PEACH_CHECKOUT_BASE_URL', CHECKOUT],
]) {
  if (url && !/^https?:\/\//.test(url)) {
    console.log(`${name} is missing its scheme — expected https://${url}`);
    process.exitCode = 1;
  }
}
if (process.exitCode) process.exit();
console.log(`env file    ${envFile}`);
console.log(`environment ${env.PEACH_ENVIRONMENT ?? '(unset)'}`);
console.log(`checkout API ${CHECKOUT}\n`);

const tokenRes = await fetch(`${AUTH}/api/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: env.PEACH_CLIENT_ID,
    clientSecret: env.PEACH_CLIENT_SECRET,
    merchantId: env.PEACH_MERCHANT_ID,
  }),
});
if (!tokenRes.ok) {
  console.log('token failed', tokenRes.status, (await tokenRes.text()).slice(0, 300));
  // "Invalid client ID or secret" has three indistinguishable causes: sandbox keys against the live
  // host, a truncated paste, or stray whitespace/quotes. Print the SHAPE of each value — lengths and
  // whether anything non-printable survived parsing — never the values themselves.
  console.log('\ncredential shape (no values shown):');
  for (const k of ['PEACH_CLIENT_ID', 'PEACH_CLIENT_SECRET', 'PEACH_MERCHANT_ID']) {
    const v = env[k];
    console.log(
      `  ${k.padEnd(20)} ${v == null ? 'MISSING' : `len=${v.length}${/[^\x21-\x7e]/.test(v) ? ' CONTAINS WHITESPACE/NON-PRINTABLE' : ''}`}`,
    );
  }
  console.log(`  auth host            ${AUTH}`);
  process.exit(1);
}
const token = JSON.parse(await tokenRes.text()).access_token;

// The status payload is flat with dotted keys (result.code, card.bin, …). Print the fields that answer
// "did a card ever get submitted, and what did the issuer say", then anything else that looks like a
// result/attempt so a shape we haven't seen before still surfaces instead of being silently dropped.
const FIELDS = [
  'result.code',
  'result.description',
  'merchantTransactionId',
  'amount',
  'currency',
  'paymentType',
  'paymentBrand',
  'card.bin',
  'card.last4Digits',
  'timestamp',
  'id',
];

for (const checkoutId of checkoutIds) {
  const res = await fetch(`${CHECKOUT}/v2/checkout/${encodeURIComponent(checkoutId)}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  console.log(`── ${checkoutId} → HTTP ${res.status}`);
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    // An HTML body means the host answered but is not the checkout API — almost always
    // PEACH_CHECKOUT_BASE_URL pointing at the dashboard/auth host, whose SPA catch-all returns 200
    // with markup for ANY path. Left as a raw dump, that reads like a successful response.
    console.log(
      /^\s*<(!doctype|html)/i.test(body)
        ? `   not JSON — ${CHECKOUT} is not the checkout API` +
            ` (live expects https://secure.peachpayments.com)\n`
        : `   ${body.slice(0, 500)}\n`,
    );
    continue;
  }
  if (!res.ok) {
    console.log(`   ${JSON.stringify(data)}\n`);
    continue;
  }
  for (const k of FIELDS) if (data[k] != null) console.log(`   ${k.padEnd(22)} ${data[k]}`);
  for (const k of Object.keys(data)) {
    if (!FIELDS.includes(k) && /result|status|reason|attempt|transaction/i.test(k)) {
      console.log(`   ${k.padEnd(22)} ${JSON.stringify(data[k]).slice(0, 200)}`);
    }
  }
  console.log();
}
