// Determine the payload shape Peach's /v2/checkout accepts for `standingInstruction`.
//
// WHY: result code 800.100.156 ("transaction declined (format error)") is documented by Peach as
// being caused by `standingInstruction.type = INSTALLMENT` on multiple card issuers, with the
// remedy being UNSCHEDULED. We never send the field, so something upstream is setting it on our
// follow-on charges. Before asserting UNSCHEDULED ourselves we must know whether the v2 JSON API
// wants it NESTED (`standingInstruction: {...}`) or DOTTED (`"standingInstruction.type": "..."`).
// Sending the wrong shape is itself a classic cause of the very error we are fixing.
//
// Read-only in effect: it creates checkout SESSIONS against the Peach SANDBOX (no card is ever
// entered, nothing settles, no money moves) and prints the HTTP status for each variant.
//
//   node scripts/sandbox/probe-standing-instruction.mjs
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
const need = [
  'PEACH_CLIENT_ID',
  'PEACH_CLIENT_SECRET',
  'PEACH_MERCHANT_ID',
  'PEACH_ENTITY_ID',
  'PEACH_AUTH_BASE_URL',
  'PEACH_CHECKOUT_BASE_URL',
];
const missing = need.filter((k) => !e[k]);
if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
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

// NOT from env: .env.local carries a localhost URL, and Peach's shopperResultUrl regex demands a
// real dotted host, so every variant 400s on that field alone and tells us nothing about the field
// under test.
const site = 'https://belle-mare-sandbox.vercel.app';
const base = {
  authentication: { entityId: e.PEACH_ENTITY_ID },
  amount: '10.00',
  currency: 'MUR',
  paymentType: 'DB',
  shopperResultUrl: `${site}/bookings/PROBE`,
};

// `source` came back as "unknown field" on the first run, so every surviving variant omits it.
const variants = {
  'A control (what we send today)': {},
  'B nested mode+type': { standingInstruction: { mode: 'INITIAL', type: 'UNSCHEDULED' } },
  'C dotted mode+type': {
    'standingInstruction.mode': 'INITIAL',
    'standingInstruction.type': 'UNSCHEDULED',
  },
  'D nested type only': { standingInstruction: { type: 'UNSCHEDULED' } },
  'E nested with source (expected reject)': {
    standingInstruction: { mode: 'INITIAL', type: 'UNSCHEDULED', source: 'CIT' },
  },
  // Does the LIVE-shaped signed-in path (allowStoringDetails) even work, and does it then permit
  // the UNSCHEDULED assertion? This is the only combination Peach says is legal.
  'F allowStoringDetails only': { allowStoringDetails: true },
  'G allowStoringDetails + UNSCHEDULED': {
    allowStoringDetails: true,
    standingInstruction: { mode: 'INITIAL', type: 'UNSCHEDULED' },
  },
  'H allowStoringDetails + INSTALLMENT (the documented bad case)': {
    allowStoringDetails: true,
    standingInstruction: { mode: 'INITIAL', type: 'INSTALLMENT' },
  },
};

for (const [label, extra] of Object.entries(variants)) {
  const body = {
    ...base,
    ...extra,
    merchantTransactionId: `PROBE${Date.now().toString(36).toUpperCase()}`.slice(0, 16),
    nonce: crypto.randomUUID(),
  };
  const res = await fetch(`${trim(e.PEACH_CHECKOUT_BASE_URL)}/v2/checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: new URL(site).origin,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  console.log(
    `${label}\n  HTTP ${res.status}  checkoutId=${parsed?.checkoutId ?? '—'}  result=${
      parsed?.result?.code ?? '—'
    } ${parsed?.result?.description ?? ''}`,
  );
  if (!res.ok) console.log(`  body: ${text.slice(0, 400)}`);
  console.log('');
}
