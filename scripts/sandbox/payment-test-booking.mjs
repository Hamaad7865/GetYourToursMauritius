// Mints a sandbox booking whose CARD CHARGE is pre-pinned to exactly 92.00 MUR — Peach's SA-sandbox
// "success" amount (support ticket 378206). Because api_record_payment_charge is record-once, the app
// won't overwrite the pin, so the Peach checkout charges 92.00 MUR and the sandbox approves it.
//
//   node scripts/sandbox/payment-test-booking.mjs
//
// Reads SUPABASE_DB_URL from .env.local (sandbox only — refuses the prod ref). Idempotent: re-running
// reuses the existing pending test booking. Prints the pay URL to open as customer@sandbox.test.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const PROD_REF = 'dwjkfowhrrvdiqligxcj';
const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const url = env.SUPABASE_DB_URL || '';
const site = env.NEXT_PUBLIC_SITE_URL || 'https://belle-mare-sandbox.vercel.app';
if (url.includes(PROD_REF) || (env.NEXT_PUBLIC_SUPABASE_URL || '').includes(PROD_REF)) {
  console.error('✗ Refusing to run against production.');
  process.exit(1);
}
const mm = url.match(/^postgres(?:ql)?:\/\/(.+)$/i);
const rest = mm[1];
const at = rest.lastIndexOf('@');
const creds = rest.slice(0, at);
let hp = rest.slice(at + 1);
const c = creds.indexOf(':');
const user = creds.slice(0, c);
const pw = creds.slice(c + 1);
let db = 'postgres';
const s = hp.indexOf('/');
if (s !== -1) {
  db = hp.slice(s + 1).split('?')[0] || 'postgres';
  hp = hp.slice(0, s);
}
const [host, port] = hp.split(':');
const client = new pg.Client({
  host,
  port: port ? +port : 5432,
  user,
  password: pw,
  database: db,
  ssl: { rejectUnauthorized: false },
});

const ACTIVITY_SQL = `
insert into activities (operator_id, slug, title, category, type, pricing_mode, status, summary, description, location, duration_minutes, pickup_available, daily_capacity, min_advance_days)
select o.id, 'sandbox-payment-test', 'Sandbox Payment Test',
  (select category from activities where slug='north-tour'),
  (select type from activities where slug='north-tour'),
  'per_person', 'published',
  'Internal payment-flow test. Not a real tour.',
  'Internal test activity used to validate the Peach sandbox payment flow at the success amount (92.00 MUR).',
  'Belle Mare', 60, false, 20, 0
from operators o where o.slug='belle-mare-tours'
on conflict (slug) do update set status='published', min_advance_days=0;

insert into activity_options (activity_id, name)
select a.id, 'Standard' from activities a where a.slug='sandbox-payment-test'
  and not exists (select 1 from activity_options x where x.activity_id=a.id);

insert into activity_option_prices (activity_option_id, label, amount_minor, currency, max_guests, position)
select o.id, 'Adult', 170, 'EUR', 10, 0
from activity_options o join activities a on a.id=o.activity_id
where a.slug='sandbox-payment-test'
  and not exists (select 1 from activity_option_prices pr where pr.activity_option_id=o.id);

insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id, a.operator_id,
  ((d::date + time '12:00') at time zone 'Indian/Mauritius'),
  ((d::date + time '12:00') at time zone 'Indian/Mauritius') + make_interval(mins=>60), 20, 'open'
from activities a join activity_options o on o.activity_id=a.id
cross join generate_series((now() at time zone 'Indian/Mauritius')::date, (now() at time zone 'Indian/Mauritius')::date+30, interval '1 day') d
where a.slug='sandbox-payment-test'
  and not exists (select 1 from session_occurrences x where x.activity_option_id=o.id and (x.starts_at at time zone 'Indian/Mauritius')::date=d::date)
on conflict (activity_option_id, starts_at) do nothing;`;

const BOOKING_SQL = `
do $pt$
declare v_user uuid; v_occ uuid; v_opt uuid; v_booking uuid;
begin
  if exists (select 1 from bookings where notes='sandbox-pay-test' and status='payment_pending') then
    raise notice 'reuse'; return;
  end if;
  v_user := (select id from auth.users where email='customer@sandbox.test');
  select so.id, so.activity_option_id into v_occ, v_opt
  from session_occurrences so
  join activity_options o on o.id=so.activity_option_id
  join activities a on a.id=o.activity_id
  where a.slug='sandbox-payment-test' and so.status='open' and so.starts_at > now()
  order by so.starts_at limit 1;
  if v_occ is null then raise exception 'no open occurrence for sandbox-payment-test'; end if;

  insert into bookings (user_id, customer_name, customer_email, source, status, currency, total_minor, operator_payout_minor, agency_commission_minor, payment_state, notes)
  values (v_user, 'Amelia Rose', 'customer@sandbox.test', 'web', 'payment_pending', 'EUR', 170, 170, 0, 'pending', 'sandbox-pay-test')
  returning id into v_booking;

  insert into booking_items (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
  values (v_booking, v_occ, v_opt, 'Adult', 1, 170, 170);

  -- Pre-pin the CARD charge to 92.00 MUR (record-once → the app won't overwrite it).
  insert into payments (booking_id, idempotency_key, provider, amount_minor, currency, status, charged_amount_minor, charged_currency)
  values (v_booking, 'sandbox-pay-test-'||v_booking::text, 'peach', 170, 'EUR', 'pending', 9200, 'MUR');
end
$pt$;`;

await client.connect();
await client.query(ACTIVITY_SQL);
await client.query(BOOKING_SQL);
const { rows } = await client.query(
  `select b.ref, b.status, p.charged_amount_minor, p.charged_currency
     from bookings b join payments p on p.booking_id=b.id
    where b.notes='sandbox-pay-test' order by b.created_at desc limit 1`,
);
await client.end();
const r = rows[0];
console.log('\n✓ Test booking ready');
console.log(`  ref      ${r.ref}`);
console.log(
  `  charge   ${(r.charged_amount_minor / 100).toFixed(2)} ${r.charged_currency}   ← Peach sandbox success amount`,
);
console.log(`\n  Sign in as customer@sandbox.test, then open:`);
console.log(`  ${site.replace(/\/+$/, '')}/bookings/${r.ref}/pay\n`);
