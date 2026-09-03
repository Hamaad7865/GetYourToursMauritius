// Does Peach accept the GENERATED merchantTransactionId shape we now send?
//
// WHY: the scheme changed from DERIVED (`<bookingRef>`, then `<bookingRef>-<8 hex>`) to GENERATED
// (`BMT` + 13 Crockford base32 = 16 chars, recorded in payment_merchant_refs). Before that ships, the
// standing rule applies — probe the sandbox rather than trusting a belief about a Peach parameter. The
// "≤16 alphanumeric" belief was already wrong once and cost a full investigation.
//
// WHAT THIS CAN AND CANNOT PROVE. It creates checkout SESSIONS (no card entered, nothing settles, no
// money moves), so it proves the FORMAT is accepted when a session is opened. It cannot exercise the
// card step, which is where 800.100.156 is actually raised — that is why the id is kept at 16
// characters, the length already proven in production, rather than made longer.
//
//   node scripts/sandbox/probe-generated-mtid.mjs
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

// Mirrors src/lib/payments/merchant-ref.ts exactly — if that changes, change this with it.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function generateMerchantTransactionId() {
  const bytes = new Uint8Array(13);
  crypto.getRandomValues(bytes);
  let out = 'BMT';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

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

// A real dotted host: .env.local's localhost shopperResultUrl 400s every probe and masks the field
// actually under test.
const site = 'https://belle-mare-sandbox.vercel.app';

async function open(label, mtid) {
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
  console.log(`${label}`);
  console.log(`  mtid=${mtid}  (len ${mtid.length})`);
  console.log(
    `  HTTP ${res.status}  result=${parsed?.result?.code ?? '—'}  checkoutId=${parsed?.checkoutId ?? '—'}`,
  );
  if (!res.ok) console.log(`  body: ${text.slice(0, 400)}`);
  return res.ok;
}

const a = generateMerchantTransactionId();
const b = generateMerchantTransactionId();
await open('1) generated id', a);
await open('2) a SECOND, different generated id (the reissue case)', b);
// The shape a burned session is replaced BY — same payment, new id. This is the behaviour the whole
// change exists for, so it is worth seeing accepted back-to-back.
await open('3) a third, immediately after', generateMerchantTransactionId());
