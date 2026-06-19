// Dev-only: query a Peach checkout's status (to design webhook-independent confirmation).
// Usage: node scripts/peach-status.mjs <checkoutId>
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const trim = (u) => (u || '').replace(/\/+$/, '');
const AUTH = trim(env.PEACH_AUTH_BASE_URL || env.PEACH_CHECKOUT_BASE_URL);
const CHECKOUT = trim(env.PEACH_CHECKOUT_BASE_URL);
const checkoutId = process.argv[2] || '85001c265b9a47a98149a2f585a2676f';

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
  process.exit(0);
}
const token = JSON.parse(await tokenRes.text()).access_token;

const statusRes = await fetch(`${CHECKOUT}/v2/checkout/${checkoutId}/status`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`GET /v2/checkout/${checkoutId}/status -> HTTP ${statusRes.status}`);
console.log((await statusRes.text()).slice(0, 2500));
