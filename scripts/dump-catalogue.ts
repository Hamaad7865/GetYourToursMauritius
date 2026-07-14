/**
 * Dumps the LIVE catalogue + config to `supabase/seed-live-catalogue.sql`.
 *
 *   npx tsx scripts/dump-catalogue.ts
 *
 * Two jobs, one file:
 *   1. A LOGICAL BACKUP of the only data in the database you cannot re-create by
 *      hand (46 activities, their options/prices/images, and every fare/pricing
 *      table). Run this BEFORE `supabase/purge-transactional.sql`.
 *   2. The SEED for a fresh TEST project: run `supabase/setup.sql` there, then
 *      this file, and the test DB mirrors production's catalogue.
 *
 * It deliberately does NOT dump: bookings/payments/holds (transactional), profiles
 * or auth users (PII), notification_outbox / rate_limits / audit_logs (junk), or
 * session_occurrences (8k+ rows that are pure derived state — the generated file
 * rebuilds them from the catalogue instead, mirroring materialize_availability).
 *
 * Escaping is done by POSTGRES, not by us: every value is rendered through
 * `format('%L')` server-side, so text[] / jsonb / enums / embedded quotes come out
 * correct. We only add the cast that tells Postgres how to read the literal back.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const root = process.cwd();
const OUT = 'supabase/seed-live-catalogue.sql';

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(root, '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function buildClientConfig(url: string): pg.ClientConfig {
  const m = url.match(/^postgres(?:ql)?:\/\/(.+)$/i);
  if (!m) throw new Error('SUPABASE_DB_URL must start with postgres:// or postgresql://');
  const rest = m[1]!;
  const at = rest.lastIndexOf('@');
  const creds = rest.slice(0, at);
  let hostPart = rest.slice(at + 1);
  const colon = creds.indexOf(':');
  const user = colon === -1 ? creds : creds.slice(0, colon);
  const password = colon === -1 ? '' : creds.slice(colon + 1);
  let database = 'postgres';
  const slash = hostPart.indexOf('/');
  if (slash !== -1) {
    database = hostPart.slice(slash + 1).split('?')[0] || 'postgres';
    hostPart = hostPart.slice(0, slash);
  }
  const [host, portStr] = hostPart.split(':');
  return {
    host,
    port: portStr ? Number(portStr) : 5432,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  };
}

/** A column and, when the literal needs help being read back, the cast to apply. */
type Col = string | { name: string; cast: string };

interface TableSpec {
  table: string;
  cols: Col[];
  /** Stable output order, so re-dumping produces a diffable file. */
  order: string;
}

const name = (c: Col): string => (typeof c === 'string' ? c : c.name);
const cast = (c: Col): string | null => (typeof c === 'string' ? null : c.cast);

/**
 * INSERT ORDER = FK order (parents first). The generated file wipes in the exact
 * reverse, so a re-run is a clean full replace.
 */
const TABLES: TableSpec[] = [
  {
    table: 'operators',
    cols: [
      'id',
      'name',
      'slug',
      'contact_email',
      'phone',
      { name: 'payout_details', cast: 'jsonb' },
      'status',
      'created_at',
    ],
    order: 'slug',
  },
  {
    table: 'categories',
    cols: ['id', 'name', 'slug', 'position', 'image_url', 'status', 'created_at'],
    order: 'position, slug',
  },
  {
    table: 'activities',
    cols: [
      'id',
      'operator_id',
      'slug',
      { name: 'type', cast: 'activity_type' },
      'title',
      'summary',
      'description',
      'category',
      'location',
      'duration_minutes',
      'meeting_point',
      'pickup_available',
      { name: 'languages', cast: 'text[]' },
      { name: 'inclusions', cast: 'text[]' },
      { name: 'exclusions', cast: 'text[]' },
      { name: 'highlights', cast: 'text[]' },
      'cancellation_policy',
      { name: 'status', cast: 'activity_status' },
      'seo_title',
      'seo_description',
      'rating_avg',
      'rating_count',
      'created_at',
      { name: 'extra', cast: 'jsonb' },
      'daily_capacity',
      'pricing_mode',
      'is_custom_planner',
      'region',
      'lat',
      'lng',
      'min_advance_days',
      'is_airport_transfer',
      'is_hotel_transfer',
      'sort',
    ],
    order: 'slug',
  },
  {
    table: 'activity_options',
    cols: [
      'id',
      'activity_id',
      'name',
      'description',
      'status',
      'position',
      'created_at',
      'duration_minutes',
      'start_window',
      'private_base_minor',
      'private_included',
      'private_extra_minor',
      'private_max_guests',
      'daily_capacity',
    ],
    order: 'activity_id, position, id',
  },
  {
    table: 'activity_option_prices',
    cols: [
      'id',
      'activity_option_id',
      'label',
      'amount_minor',
      'currency',
      'max_guests',
      'position',
      'min_age',
      'max_age',
    ],
    order: 'activity_option_id, position, id',
  },
  {
    table: 'activity_images',
    cols: ['id', 'activity_id', 'url', 'alt', 'position'],
    order: 'activity_id, position, id',
  },
  {
    table: 'activity_translations',
    cols: [
      'id',
      'activity_id',
      { name: 'locale', cast: 'content_locale' },
      'title',
      'summary',
      'description',
      { name: 'highlights', cast: 'text[]' },
      { name: 'inclusions', cast: 'text[]' },
      { name: 'exclusions', cast: 'text[]' },
      'meeting_point',
      'seo_title',
      'seo_description',
    ],
    order: 'activity_id, locale',
  },
  // ---- pricing / transfer / planner / rental config (all admin-tuned by hand) ----
  {
    table: 'sightseeing_pricing',
    cols: [
      'id',
      'per_block_minor',
      'suv_flat_minor',
      'updated_at',
      'sedan_minor',
      'suv_minor',
      'family_minor',
      'van_minor',
      'coaster_minor',
    ],
    order: 'id',
  },
  {
    table: 'transport_band_pricing',
    cols: [
      'band',
      'sedan_minor',
      'suv_minor',
      'family_minor',
      'van_minor',
      'coaster_minor',
      'updated_at',
    ],
    order: 'band',
  },
  {
    table: 'region_zone_distance',
    cols: ['region_a', 'region_b', 'band'],
    order: 'region_a, region_b',
  },
  {
    table: 'airport_transfer_config',
    cols: ['id', 'return_discount_pct', 'updated_at'],
    order: 'id',
  },
  {
    table: 'airport_transfer_fare',
    cols: [
      'zone',
      'sedan_minor',
      'suv_minor',
      'family_minor',
      'van_minor',
      'coaster_minor',
      'updated_at',
    ],
    order: 'zone',
  },
  {
    table: 'airport_transfer_hotels',
    cols: ['slug', 'hotel_name', 'region', 'zone'],
    order: 'slug',
  },
  {
    table: 'hotel_transfer_config',
    cols: ['id', 'return_discount_pct', 'updated_at'],
    order: 'id',
  },
  {
    table: 'hotel_transfer_fare',
    cols: [
      'band',
      'sedan_minor',
      'suv_minor',
      'family_minor',
      'van_minor',
      'coaster_minor',
      'updated_at',
    ],
    order: 'band',
  },
  {
    table: 'planner_places',
    cols: [
      'id',
      'name',
      'category',
      'region',
      'lat',
      'lng',
      'duration_min',
      'closes_at',
      'blurb',
      'image_url',
      'position',
      'created_at',
    ],
    order: 'position, id',
  },
  {
    table: 'planner_pricing',
    cols: [
      'id',
      'standard_minor',
      'suv_minor',
      'six_minor',
      'van_minor',
      'coach_minor',
      'max_party',
      'updated_at',
    ],
    order: 'id',
  },
  {
    table: 'rental_vehicles',
    cols: [
      'slug',
      'name',
      'category',
      'seats',
      'transmission',
      'air_con',
      'image_url',
      'daily_rate_minor',
      'deposit_minor',
      'sort',
      'active',
      'updated_at',
    ],
    order: 'sort, slug',
  },
];

/** Quote a string as a Postgres literal (for embedding the format() template). */
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** One `select format(...)` that makes Postgres render each row as a ready INSERT. */
function dumpQuery(spec: TableSpec): string {
  const colNames = spec.cols.map((c) => `"${name(c)}"`).join(', ');
  const placeholders = spec.cols
    .map((c) => {
      const cst = cast(c);
      return cst ? `%L::${cst}` : '%L';
    })
    .join(', ');
  const template = `insert into ${spec.table} (${colNames}) values (${placeholders});`;
  const args = spec.cols.map((c) => `"${name(c)}"`).join(', ');
  return `select format(${lit(template)}, ${args}) as stmt from ${spec.table} order by ${spec.order}`;
}

const HEADER = `-- ============================================================================
-- LIVE CATALOGUE SEED — GENERATED by scripts/dump-catalogue.ts. Do not edit by hand.
--
-- Contains the real Belle Mare Tours catalogue + every hand-tuned pricing/fare
-- table. Contains NO bookings, payments, customers or other PII.
--
-- Use it for either of:
--   * SEEDING A TEST PROJECT: run supabase/setup.sql first, then this file.
--   * RESTORING the catalogue after an accident.
--
-- ⚠️  THIS FILE REPLACES THE ENTIRE CATALOGUE. It deletes every activity, option,
--     price, image and config row, then re-inserts the ones below. It is safe on a
--     fresh/test database and DESTRUCTIVE on a database whose catalogue you have
--     edited since this dump was taken.
--
--     To prevent an accidental paste into the wrong project it refuses to run
--     unless you opt in FIRST, in the same SQL editor tab:
--
--         set bmt.allow_catalogue_replace = 'yes';
--
-- Availability (session_occurrences) is NOT dumped — it is derived state. The
-- final step rebuilds it from the catalogue, exactly like materialize_availability.
-- ============================================================================

do $guard$
begin
  if coalesce(current_setting('bmt.allow_catalogue_replace', true), '') <> 'yes' then
    raise exception
      'REFUSING TO RUN: this replaces the whole catalogue. If you really mean it (test DB), run:  set bmt.allow_catalogue_replace = ''yes'';  first, in this same tab.';
  end if;
end
$guard$;

begin;

-- --- wipe, children before parents (reverse of the insert order below) -------
-- Bookings/holds go first: booking_items -> session_occurrences is ON DELETE
-- RESTRICT, so leftover test bookings would otherwise block the occurrence wipe.
delete from booking_holds;
delete from bookings;
delete from session_occurrences;

delete from activity_translations;
delete from activity_images;
delete from activity_option_prices;
delete from activity_options;
delete from activities;
delete from categories;
delete from operators;

delete from rental_vehicles;
delete from planner_pricing;
delete from planner_places;
delete from hotel_transfer_fare;
delete from hotel_transfer_config;
delete from airport_transfer_hotels;
delete from airport_transfer_fare;
delete from airport_transfer_config;
delete from region_zone_distance;
delete from transport_band_pricing;
delete from sightseeing_pricing;
`;

const FOOTER = `
-- --- rebuild availability from the catalogue --------------------------------
-- Mirrors materialize_availability({days:185}) with a null activityId (= all
-- published activities). Inlined as a plain INSERT so it runs in the SQL editor,
-- where the function's \`is_staff() or service_role\` guard would reject us.
insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
select o.id,
       a.operator_id,
       (d::date + time '12:00') at time zone 'Indian/Mauritius',
       ((d::date + time '12:00') at time zone 'Indian/Mauritius')
         + make_interval(mins => coalesce(a.duration_minutes, 240)),
       coalesce(o.daily_capacity, a.daily_capacity),
       'open'
  from activities a
  join activity_options o on o.activity_id = a.id
  cross join generate_series(
        (now() at time zone 'Indian/Mauritius')::date,
        (now() at time zone 'Indian/Mauritius')::date + 185,
        interval '1 day') d
 where a.status = 'published'
   and coalesce(a.daily_capacity, 0) > 0
   and coalesce(o.daily_capacity, a.daily_capacity, 0) > 0
   and (
     exists (select 1 from activity_option_prices pr where pr.activity_option_id = o.id)
     or o.private_base_minor is not null
   )
   and not exists (
     select 1 from session_occurrences x
     where x.activity_option_id = o.id
       and (x.starts_at at time zone 'Indian/Mauritius')::date = d::date
   )
on conflict (activity_option_id, starts_at) do nothing;

commit;

-- --- verify -----------------------------------------------------------------
select 'activities' t, count(*) n from activities
union all select 'activity_options', count(*) from activity_options
union all select 'activity_option_prices', count(*) from activity_option_prices
union all select 'activity_images', count(*) from activity_images
union all select 'categories', count(*) from categories
union all select 'rental_vehicles', count(*) from rental_vehicles
union all select 'airport_transfer_hotels', count(*) from airport_transfer_hotels
union all select 'planner_places', count(*) from planner_places
union all select 'session_occurrences (rebuilt)', count(*) from session_occurrences
order by 1;
`;

const env = { ...loadEnvLocal(), ...process.env };
const url = env.SUPABASE_DB_URL;
if (!url) {
  console.error('Missing SUPABASE_DB_URL in .env.local');
  process.exit(1);
}

const client = new pg.Client(buildClientConfig(url));
const parts: string[] = [HEADER];
let total = 0;

try {
  await client.connect();
  for (const spec of TABLES) {
    const { rows } = await client.query<{ stmt: string }>(dumpQuery(spec));
    parts.push(`\n-- ${spec.table} (${rows.length} rows)`);
    if (rows.length === 0) {
      parts.push('-- (none)');
    } else {
      for (const r of rows) parts.push(r.stmt);
    }
    total += rows.length;
    console.log(`  ${String(rows.length).padStart(4)}  ${spec.table}`);
  }
  parts.push(FOOTER);
  writeFileSync(join(root, OUT), parts.join('\n'), 'utf8');
  console.log(`\n✓ wrote ${OUT} — ${total} rows across ${TABLES.length} tables`);
} catch (e) {
  console.error('✗ dump failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await client.end();
}
