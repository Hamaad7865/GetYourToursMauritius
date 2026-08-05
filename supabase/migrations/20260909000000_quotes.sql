-- 20260909000000_quotes
--
-- Staff-drafted QUOTES: an itemised offer the owner builds in /admin/quotes, emails to a guest with
-- a signed public link, and that the guest pays through the EXISTING Peach checkout — so it lands in
-- the ledger and fires the confirmation + VAT invoice like any other booking. Schema only here; the
-- conversion RPC, the token, the pages and the email land in the tasks that follow.
--
-- Three tables, and the reason each exists:
--
-- 1) `quotes` — the draft itself, plus the public-link material. Only the SHA-256 HASH of the link
--    token is stored (`token_hash`); the raw token exists solely in the emailed URL, so a database
--    read (or a leaked backup) cannot mint a working link. `booking_id` is UNIQUE and set at
--    conversion, which is the schema-level half of "one quote can never mint two payable bookings"
--    (the other half is the guard inside api_convert_quote).
--
-- 2) `quote_items` — the lines. A CATALOGUE line names a real occurrence + option, so the money path
--    can re-price it from the catalogue at conversion; a CUSTOM (or, later, RENTAL) line is free text
--    carrying its own date/time, because it has no occurrence at all. `quote_item_shape` makes that
--    an invariant rather than a convention.
--
-- 3) `booking_custom_items` — the durable home for a priced booking line that has NO
--    session_occurrence. Deliberately NOT booking_items: that table's NOT NULL occurrence + option
--    are load-bearing for capacity, the day sheet and the voucher, and relaxing them would force
--    every existing reader to handle a null occurrence — on the money path. A separate table leaves
--    all of them untouched.
--
-- Conversion happens at PAY, never at send, so an unaccepted quote never holds capacity.
--
-- Part 2 (rentals) and Part 3 (calendar union) have their landing ground here on purpose:
-- `kind = 'rental'` + `rental_vehicle_slug` so Part 2 adds pricing and UI but no migration, and
-- `booking_custom_items.starts_at` is indexed so Part 3 is a read change, not a migration.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

-- MUST be the first statement, and 'quote' must NOT be USED anywhere later in this same migration:
-- Postgres forbids using an enum value added by ALTER TYPE in the transaction that added it.
-- api_convert_quote only references 'quote' at runtime (a later transaction), which is fine.
alter type booking_source add value if not exists 'quote';

do $$
begin
  create type quote_status as enum ('draft', 'sent', 'accepted', 'expired', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type quote_item_kind as enum ('catalogue', 'custom', 'rental');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1) quotes — the draft offer and its public link.
-- ---------------------------------------------------------------------------
create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  status quote_status not null default 'draft',
  currency text not null default 'EUR',
  -- Minor units, like every other money column here (bookings.total_minor is `int`, and this figure
  -- is copied straight into it at conversion — same type, so a too-large quote fails when it is
  -- entered, not silently at the insert).
  total_minor int not null default 0,
  valid_until date not null,
  intro_note text,
  -- Staff-only. Never rendered into the guest email or the public page.
  internal_notes text,
  -- SHA-256 of the raw link token. The raw token exists only in the emailed URL.
  token_hash text,
  sent_at timestamptz,
  -- Set once the guest pays. UNIQUE so one quote can never mint two payable bookings.
  booking_id uuid unique references bookings (id) on delete set null,
  locale content_locale not null default 'en',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) quote_items — catalogue lines and free-text lines, in the owner's order.
-- ---------------------------------------------------------------------------
create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade,
  position int not null,
  kind quote_item_kind not null,
  session_occurrence_id uuid references session_occurrences (id),
  activity_option_id uuid references activity_options (id),
  price_label text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  rental_vehicle_slug text references rental_vehicles (slug),
  quantity int not null check (quantity > 0),
  unit_amount_minor int not null check (unit_amount_minor >= 0),
  subtotal_minor int not null check (subtotal_minor >= 0),
  -- A catalogue line must name an occurrence + option; a custom/rental line must not.
  constraint quote_item_shape check (
    (kind = 'catalogue' and session_occurrence_id is not null and activity_option_id is not null)
    or (kind <> 'catalogue' and session_occurrence_id is null and activity_option_id is null
        and description is not null)
  )
);
-- The editor, the email and the public page all read the lines in the owner's order. Ordering by id
-- would be ordering by gen_random_uuid() — i.e. random per quote.
create index if not exists quote_items_quote_idx on quote_items (quote_id, position);

-- ---------------------------------------------------------------------------
-- 3) booking_custom_items — priced booking lines with no session_occurrence.
-- ---------------------------------------------------------------------------
create table if not exists booking_custom_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  position int not null,
  kind quote_item_kind not null check (kind <> 'catalogue'),
  description text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  rental_vehicle_slug text references rental_vehicles (slug),
  quantity int not null check (quantity > 0),
  unit_amount_minor int not null check (unit_amount_minor >= 0),
  subtotal_minor int not null check (subtotal_minor >= 0),
  created_at timestamptz not null default now()
);
create index if not exists booking_custom_items_booking_idx on booking_custom_items (booking_id, position);
-- Part 3 (calendar union) reads by day; index it now so that stays a read-only change.
create index if not exists booking_custom_items_starts_idx on booking_custom_items (starts_at)
  where starts_at is not null;

-- ---------------------------------------------------------------------------
-- 4) RLS + grants. A quote is staff data; the guest never reads it with the anon key — the public
--    page resolves it server-side behind the link token (a later task).
-- ---------------------------------------------------------------------------
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table booking_custom_items enable row level security;

drop policy if exists quotes_staff on quotes;
create policy quotes_staff on quotes for all to authenticated
  using (is_staff()) with check (is_staff());
drop policy if exists quote_items_staff on quote_items;
create policy quote_items_staff on quote_items for all to authenticated
  using (is_staff()) with check (is_staff());
drop policy if exists booking_custom_items_staff on booking_custom_items;
create policy booking_custom_items_staff on booking_custom_items for all to authenticated
  using (is_staff()) with check (is_staff());

-- Stock Supabase ALTER DEFAULT PRIVILEGES hands every new table to anon + authenticated, so the
-- revoke is what actually closes anon. The grants are then explicit because a fresh database built
-- from setup.sql (and the PGlite harness) has no default privileges at all — without them the staff
-- policies above would gate a table nobody may touch.
revoke all on quotes, quote_items, booking_custom_items from public, anon;
grant select, insert, update, delete on quotes to authenticated, service_role;
grant select, insert, update, delete on quote_items to authenticated, service_role;
grant select, insert, update, delete on booking_custom_items to authenticated, service_role;
