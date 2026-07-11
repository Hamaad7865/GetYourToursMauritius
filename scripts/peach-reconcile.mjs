// Dev-only: confirm a booking by re-querying Peach for the checkout's authoritative status and
// appending the verified result to the ledger (service-role). Usage:
//   node scripts/peach-reconcile.mjs <checkoutId>
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const trim = (u) => (u || '').replace(/\/+$/, '');
const AUTH = trim(env.PEACH_AUTH_BASE_URL || env.PEACH_CHECKOUT_BASE_URL);
const CHECKOUT = trim(env.PEACH_CHECKOUT_BASE_URL);
const checkoutId = process.argv[2];
if (!checkoutId) {
  console.log('usage: node scripts/peach-reconcile.mjs <checkoutId>');
  process.exit(1);
}

// 1) OAuth token
const tokenRes = await fetch(`${AUTH}/api/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientId: env.PEACH_CLIENT_ID,
    clientSecret: env.PEACH_CLIENT_SECRET,
    merchantId: env.PEACH_MERCHANT_ID,
  }),
});
const token = JSON.parse(await tokenRes.text()).access_token;

// 2) Authoritative status from Peach
const statusRes = await fetch(`${CHECKOUT}/v2/checkout/${checkoutId}/status`, {
  headers: { Authorization: `Bearer ${token}` },
});
const status = JSON.parse(await statusRes.text());
const code = status['result.code'];
const bookingRef = status.merchantTransactionId;
const paid = /^(000\.000\.|000\.100\.1)/.test(code || '');
console.log(
  `status: code=${code} ref=${bookingRef} amount=${status.amount} ${status.currency} paid=${paid}`,
);
if (!paid) {
  console.log('not a successful payment — nothing to confirm');
  process.exit(0);
}

// 3) Append the verified event (service-role), confirming the EUR-denominated payment in full
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: booking } = await supa
  .from('bookings')
  .select('id, status, payment_state')
  .eq('ref', bookingRef)
  .maybeSingle();
if (!booking) {
  console.log('booking not found', bookingRef);
  process.exit(1);
}
const { data: payment } = await supa
  .from('payments')
  .select('id, amount_minor')
  .eq('booking_id', booking.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (!payment) {
  console.log('no payment row');
  process.exit(1);
}

const { error } = await supa.rpc('append_payment_event', {
  p_payment_id: payment.id,
  p_type: 'paid',
  p_provider_event_id: status.id ?? checkoutId,
  p_amount_minor: payment.amount_minor, // EUR ledger: a successful full USD charge satisfies it
  p_occurred_at: new Date().toISOString(),
  p_payload: status,
});
if (error) {
  console.log('append error:', error.message);
  process.exit(1);
}
const { data: after } = await supa
  .from('bookings')
  .select('status, payment_state')
  .eq('ref', bookingRef)
  .maybeSingle();
console.log('confirmed ->', after);
