// Dev-only: reproduce the Peach OAuth + create-checkout calls to surface the exact error.
// Reads creds from .env.local; prints ONLY Peach's responses (never the secrets).
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const trim = (u) => (u || '').replace(/\/+$/, '');
const AUTH = trim(env.PEACH_AUTH_BASE_URL || env.PEACH_CHECKOUT_BASE_URL);
const CHECKOUT = trim(env.PEACH_CHECKOUT_BASE_URL);
const SITE = trim(env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');

console.log('AUTH base    :', AUTH);
console.log('CHECKOUT base:', CHECKOUT);
console.log('SITE         :', SITE);
console.log('entityId set :', env.PEACH_ENTITY_ID ? `yes (${env.PEACH_ENTITY_ID.slice(0, 4)}…)` : 'NO');

const tokenRes = await fetch(`${AUTH}/api/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: env.PEACH_CLIENT_ID,
    clientSecret: env.PEACH_CLIENT_SECRET,
    merchantId: env.PEACH_MERCHANT_ID,
  }),
});
const tokenText = await tokenRes.text();
console.log('\n=== token ===', tokenRes.status);
if (!tokenRes.ok) {
  console.log(tokenText.slice(0, 800));
  process.exit(0);
}
const token = JSON.parse(tokenText).access_token;
console.log('access_token :', token ? 'received' : 'MISSING');

const returnUrl = `${SITE}/bookings/PROBE-REF`;
for (const currency of ['EUR', 'MUR', 'USD']) {
  const body = {
    authentication: { entityId: env.PEACH_ENTITY_ID },
    merchantTransactionId: `PROBE-${currency}`,
    amount: '100.00',
    currency,
    paymentType: 'DB',
    nonce: crypto.randomUUID(),
    shopperResultUrl: returnUrl,
    ...(env.PEACH_WEBHOOK_URL ? { notificationUrl: env.PEACH_WEBHOOK_URL } : {}),
  };
  const coRes = await fetch(`${CHECKOUT}/v2/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: new URL(returnUrl).origin,
    },
    body: JSON.stringify(body),
  });
  const text = await coRes.text();
  let hosted = '';
  try { hosted = JSON.parse(text).redirectUrl || ''; } catch {}
  console.log(`\n=== ${currency} -> HTTP ${coRes.status} ===`);
  console.log(hosted || text.slice(0, 400));
}
