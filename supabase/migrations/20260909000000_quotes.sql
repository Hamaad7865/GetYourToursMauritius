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
  -- Minor units, and `bigint` like every other money column on the money path: 20260615121000
  -- widened bookings.total_minor and booking_items' amounts precisely because int caps at ~21.4M
  -- EUR-cents and a full-boat charter overflows it. A bespoke quote IS that case, and this figure is
  -- copied straight into bookings.total_minor at conversion, so it must be the same width.
  total_minor bigint not null default 0,
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
  -- `set null`: a quote is a financial record that outlives its author, so deleting a departed
  -- colleague's auth user must forget who drafted it, never be blocked by it or delete it with them.
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
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
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
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  created_at timestamptz not null default now()
);
create index if not exists booking_custom_items_booking_idx on booking_custom_items (booking_id, position);
-- Part 3 (calendar union) reads by day; index it now so that stays a read-only change.
create index if not exists booking_custom_items_starts_idx on booking_custom_items (starts_at)
  where starts_at is not null;

-- ---------------------------------------------------------------------------
-- 4) `converted_at` — the conversion record a foreign key cannot clear.
--
-- `booking_id` is UNIQUE, which is what stops a second payable booking. But it is also
-- `on delete set null`, and bookings ARE hard-deleted: api_erase_user (20260816000000) deletes every
-- unpaid/pending booking for a person outright. That delete silently reverts booking_id to null, so
-- a quote that HAS been converted looks unconverted again — and the conversion guard being built on
-- top of it in the next task would mint a fresh booking. Today that only re-mints a never-paid
-- booking, so it is not a double charge; it is a guard resting on a column another statement can
-- reset, which is not a foundation to build the money path on.
--
-- CONTRACT for api_convert_quote and the pay route: set `converted_at` alongside `booking_id`, and
-- guard on `converted_at is null` — never on `booking_id is null`. The UNIQUE stays as the second
-- line of defence.
--
-- And the contract is a CONSTRAINT, not a comment: this is the schema half of "a quote must never
-- mint two payable bookings", so a conversion path that sets booking_id and forgets converted_at must
-- be impossible rather than merely discouraged. It holds under the `on delete set null` above —
-- booking_id clears, converted_at stays, and (null, not-null) is legal — which is precisely the
-- direction this column exists to survive.
-- ---------------------------------------------------------------------------
alter table quotes add column if not exists converted_at timestamptz;

alter table quotes drop constraint if exists quote_converted_shape;
alter table quotes add constraint quote_converted_shape
  check (booking_id is null or converted_at is not null);

-- ---------------------------------------------------------------------------
-- 4b) The DENOMINATION is re-checked, exactly as the amount already is.
--
-- api_convert_quote carefully re-derives `total_minor` from the lines and refuses to mint a booking
-- on any drift — and then copies `currency` across untouched, because nothing had ever questioned it.
-- Downstream nothing questions it either: payments_ledger_currency_eur (20260830000000) pins
-- `payments.currency = 'EUR'`, and api_create_payment inserts the payments row from
-- (booking_id, idempotency_key, amount_minor) without ever reading the booking's currency.
--
-- So a quote stored as 'MUR' would be shown "MUR 50000" on the public page, emailed as "MUR 50000",
-- and then charged 500 EUR. Not a failure anyone would see: a silent denomination mismatch on the
-- money path, reached through a column that carried a DEFAULT and no CHECK, i.e. through convention
-- alone. An amount deserves the second look it already gets; the unit it is counted in deserves the
-- same one.
--
-- src/lib/admin/quotes.ts refuses a non-EUR quote in the editor. This is the half that a cast, a raw
-- PostgREST write or a psql session cannot get past.
--
-- WIDEN IT THE DAY A SECOND SETTLEMENT CURRENCY EXISTS — and that day belongs to the LEDGER, not to
-- the quote: relax payments_ledger_currency_eur and teach api_create_payment to read the booking's
-- currency first, then this constraint, in that order. Relaxing this one alone only re-opens the
-- mismatch it was added to close.
--
-- drop-then-add so the whole file stays idempotent: `create table if not exists` above is a no-op on
-- a database that already has the table, so it would never restate the constraint.
-- ---------------------------------------------------------------------------
alter table quotes drop constraint if exists quotes_currency_eur;
alter table quotes add constraint quotes_currency_eur check (currency = 'EUR');

-- ---------------------------------------------------------------------------
-- 5) The two rental foreign keys say what they mean.
--
-- Both were declared with no ON DELETE action, i.e. NO ACTION, i.e. "block the delete" — by accident
-- rather than by intent. deleteRentalVehicle (src/lib/admin/rental.ts) deletes straight from
-- rental_vehicles, so once Part 2 writes rental lines, retiring a vehicle would fail with a raw
-- constraint string on both tables. The two tables want OPPOSITE things:
--
--   * quote_items    — a DRAFT may lose its link. The line keeps its own description, quantity and
--                      price, so it stays complete without the vehicle row -> `on delete set null`.
--   * booking_custom_items — a PAID line must keep naming what was sold -> `on delete restrict`,
--                      declared so the block is a decision, not a leftover. `description` is NOT NULL
--                      precisely so the writer carries the vehicle name into the line and it stays
--                      readable without the join; deleteRentalVehicle translates the 23503 into an
--                      explanation the operator can act on.
--
-- Written as drop-then-add so the whole file stays idempotent: `create table if not exists` above is
-- a no-op on a database that already has these tables, which means it would never restate the FKs.
-- ---------------------------------------------------------------------------
alter table quote_items drop constraint if exists quote_items_rental_vehicle_slug_fkey;
alter table quote_items add constraint quote_items_rental_vehicle_slug_fkey
  foreign key (rental_vehicle_slug) references rental_vehicles (slug) on delete set null;

alter table booking_custom_items drop constraint if exists booking_custom_items_rental_vehicle_slug_fkey;
alter table booking_custom_items add constraint booking_custom_items_rental_vehicle_slug_fkey
  foreign key (rental_vehicle_slug) references rental_vehicles (slug) on delete restrict;

-- ---------------------------------------------------------------------------
-- 6) The existing code has to learn that quotes exist.
--
-- `quote_items.session_occurrence_id` is deliberately NOT `on delete set null` (quote_item_shape
-- requires a catalogue line to keep its occurrence, so that action would only trade a
-- foreign_key_violation for a check_violation) and NOT `on delete cascade` (a quote line must not
-- vanish because someone tidied the calendar). It stays NO ACTION, and so does
-- `activity_option_id` — and because session_occurrences CASCADEs from activity_options
-- (20260615120200), deleting an OPTION reaches quote_items down both foreign keys at once.
--
-- Three callers delete those rows, and each is taught here or in its own file:
--   * stop_availability_atomic          — 6a below (a quoted slot is closed, not deleted);
--   * reconcileOptions (src/lib/admin/activity-write.ts) — keeps a quoted option, like a booked one;
--   * deleteActivity   (src/lib/admin/activity-write.ts) — translates the 23503 for the operator.
-- ---------------------------------------------------------------------------

-- 6a) stop_availability_atomic — a quoted slot is CLOSED, never deleted.
--
-- The original (20260617220000) DELETEs every empty future occurrence, guarded only by "no
-- booking_items, no active booking_holds". A draft quote's catalogue line has neither, so the delete
-- hit the NO ACTION foreign key, the exception aborted the whole SECURITY DEFINER transaction, and
-- admin "stop availability" was dead for any activity that appears on any quote — surfacing as a raw
-- Postgres error in src/lib/admin/availability-write.ts. A quote is a live offer to a guest, so the
-- right answer is the one already used for a booked slot: keep the row, close it.
--
-- Re-applied in FULL from its winning definition with the quote branch added to BOTH halves, so this
-- migration cannot silently revert anything that landed in it since.
create or replace function stop_availability_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null then
    raise exception 'invalid_request';
  end if;

  update activities set daily_capacity = null where id = v_activity_id;

  -- Close future slots with a booking item, an active hold, OR a quote line (never strand a confirmed
  -- booking, a live hold, or an offer already sitting in a guest's inbox).
  update session_occurrences so
     set status = 'closed'
    from activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and (
       exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
       or exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
       or exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id)
     );

  -- Delete empty future slots (no booking, no active hold, no quote line).
  delete from session_occurrences so
   using activity_options o
   where so.activity_option_id = o.id
     and o.activity_id = v_activity_id
     and so.starts_at >= now()
     and not exists (select 1 from booking_items bi where bi.session_occurrence_id = so.id)
     and not exists (select 1 from booking_holds bh where bh.session_occurrence_id = so.id and bh.status = 'active')
     and not exists (select 1 from quote_items qi where qi.session_occurrence_id = so.id);
end;
$$;
-- `from public, anon`, not `from public`. Supabase's stock ALTER DEFAULT PRIVILEGES grants EXECUTE on
-- every new function to anon and authenticated EXPLICITLY — not through PUBLIC — so a revoke naming
-- only PUBLIC leaves anon holding the grant, and CREATE OR REPLACE never resets an existing ACL. That
-- exact one-word omission has shipped a live leak from this repo twice (api_booking_receipt,
-- api_pending_payment_checkouts). is_staff() is this function's first statement so anon could not have
-- got anything out of it, but the ACL is stated correctly at the point of definition all the same.
revoke execute on function stop_availability_atomic(jsonb) from public, anon;
grant execute on function stop_availability_atomic(jsonb) to authenticated, service_role;

-- 6b) api_erase_user — a GDPR erasure has to reach the quotes tables too.
--
-- api_erase_user enumerates its tables by hand and could not know about a module that did not exist
-- when it was written, so customer_name / customer_email / customer_phone — and the free text in
-- internal_notes and quote_items.description, which routinely names the guest — would have survived
-- an Art. 17 request indefinitely, in two brand-new tables.
--
-- The split mirrors bookings exactly:
--   * a quote that never became a booking carries NO retention duty -> hard-deleted, children first;
--   * a CONVERTED quote is the paper behind a real payment -> retained and anonymized in place.
-- `converted_at` is what makes that split survive the hard-delete of an unpaid booking a few
-- statements earlier (which nulls booking_id) — see section 4.
--
-- Scope: quotes carry no user_id (created_by is the STAFF author, not the guest), so they are matched
-- by customer_email only, exactly like `leads`. A staff erase given a userId and no email therefore
-- does not reach them — the same limitation leads has always had, and the account-deletion path
-- always supplies both.
--
-- Re-applied in FULL from its winning definition (20260816000000) so this migration cannot revert the
-- caller-identity binding or the pickup/dropoff nulling that landed there.
create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_anon_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
  v_del_quotes int := 0;
  v_anon_quotes int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) -- broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email -- they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    -- booking_custom_items cascades from bookings, so the quote's non-occurrence lines go with it.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- Snapshot the person's REMAINING booking ids now, before the anonymize below overwrites
  -- customer_email. The unpaid rows are already gone, so this is exactly the retained set; the
  -- outbox/bell/audit scrubs downstream target it by id so an email-only (guest) match is not lost.
  select coalesce(array_agg(id), '{}') into v_anon_ids
    from bookings
   where (v_uid is not null and user_id = v_uid)
      or (v_email is not null and lower(customer_email) = v_email);

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable -> null.
  -- pickup_location / dropoff_location are addresses the customer typed -- PII, and not part of the
  -- retained money trail -- so they are nulled alongside the other traveller fields.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         pickup_location = null,
         dropoff_location = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent -> idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload. Matched by the pre-captured id set.
  update notification_outbox
     set payload = payload - 'customerName'
   where booking_id = any(v_anon_ids);
  -- Staff bell rows (admin_new_booking / admin_refund_pending) embed the customer's name in `body` --
  -- rebuild them anonymously so no feed retains PII after erasure.
  update notifications n
     set body = '(Deleted user) -- booking ' || coalesce(n.data ->> 'ref', '') || '.'
   where n.type in ('admin_new_booking', 'admin_refund_pending')
     and n.data ->> 'bookingId' = any(v_anon_ids::text[]);

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id = any(v_anon_ids);

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- ---- Quotes: the offer the owner drafted for this person ----------------------------------------
  -- A quote that never minted a booking is not a financial record -> delete it and its lines outright
  -- (children first; quote_items cascades, but be explicit, exactly as the bookings block above is).
  -- A CONVERTED quote is retained and stripped instead. Keyed on converted_at, NOT booking_id: the
  -- bookings delete a few statements up nulls booking_id via its `on delete set null` FK.
  if v_email is not null then
    delete from quote_items qi
     using quotes q
     where qi.quote_id = q.id
       and lower(q.customer_email) = v_email
       and q.converted_at is null
       and q.booking_id is null;

    delete from quotes q
     where lower(q.customer_email) = v_email
       and q.converted_at is null
       and q.booking_id is null;
    get diagnostics v_del_quotes = row_count;

    -- Retained (converted) quotes: same redaction as the bookings they minted. internal_notes (staff
    -- free text) and intro_note (the guest-FACING covering note, which opens by addressing the guest
    -- by name) both routinely carry the guest, so they go too. Idempotent via the same
    -- already-anonymized skip.
    update quotes
       set customer_name = '(Deleted user)',
           customer_email = 'deleted@privacy.invalid',
           customer_phone = null,
           intro_note = null,
           internal_notes = null
     where lower(customer_email) = v_email
       and (converted_at is not null or booking_id is not null)
       and customer_name is distinct from '(Deleted user)';
    get diagnostics v_anon_quotes = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s), ' || v_del_quotes || ' quote(s); anonymized ' || v_anon_bookings
      || ' retained booking(s), ' || v_anon_quotes || ' retained quote(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads,
    'deletedQuotes', v_del_quotes,
    'anonymizedQuotes', v_anon_quotes
  );
end;
$$;
-- Stated here rather than inherited: CREATE OR REPLACE keeps whatever ACL the ORIGINAL definition was
-- given, so re-applying a function is the moment to say what its grants are. Same `public, anon` as
-- above — a self-erase is called by the signed-in user, so `authenticated` keeps EXECUTE.
revoke execute on function api_erase_user(jsonb) from public, anon;
grant execute on function api_erase_user(jsonb) to authenticated, service_role;

-- 6c) A retained quote's FREE TEXT — its lines, and its own covering note — is redacted with it.
--
-- The anonymize branch above scrubs customer_name / _email / _phone / intro_note / internal_notes, but
-- the guest's name is just as routinely typed into a line: "Skipper for the Ramdin family, full day".
-- A DELETED quote loses that text with the row; a CONVERTED one is retained forever, which is exactly
-- the case an Art. 17 request is about. The money shape of the line (quantity, unit_amount_minor,
-- subtotal_minor, dates) is the retention duty and is never touched — the same split the bookings half
-- makes when it nulls `notes` and keeps `total_minor`.
--
-- Why a TRIGGER on the parent rather than one more statement inside api_erase_user: the delete half of
-- this relationship is declarative (`on delete cascade`) and no caller can forget it. The anonymize
-- half has no declarative form, so it lives in ONE place attached to the parent row instead of being
-- restated by every path that redacts a quote — including a future migration that re-applies
-- api_erase_user from an older body, which is the migration-revert drift documented in
-- docs/handbook/landmines.md and has already cost this repo a guard once. It cost it a second one
-- here: 20260910000000_late_pickup_addon.sql landed after this file carrying a copy of api_erase_user
-- that predated the intro_note line, and — the last definition wins — that copy was the live one.
-- THAT IS FIXED AT SOURCE: 20260910000000's UPDATE now nulls intro_note itself. This trigger stays
-- anyway, as the belt to those braces and because it is the only thing that reaches the LINE text.
--
-- `'deleted@privacy.invalid'` is the schema's erasure marker, already load-bearing above (it is what
-- makes the anonymize idempotent). SECURITY DEFINER so the redaction cannot be half-applied by a
-- caller whose RLS reaches the quote but not every one of its lines.
create or replace function quotes_redact_lines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `description` is nullable ONLY on a catalogue line; quote_item_shape requires a custom/rental line
  -- to carry one, so those are redacted to a sentinel instead of nulled. The filter makes a re-run a
  -- no-op (0 rows), matching the idempotency of the update that fires it.
  update quote_items
     set description = case when kind = 'catalogue' then null else '(Redacted)' end
   where quote_id = new.id
     and coalesce(description, '') not in ('', '(Redacted)');

  -- …and the parent's own guest-facing free text. `intro_note` is the covering note a staff member
  -- types above the priced lines ("Dear …, here is the private boat day we discussed"), so it names
  -- the guest as reliably as the lines do. api_erase_user's anonymize UPDATE nulls it as well, but
  -- THAT statement is precisely the one a later migration re-applies from an older body — the drift
  -- this trigger was created to be immune to, and which did happen here (20260910000000 landed after
  -- this file with a copy of api_erase_user predating the intro_note line, and won). Its UPDATE has
  -- since been corrected, so this is now belt AND braces rather than the only scrub standing; the
  -- durable place for it is still beside the lines, on the parent. Filtered, so a re-run is 0 rows.
  --
  -- No recursion: the trigger is `after update OF customer_email`, and this statement's target list
  -- is intro_note alone, so it cannot re-fire (and the WHEN clause would reject it regardless).
  update quotes
     set intro_note = null
   where id = new.id
     and intro_note is not null;
  return null;
end;
$$;
-- `authenticated` is named too, and it is the word this repo has now dropped THREE times
-- (api_booking_receipt, api_pending_payment_checkouts, and here): Supabase's default privileges grant
-- EXECUTE to anon AND authenticated explicitly at creation, so `from public, anon` leaves every
-- signed-in account able to POST /rpc/quotes_redact_lines and blank the line text of any quote it can
-- name. It costs the trigger nothing — 20260814000000 established that trigger execution never checks
-- the caller's EXECUTE — so the only caller left is the one that should have it.
revoke execute on function quotes_redact_lines() from public, anon, authenticated;
grant execute on function quotes_redact_lines() to service_role;

drop trigger if exists quotes_redact_lines_on_anonymize on quotes;
create trigger quotes_redact_lines_on_anonymize
  after update of customer_email on quotes
  for each row
  when (new.customer_email = 'deleted@privacy.invalid'
        and old.customer_email is distinct from new.customer_email)
  execute function quotes_redact_lines();

-- ---------------------------------------------------------------------------
-- 6c-bis) quote_email_key — THE ONE DEFINITION OF "THE SAME ADDRESS".
--
-- Two places decide whether an address on a quote is the address on an account: quote_owner_for_email
-- (6d), at conversion, and api_claim_quote_bookings (7c), for the guest who signs up afterwards. They
-- have to normalise IDENTICALLY or the pair produces a booking that matches at payment and can never
-- be claimed again.
--
-- That is not hypothetical. `quotes.customer_email` has no trimming trigger and api_convert_quote
-- copies the column into `bookings.customer_email` verbatim, so an address the operator pasted out of
-- a mail client — ' nina@example.com' — really is what gets stored. The owner match btrimmed its
-- ARGUMENT while the claim compared the booking column with `lower()` alone: the guest paid, their
-- booking was minted, and their later sign-in could never pick it up. Nothing on any screen shows the
-- space, which is exactly what makes that class of bug unreproducible six months later.
--
-- So the rule lives in one function and both sides call it on BOTH operands. Plain (not definer) and
-- left with its default grants, like is_staff(): it reads nothing, touches no table, and hands back a
-- lowercased trim of a string the caller already had — there is nothing here to leak. Its callers are
-- the definers, and the privilege check for their inner calls runs as the owner regardless.
--
-- NULL for an address that is empty or all whitespace, so "no address" can never compare equal to
-- another "no address" — a null propagates through `=` and the match simply fails, which is the
-- answer both callers want.
-- ---------------------------------------------------------------------------
create or replace function quote_email_key(p_email text)
returns text
language sql
immutable
as $$
  select lower(nullif(btrim(p_email), ''));
$$;

comment on function quote_email_key(text) is
  'The one normalisation behind every quote email match: lower(btrim(...)), null for blank. '
  'quote_owner_for_email and api_claim_quote_bookings both apply it to BOTH sides of their compare, '
  'so an address that matched at conversion can never be one a later claim cannot see.';

-- ---------------------------------------------------------------------------
-- 6d) quote_owner_for_email — WHO, IF ANYONE, OWNS A BOOKING MADE FOR THIS ADDRESS.
--
-- Every booking in this schema until now has carried a `user_id`; a quote booking is the first
-- ownerless one, because the guest has no account — that is the entire point of an emailed offer. The
-- bookings policy is `using (user_id = auth.uid() or is_staff())`, and `null = auth.uid()` evaluates to
-- NULL rather than true, so a PAID quote booking with a null user_id is invisible to every customer
-- forever, including the guest who paid for it. /bookings/{ref} — the page the confirmation email's
-- e-voucher button points at — is guarded by that policy.
--
-- The owner's decision is to match by EMAIL: at conversion (below) and, for a guest who signs up
-- afterwards, again at claim time (7c). Both go through this one function so the rule cannot be stated
-- twice and drift, and the rule is deliberately NARROW:
--
--   * CASE-INSENSITIVE AND TRIMMED, through quote_email_key (6c-bis) — on BOTH operands, never just
--     the argument. The operator types or pastes the address into the quote editor by hand, and
--     "Anouk.Leclerc@Example.com" (or " anouk.leclerc@example.com") is the same mailbox as the one
--     the account was opened with. A case-sensitive compare would leave most genuine matches
--     ownerless for no visible reason; normalising one side only would leave the claim path (7c)
--     unable to see a booking this function had already matched.
--   * CONFIRMED ACCOUNTS ONLY (`email_confirmed_at is not null`). This is the whole of the difference
--     between an address someone TYPED and one they have demonstrably received mail at. Without it,
--     signing up with a stranger's address — and never confirming it, which you could not, since the
--     mail goes to them — would be a way to be handed their booking, with its name, phone, pickup
--     address and amount.
--   * EXACTLY ONE MATCH, or none. `auth.users` does not constrain `email` to be unique, and picking
--     "the oldest" of two confirmed accounts on one address would be a coin toss on a money record.
--     Ownerless is already a fully supported state, so ambiguity fails closed into it.
--
-- KNOWN AND ACCEPTED BY THE OWNER: a mistyped address that belongs to a real confirmed account
-- attaches that booking to the wrong person. The same typo already emailed them the offer itself, so
-- the first disclosure happens either way — which is precisely why this must never widen beyond a
-- confirmed, exact (case-insensitive) address.
--
-- SECURITY DEFINER because `auth.users` is not readable by the roles that reach the callers, and
-- service_role-only because it answers "does an account exist at this address?" — an enumeration
-- oracle if anything reachable from a browser could ask it. api_claim_quote_bookings is granted to
-- `authenticated` and calls this; that works because the privilege check for the inner call runs as the
-- (shared) owner of both functions, the same arrangement api_create_payment/create_payment uses.
-- ---------------------------------------------------------------------------
create or replace function quote_owner_for_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := quote_email_key(p_email);
  v_ids uuid[];
begin
  if v_email is null then
    return null;
  end if;

  select array_agg(u.id) into v_ids
    from auth.users u
   where quote_email_key(u.email) = v_email
     and u.email_confirmed_at is not null;

  -- No account, or more than one confirmed account on this address: no answer, not a guess.
  if v_ids is null or array_length(v_ids, 1) <> 1 then
    return null;
  end if;
  return v_ids[1];
end;
$$;
revoke execute on function quote_owner_for_email(text) from public, anon, authenticated;
grant execute on function quote_owner_for_email(text) to service_role;

comment on function quote_owner_for_email(text) is
  'The single CONFIRMED account holding this address, normalised by quote_email_key on both sides — or '
  'null for none, and null '
  'for more than one. The one place the quote-booking owner match is defined; api_convert_quote and '
  'api_claim_quote_bookings both read it so the rule cannot drift into two versions.';

-- ---------------------------------------------------------------------------
-- 7) api_convert_quote — the one step that mints a PAYABLE booking.
--
-- Everything downstream of it is the existing, untouched money path (Peach checkout → HMAC webhook →
-- append_payment_event → confirmation + VAT invoice), so this function is the whole of the new code
-- standing between a staff-drafted offer and a real charge. The rules baked in:
--
--   * "converts once" means ONE PAYABLE BOOKING AT A TIME, not one attempt ever — see the
--     re-arm note below.
--   * `for update` on the quote row, so two guests clicking Pay at the same instant serialise here
--     rather than both reading an unconverted quote and both minting a booking.
--   * a catalogue line TAKES ITS SEAT here, through create_hold and booking_items, in this same
--     transaction — see the hold path below. Capacity that is reserved a round trip later is not
--     reserved: it is a payable booking with nothing behind it.
--   * every refusal raises a repo error TOKEN, never a human sentence. src/lib/services/db-errors.ts
--     matches snake_case tokens on word boundaries; anything else falls through to
--     `console.error('[db] unmapped database error')` + ProviderError, i.e. HTTP 500 "Database
--     error". On the money path that reads as a broken site and invites the retry loop the
--     convert-once guard exists to end, and it floods error_logs with unmapped noise. Each token
--     below has a branch in mapDbError; add them together or the guard is invisible to the guest.
--
-- WHY THE GUARD READS `converted_at`, NEVER `booking_id`: that is the contract stated in section 4.
-- api_erase_user hard-deletes unpaid bookings and the `on delete set null` FK then silently clears
-- booking_id, so a guard on `booking_id is null` would see an erased quote as unconverted and mint a
-- second payable booking. Both columns are written together; quote_converted_shape makes forgetting
-- one impossible, and the UNIQUE on booking_id is the second line of defence.
--
-- WHY CONVERSION IS NOT A ONE-WAY DOOR: the minted booking is `payment_pending`, and
-- run_booking_maintenance expires such a booking 30 minutes after it was created. A guest who
-- converts and then leaves to fetch their card would come back to a booking api_create_payment
-- refuses ('booking_not_payable' on 'expired') attached to a quote this function refused to convert
-- again — payable by nobody, recoverable only by hand-editing production. That is precisely the
-- "cancelled-checkout trap" this repo already fixed once (2026-07-25). So when `converted_at` is
-- set, the linked booking is inspected inside the same `for update`: if it is DEAD, never took a
-- cent, and can no longer take one (expired/cancelled/failed, booking-level payment_state pending or
-- failed, no payments row that settled, refunded, part-settled or is under settlement review, and no
-- Peach session still completable or being minted) the quote re-arms and mints afresh, leaving the
-- dead booking behind as the audit trail. Everything else keeps refusing — including, and
-- deliberately, the case where the linked booking is GONE (booking_id null after an erasure), which
-- is the section-4 invariant and must never be softened into "no booking, so mint one". The money is
-- read under the payments row locks, in append_payment_event's own lock order, so a settlement in
-- flight serialises here rather than being read stale.
--
-- `ref` is deliberately NOT supplied. The column default has been the Peach-safe generator since
-- 20260736000000 ('BMT' + 13 hex, 16 alnum chars, no separator) — and that default has already been
-- changed once, precisely to satisfy Peach's merchantTransactionId limit. Re-deriving the format
-- here would be a second copy that a third change would silently leave behind, on the money path.
--
-- `operator_payout_minor` is set alongside `total_minor` because payout == total is the invariant
-- every other booking-minting path in the repo maintains (the bookings table header states it;
-- 20260805000000 inserts `v_total, v_total, 0`). It is not self-healing either:
-- enforce_booking_admin_update (20260615121600) pins the column for any anon/authenticated write, so
-- a quote booking minted with the 0 default is permanently wrong in the payout report.
--
-- It returns `booking_json(id)` — the camelCase DTO every other booking-returning RPC returns and
-- the shape the service layer and the booking Zod schema parse. `to_jsonb(v_booking)` would return
-- the raw 46-column row AND silently widen this function's output contract every time a column is
-- added to `bookings`, which for a service_role-only function on the money path is a contract that
-- changes with nobody editing it.
--
-- No in-function caller guard by design: like every other server-only api_* function here, the
-- EXECUTE grant IS the authorization, which is why the revoke below names anon and authenticated
-- explicitly and not just PUBLIC (see the note in 6a — that one-word omission has shipped a live
-- leak from this repo twice).
-- ---------------------------------------------------------------------------
create or replace function api_convert_quote(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_prior bookings;
  v_booking bookings;
  v_reusable boolean := false;
  v_lines_minor bigint;
  v_owner uuid;
  v_seats record;
  v_hold booking_holds;
begin
  select * into v_quote
    from quotes
   where id = nullif(p ->> 'quoteId', '')::uuid
   for update;

  if v_quote.id is null then
    raise exception 'quote_not_found';
  end if;

  -- Convert-once, read off converted_at, and meaning "one PAYABLE booking at a time" (see above).
  if v_quote.converted_at is not null then
    -- LOCK THE MONEY BEFORE JUDGING IT. append_payment_event locks the payments row, writes paid_minor
    -- and status onto it, and only THEN rolls the projection onto bookings — so an unlocked read of
    -- either table can catch a settlement mid-flight, conclude "this booking never took a cent", mint
    -- booking B, commit, and let the settlement land on A afterwards. Taking the payments locks in the
    -- same order that function does serialises the two instead of racing them.
    --
    -- `bookings` is deliberately NOT locked here as well: api_create_payment locks bookings and then
    -- payments, so adding payments -> bookings on this side would close a deadlock cycle on the money
    -- path. It is also unnecessary — read committed gives every later statement in this function a
    -- fresh snapshot, so once the payments locks are held the reads below see post-settlement state.
    -- A booking with no payments row locks nothing, which is safe: api_create_payment refuses a dead
    -- booking ('booking_not_payable'), so no first payment can appear on one.
    perform 1 from payments where booking_id = v_quote.booking_id for update;

    -- booking_id is null here when an erasure hard-deleted the booking; the select finds nothing and
    -- v_reusable stays false, which is the section-4 invariant.
    select * into v_prior from bookings where id = v_quote.booking_id;
    v_reusable := found
      and v_prior.status in ('expired', 'cancelled', 'failed')
      and v_prior.payment_state in ('pending', 'failed')
      -- Money already HELD, including the shapes the booking-level projection above cannot see: an
      -- underpayment (append_payment_event sets 'pending' when v_paid > 0 but below amount_minor, so
      -- paid_minor is positive while payment_state is not) and a wrong-currency settlement quarantine
      -- (settlement_review_at, 20260830000000), which is stamped precisely so the projection is left
      -- alone. Both hold a capture on a booking that still reads clean.
      and not exists (
        select 1 from payments pay
         where pay.booking_id = v_prior.id
           and (pay.paid_minor > 0
                or pay.refunded_minor > 0
                or pay.status in ('paid', 'partially_refunded', 'refunded')
                or pay.settlement_review_at is not null)
      )
      -- Money that can still be TAKEN. A dead booking is not a dead checkout: run_booking_maintenance
      -- expires a booking 30 minutes after it was CREATED, while a Peach session stays completable
      -- ~30 minutes after it was MINTED (api_pending_payment_checkouts says exactly that in its own
      -- comment). A guest who converts at T0, clicks Pay at T0+26 and wanders off has an expired
      -- booking at T0+30 and a live session until roughly T0+56; re-arming in that gap leaves TWO
      -- payable sessions for one quote — the double charge api_create_payment's reuse guard refuses
      -- to create one level down ("Minting a replacement while the original is still live would leave
      -- TWO payable sessions for one booking") and the one 20260902000000 removed. It is also
      -- unreconcilable: api_pending_payment_checkouts only re-queries bookings still in
      -- 'payment_pending', so once the booking is expired a lost webhook on that capture is never
      -- swept — money taken, no ledger row, no link back to the quote.
      --
      -- 30 minutes, not api_create_payment's 25: 25 is the REUSE window, deliberately short of the
      -- session's life so a session handed back cannot die under the guest. The hazard here lasts as
      -- long as the session can be COMPLETED, so this window has to be the wider of the two.
      --
      -- The claimed-lease arm covers the ~90 seconds where a caller is out at Peach and the session
      -- id has not been recorded yet: provider_checkout_id is still null, so freshness alone sees
      -- nothing and would re-arm into the same double charge moments before the session appears.
      --
      -- The refusal is a wait, not a wall: mapDbError already reads quote_already_converted as "has
      -- already been paid for or is being paid", and the quote converts again once the session dies.
      and not exists (
        select 1 from payments pay
         where pay.booking_id = v_prior.id
           and ((pay.provider_checkout_id is not null
                 and coalesce(pay.checkout_created_at, pay.updated_at) > now() - interval '30 minutes')
                or (pay.checkout_claimed_until is not null and pay.checkout_claimed_until > now()))
      );
    if not v_reusable then
      raise exception 'quote_already_converted'
        using detail = coalesce(v_prior.status::text, 'linked booking no longer exists');
    end if;

    -- THE DEAD BOOKING'S SEATS GO BACK BEFORE THIS CONVERSION TAKES FRESH ONES.
    --
    -- Re-arming mints a SECOND booking, which takes its own holds below — so unless the first
    -- booking's holds are released here, one quote reserves two sets of seats for the rest of their
    -- 30-minute life. Nothing else does it: run_booking_maintenance releases holds only for the
    -- bookings IT expired, so a hand-cancelled booking (or one already swept while its hold ran on)
    -- keeps them. On a nearly-full departure that is the guest's own abandoned attempt selling the
    -- trip out from under them — create_hold would raise `insufficient_capacity` and the quote would
    -- read as sold out to the only person entitled to those seats.
    --
    -- Safe because of what the branch above has already established: this booking is dead
    -- (expired/cancelled/failed), never took a cent, and cannot take one.
    update booking_holds set status = 'released'
     where booking_id = v_prior.id and status = 'active';
  end if;

  -- Status: an explicit WHITELIST, the shape api_create_payment uses next door. A blacklist of one
  -- let a 'draft' (a half-built offer the owner has not sent, whose total may be mid-edit) and an
  -- 'expired' quote — a terminal state of the very enum this migration created — both convert.
  -- 'accepted' is in the list because that is what a converted quote's status already is, and the
  -- re-arm branch above has to be able to get past here.
  if v_quote.status = 'cancelled' then
    raise exception 'quote_cancelled';
  end if;
  if v_quote.status = 'expired' or v_quote.valid_until < current_date then
    raise exception 'quote_expired';
  end if;
  if v_quote.status not in ('sent', 'accepted') then
    raise exception 'quote_not_convertible' using detail = v_quote.status::text;
  end if;

  -- A zero-total quote mints a booking that can NEVER confirm: api_create_payment skips the FX pin
  -- for a zero amount, and append_payment_event carries an explicit guard whose own comment says "a
  -- zero-amount payment must never read as fully paid (0 >= 0)". The booking would sit in
  -- payment_pending until the sweep expired it. quotes.total_minor DEFAULTS to 0, so an empty or
  -- never-priced draft reaches this state by default rather than by accident.
  if coalesce(v_quote.total_minor, 0) <= 0 then
    raise exception 'quote_not_convertible' using detail = 'zero total';
  end if;

  -- THE TWO CATALOGUE LINES THIS FUNCTION WILL NOT PRICE INTO A SEAT. Both fail closed here, before
  -- anything is minted, because both are shapes whose capacity meaning cannot be read off the line.
  --
  -- 1. AN OPTION THAT IS NOT COUNTED IN PEOPLE. For a private or vehicle option one BOOKING is one
  --    unit of the pool — the pool counts trips, not heads (20260908000000), and create_booking
  --    records the real party size in booking_items.pax while writing quantity 1. A quote line for
  --    six guests would therefore reserve SIX DEPARTURES if it were held like a per-person line, and
  --    reserve one while charging for six if it were not. Neither is a guess worth making on the
  --    money path: there is no editor that can draft such a line yet, and the pay route's re-price
  --    gate refuses it one step earlier anyway (a private option has no activity_option_prices row
  --    to re-price against). The day the editor learns to quote a private charter, this is the
  --    branch that teaches the conversion the trips-vs-heads mapping — deliberately, with a test.
  --
  -- 2. AN OPTION THAT IS NOT THE OCCURRENCE'S OWN. `quote_item_shape` makes a catalogue line name
  --    both, and nothing checks they agree; a mismatch would write a booking_items row whose option
  --    contradicts its occurrence, i.e. a voucher and a day sheet naming a trip the guest is not on.
  --
  -- Both reuse `quote_not_convertible` rather than minting a token of their own: mapDbError already
  -- reads it as "This quote is not ready to pay yet — please message us", which is exactly true, and
  -- an unfinished offer is the operator's to fix.
  if exists (
    select 1
      from quote_items qi
      join activity_options o on o.id = qi.activity_option_id
      join activities a on a.id = o.activity_id
     where qi.quote_id = v_quote.id
       and qi.kind = 'catalogue'
       and (o.private_base_minor is not null
            or coalesce(a.pricing_mode::text, 'per_person') in ('vehicle', 'vehicle_custom'))
  ) then
    raise exception 'quote_not_convertible' using detail = 'private/vehicle catalogue line';
  end if;
  if exists (
    select 1
      from quote_items qi
      join session_occurrences so on so.id = qi.session_occurrence_id
     where qi.quote_id = v_quote.id
       and qi.kind = 'catalogue'
       and qi.activity_option_id is distinct from so.activity_option_id
  ) then
    raise exception 'quote_not_convertible' using detail = 'catalogue line option is not its occurrence''s';
  end if;

  -- THE CHARGE AND THE ITEMISATION MUST AGREE, or nothing is minted.
  --
  -- The amount charged is copied from quotes.total_minor while the lines are copied by the separate
  -- statement below, and nothing else ties the two together: total_minor carries no CHECK against its
  -- lines and no trigger recomputing it, and the editor writes the total in a different statement from
  -- the lines. src/lib/quotes/totals.ts states in its own header that there is no Zod layer above it
  -- yet and that its guards "ARE the only validation between a browser-supplied line and
  -- quotes.total_minor" — so this function is the last gate before a card is charged, and failing OPEN
  -- on the drift charges the guest a figure the itemisation does not support and renders a VAT
  -- invoice whose lines do not sum to the charge.
  --
  -- The sum is over ALL lines, of every kind: the custom ones are copied into booking_custom_items
  -- below and the catalogue ones take the hold path into booking_items, so every line reaches the
  -- booking and every line was priced into the total the guest agreed to.
  --
  -- It subsumes the zero-lines case too — a hand-set total with no itemisation at all would otherwise
  -- mint a booking with no lines and a booking_json carrying no items: charged for something with no
  -- record of what it was.
  select coalesce(sum(qi.subtotal_minor), 0) into v_lines_minor
    from quote_items qi
   where qi.quote_id = v_quote.id;
  if v_quote.total_minor <> v_lines_minor then
    raise exception 'quote_total_mismatch'
      using detail = format('total %s vs lines %s', v_quote.total_minor, v_lines_minor);
  end if;

  -- WHO WILL BE ABLE TO SEE THIS BOOKING. `user_id` is what the bookings RLS policy reads
  -- (`user_id = auth.uid() or is_staff()`), so a booking minted with a null one is invisible to every
  -- customer — including the guest about to pay for it, whose confirmation email links to
  -- /bookings/{ref}. quote_owner_for_email (section 6d) answers with the single CONFIRMED account
  -- holding the quoted address, or null; see its header for why that rule is exactly this narrow.
  --
  -- NULL IS A SUPPORTED ANSWER, NOT A FAILURE. Most quote guests never open an account, and nothing
  -- downstream requires an owner: api_create_quote_payment (20260911000000) exists precisely because a
  -- quote booking has none, the guest's own record stays reachable through the link token, and
  -- api_claim_quote_bookings (7c) fills the column in later if they ever do sign up.
  v_owner := quote_owner_for_email(v_quote.customer_email);

  insert into bookings (
    user_id, customer_name, customer_email, customer_phone, status, source,
    currency, total_minor, operator_payout_minor, payment_state, locale
  )
  values (
    v_owner, v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, 'payment_pending',
    'quote', v_quote.currency, v_quote.total_minor, v_quote.total_minor, 'pending', v_quote.locale
  )
  returning * into v_booking;

  -- The `kind <> 'catalogue'` filter is what keeps this statement and the hold path below from both
  -- claiming the same line: booking_custom_items carries `check (kind <> 'catalogue')`, and a
  -- catalogue line belongs in booking_items, where it can be counted against a departure.
  insert into booking_custom_items (
    booking_id, position, kind, description, starts_at, ends_at,
    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor
  )
  select v_booking.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind <> 'catalogue';

  -- ── THE CATALOGUE LINES TAKE THEIR SEATS, HERE, IN THIS TRANSACTION ─────────────────────────
  --
  -- A catalogue line names a session_occurrence, so unlike a custom line it is a place on a real
  -- departure. It is only actually reserved if it is reserved the way every other booking reserves
  -- one: create_hold — the universal gate, which api_create_hold and api_book both delegate their
  -- hold INSERT to — takes `select … for update` on the occurrence, re-reads used_capacity() under
  -- that lock and refuses an oversell; and the booking_items row is what used_capacity() counts once
  -- the booking confirms, what append_payment_event's oversell re-check reads before it confirms
  -- anything, and what puts the guest on the day sheet. Re-deriving either here would be a second,
  -- quieter definition of "a seat exists" on the money path.
  --
  -- WHY IT IS IN THIS FUNCTION AND NOT IN THE PAY ROUTE (which is where the plan first put it): a
  -- route does it in a SECOND transaction, so a hold that fails leaves a converted quote and a
  -- payable booking with no seat behind it — the guest pays for a place nobody reserved, which is
  -- the precise state the placeholder guard this replaces existed to prevent, now reached by a
  -- different road. In here, a refusal takes the booking, its custom lines and `converted_at` back
  -- with it, and the guest sees a refusal instead of a charge.
  --
  -- UNITS, NOT PEOPLE. used_capacity() sums booking_holds.quantity and booking_items.quantity, and
  -- append_payment_event re-checks this booking's own booking_items sum against the occurrence's
  -- capacity — so the hold's quantity must equal the quantities of the lines it covers, or the seat
  -- count drifts the moment the payment lands. Lines that share an occurrence are aggregated into
  -- ONE hold for exactly that reason (two 'Adult' and 'Child' lines on one boat are three seats on
  -- one trip, not two reservations).
  --
  -- The idempotency key is scoped to THIS booking, so a re-arm (a fresh booking for the same quote)
  -- takes fresh holds rather than being handed create_hold's idempotent replay of a released one.
  --
  -- WHAT IS DELIBERATELY *NOT* RE-USED FROM THE CHECKOUT: create_booking's per-booking guests-per-trip
  -- cap (20260908000000). That cap exists because a self-serve guest cannot know the day's pool is
  -- several departures — "the boat only seats so many, however big the day's pool is" — and it is
  -- enforced per BOOKING, so one quote line could never express "twenty guests, two boats" with it in
  -- the way. The operator drafting this quote chose the departure and the party size, and the POOL is
  -- still enforced by create_hold, so no other guest can be oversold; what a big party costs is two
  -- boats' worth of units out of the day, which is what it consumes. Revisit this the day quotes are
  -- drafted by anyone but staff.
  for v_seats in
    select qi.session_occurrence_id as occurrence_id, sum(qi.quantity)::int as units
      from quote_items qi
     where qi.quote_id = v_quote.id and qi.kind = 'catalogue'
     group by qi.session_occurrence_id
  loop
    begin
      v_hold := create_hold(
        v_seats.occurrence_id, v_seats.units,
        'quote:' || v_booking.id::text || ':' || v_seats.occurrence_id::text
      );
    exception when raise_exception then
      -- create_hold refuses in the CHECKOUT's vocabulary — insufficient_capacity,
      -- occurrence_not_bookable, occurrence_in_past, occurrence_too_soon — and mapDbError turns those
      -- into "Not enough availability for this selection" or the bare "Invalid booking request",
      -- neither of which tells a quote guest anything they can act on: they cannot pick another date,
      -- because the date was arranged for them. One token for all of them, carrying the real reason in
      -- DETAIL for error_logs, and mapped to a sold-out 409 that says to message us.
      raise exception 'quote_seats_unavailable'
        using detail = format('occurrence %s x%s: %s', v_seats.occurrence_id, v_seats.units, sqlerrm);
    end;

    -- ATTACH THE HOLD TO THE BOOKING. Not tidiness: append_payment_event's oversell re-check counts
    -- every active hold that is NOT this booking's own against it, so a detached hold is the guest's
    -- own reservation blocking their own confirmation and routing a good payment to refund_pending.
    -- It is also what makes the confirmation mark it 'consumed' rather than leaving it to lapse.
    update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  end loop;

  -- One row per LINE (the hold above is one row per occurrence): the tiers are what the voucher, the
  -- day sheet and the VAT invoice itemise. Prices are the quote's own — the negotiated figure the
  -- guest saw and `quote_total_mismatch` has just re-checked — never re-derived from the catalogue
  -- here; the pay route compares them against the live price list and refuses on drift before this
  -- function is ever called. `price_label` is NOT NULL on booking_items, so a line that carries no
  -- tier name falls back to its description rather than failing at the constraint.
  insert into booking_items (
    booking_id, session_occurrence_id, activity_option_id, price_label,
    quantity, unit_amount_minor, subtotal_minor
  )
  select v_booking.id, qi.session_occurrence_id, qi.activity_option_id,
         coalesce(nullif(btrim(qi.price_label), ''), nullif(btrim(qi.description), ''), 'Quoted place'),
         qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind = 'catalogue'
   order by qi.position;

  -- Overwrites booking_id on a re-arm, which releases the dead booking from the UNIQUE.
  update quotes
     set booking_id = v_booking.id,
         converted_at = now(),
         status = 'accepted',
         updated_at = now()
   where id = v_quote.id;

  return booking_json(v_booking.id);
end;
$$;
revoke execute on function api_convert_quote(jsonb) from public, anon, authenticated;
grant execute on function api_convert_quote(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7c) api_claim_quote_bookings — the guest who signs up AFTER paying.
--
-- The other half of section 6d. At conversion there may simply be no account yet: the guest reads an
-- emailed offer and pays it, and only weeks later — booking their next trip — do they register. Their
-- paid booking is sitting there with a null `user_id`, which the bookings policy can never match, so
-- "My trips" would be empty and /bookings/{ref} would 404 the person who paid. This is what fills the
-- column in, and the app calls it once per sign-in (AuthProvider, right after the profile row is
-- ensured).
--
-- FOUR PROPERTIES, and each one is a hole if it is dropped:
--
--   1. THE CLAIMER'S OWN ADDRESS, read from `auth.users` by `auth.uid()` — never anything in `p`. The
--      function takes a jsonb argument only because every api_* RPC in this schema does; nothing in it
--      is read. A caller-supplied address is untrusted input, and matching on one would let any
--      signed-in account name a stranger's address and be handed that stranger's booking.
--      api_erase_user closed the identical hole by forcing its email scope to the caller's own JWT
--      identity.
--   2. CONFIRMED ONLY, and via the SAME function conversion uses. Rather than restating
--      `email_confirmed_at is not null` here — a second copy of the rule, free to drift from the first
--      — the claimer's own address is put through quote_owner_for_email and the answer must come back
--      as the caller themselves. An unconfirmed account resolves to null and matches nobody; an address
--      shared by two confirmed accounts resolves to null and neither of them can claim it.
--   3. NULL -> A USER ONLY, NEVER USER A -> USER B. `b.user_id is null` is part of the WHERE, so a
--      booking that already has an owner is untouchable here. Without it, a quote whose address was
--      later re-registered — or simply mistyped onto a real account — would silently transfer someone
--      else's paid booking away from them.
--   4. QUOTE BOOKINGS ONLY. `source = 'quote'` is written by api_convert_quote and by nothing else
--      (enforce_booking_admin_update pins the column against any browser write), so this cannot grow
--      into a general "claim any booking that carries my address" mechanism — which would be a far
--      wider blast radius than the one case the owner decided on.
--   5. THE SAME NORMALISATION AS CONVERSION, on both operands, through quote_email_key (6c-bis). This
--      one is not a hole but a dead end: an address the owner match trimmed into a hit was a booking a
--      `lower()`-only claim could never see again, so the guest who paid was locked out of their own
--      record by a space nothing on screen displays.
--
-- IDEMPOTENT by construction: the second run finds no null-owner rows left and updates none, which is
-- what makes it safe to fire on every sign-in.
--
-- SECURITY DEFINER is load-bearing twice over: `authenticated` deliberately has no EXECUTE on
-- quote_owner_for_email, and enforce_booking_admin_update pins `new.user_id := old.user_id` for any
-- write whose `current_user` is anon or authenticated — so the same UPDATE run through PostgREST would
-- be silently reverted by the trigger rather than refused.
-- ---------------------------------------------------------------------------
create or replace function api_claim_quote_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_claimed int := 0;
begin
  -- No identity, nothing to claim FOR. service_role holds EXECUTE (it is an ordinary server-callable
  -- RPC) but has no auth.uid(), and a claim that matched on nothing would be a mass re-assignment.
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select quote_email_key(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return jsonb_build_object('claimed', 0);
  end if;

  -- Property 2: the SAME rule conversion applies, asked in the same place. Unconfirmed or ambiguous
  -- comes back as null (or as somebody else), and this is where both stop.
  if quote_owner_for_email(v_email) is distinct from v_uid then
    return jsonb_build_object('claimed', 0);
  end if;

  -- Property 3, and the reason it is in the WHERE rather than in a caller: `user_id is null` makes an
  -- already-owned booking unreachable from here, so this can only ever fill an empty column. Property
  -- 4 is the `source` filter — a claim must never grow into "any booking carrying my address".
  -- quote_email_key on the BOOKING column too, not `lower()` alone. api_convert_quote copies
  -- `quotes.customer_email` into this column verbatim, so a pasted ' nina@example.com' is stored with
  -- its space — and matching it against a key that has been trimmed would make the one address
  -- conversion DID match unclaimable forever. Section 6c-bis is the whole of that story.
  update bookings b
     set user_id = v_uid
   where b.source = 'quote'
     and b.user_id is null
     and quote_email_key(b.customer_email) = v_email;
  get diagnostics v_claimed = row_count;

  return jsonb_build_object('claimed', v_claimed);
end;
$$;
-- `authenticated` KEEPS execute — the signed-in guest is the only real caller. anon is named
-- explicitly alongside public because Supabase's stock ALTER DEFAULT PRIVILEGES grants EXECUTE on
-- every new function to anon AND authenticated directly, so `from public` alone strips neither; that
-- one-word omission has shipped a live hole from this repo three times.
revoke execute on function api_claim_quote_bookings(jsonb) from public, anon;
grant execute on function api_claim_quote_bookings(jsonb) to authenticated, service_role;

comment on function api_claim_quote_bookings(jsonb) is
  'Attaches the caller''s previously ownerless QUOTE bookings to their account, matched on their own '
  'CONFIRMED address (quote_owner_for_email) and never on anything in the payload. Only ever fills a '
  'null user_id — it can never move a booking from one account to another — and is idempotent, so the '
  'app fires it once per sign-in.';

-- ---------------------------------------------------------------------------
-- 7b) api_booking_receipt — the VAT invoice has to see the lines a quote booking actually has.
--
-- api_convert_quote mints a booking whose every line lives in `booking_custom_items`; by
-- construction such a booking has ZERO booking_items. api_booking_receipt builds its `items` array
-- out of booking_json, which reads `from booking_items bi` and nothing else — so the receipt DTO
-- reached buildInvoice (src/lib/invoice/model.ts) with `items: []`.
--
-- That is not a cosmetic gap, it is a WRONG TAX DOCUMENT. buildInvoice backs the 15% out of the
-- gross PER LINE and sums: with no lines, `subtotalNetEur` is 0 and
-- `vatAmountEur = round2(totalGrossEur - 0)` becomes the entire charge. The guest is emailed an
-- invoice stating that a EUR 500 order was EUR 500 of VAT, with nothing itemised beneath it — and
-- the confirmation email, the invoice PDF and the voucher all render off that same model.
--
-- THE FIX is to union the custom lines into the items array the receipt already returns:
--   * `priceLabel` <- `description`. A custom line has no price label (it is not a catalogue price
--     band) and `booking_custom_items.description` is NOT NULL precisely so the line stays readable
--     on its own; receiptSchema types priceLabel as a required string, so this is the field it maps
--     to. buildInvoice then renders "<activityTitle> — <priceLabel>", or just the label when the
--     booking has no activity behind it, which a quote booking does not.
--   * `quantity` verbatim, and `pax` explicitly null — a custom line is priced per LINE, not per
--     person, and buildInvoice reads `pax ?? quantity`, so null is what makes it use the quantity.
--   * `subtotalEur` <- `subtotal_minor / 100.0`, the same minor->major conversion booking_json does
--     for booking_items. `unitAmountEur` rides along so the two item shapes stay identical.
-- Ordered by `position`, and APPENDED AFTER any booking_items rows: buildInvoice's own header notes
-- that voucher-pdf.ts reads `lines[0].quantity` positionally for its pax count, so the catalogue
-- lines must stay first for the day the hold path lands and a booking carries both kinds.
--
-- The arithmetic then needs no special case: api_convert_quote already refuses to mint unless
-- `total_minor` equals the sum of the lines, so the lines reconcile to `totalEur` by construction
-- and the net/VAT split is the identical rule every other booking gets.
--
-- Re-applied in FULL from its winning definition (20260901000300_booking_locale.sql) so this
-- migration cannot silently revert the `customerPhone` (20260826000000) or `locale` fields that
-- landed there.
--
-- ORDERING — THIS DEFINITION IS NOT THE LIVE ONE, AND DOES NOT NEED TO BE. The rule in this repo is
-- "the LAST migration to define a function wins", and 20260910000000_late_pickup_addon.sql defines
-- api_booking_receipt after this file — so on any database built from the whole directory (and on
-- catch-up.sql / setup.sql, which concatenate in the same order) THAT body is the one that runs.
-- It originally predated this union and threw it away, which is the migration-revert drift in
-- docs/handbook/landmines.md; it now carries the union itself, merged with its own `purpose` scoping
-- and supplement fold-in. This copy is kept because it is CORRECT AS OF THIS POINT IN HISTORY: a
-- database replayed only this far still invoices a quote with its lines, and deleting it would make
-- the file's own section 7b describe a fix it no longer performs. Do not "simplify" by dropping
-- either copy — drop the LATER one and the bug is back.
-- tests/integration/resolved-function-bodies.test.ts asserts on pg_proc.prosrc which body won.
-- ---------------------------------------------------------------------------
create or replace function api_booking_receipt(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_booking_id uuid := nullif(p ->> 'bookingId', '')::uuid;
  v_base jsonb;
  v_title text;
  v_when timestamptz;
  v_payment jsonb;
  v_phone text;
  v_locale text;
  v_custom jsonb;
begin
  if v_booking_id is null then
    raise exception 'invalid_request' using detail = 'booking_receipt: bookingId required';
  end if;

  v_base := booking_json(v_booking_id);
  if v_base is null then
    return null;
  end if;

  -- Primary activity title + the earliest trip date, joined off the booking's items.
  select a.title, o.starts_at
    into v_title, v_when
    from booking_items bi
    join session_occurrences o on o.id = bi.session_occurrence_id
    join activity_options ao on ao.id = bi.activity_option_id
    join activities a on a.id = ao.activity_id
   where bi.booking_id = v_booking_id
   order by o.starts_at asc, bi.created_at asc
   limit 1;

  -- The booking's most recent payment, with the real charge (or the EUR ledger fallback), the paid
  -- timestamp (first 'paid' event) and the provider event ref.
  select jsonb_build_object(
           'chargedAmountMinor', coalesce(pay.charged_amount_minor, pay.amount_minor),
           'chargedCurrency', coalesce(pay.charged_currency, pay.currency),
           'paidAt', paid.occurred_at,
           'providerRef', paid.provider_event_id
         )
    into v_payment
    from payments pay
    left join lateral (
      select pe.occurred_at, pe.provider_event_id
        from payment_events pe
       where pe.payment_id = pay.id and pe.type in ('paid', 'captured')
       order by pe.occurred_at asc
       limit 1
    ) paid on true
   where pay.booking_id = v_booking_id
   order by pay.created_at desc
   limit 1;

  -- The guest's stored booking locale (Task 15): the notification drain runs off-request (cron), so
  -- this is the only correct source for which language the confirmation email + PDFs render in.
  select b.customer_phone, b.locale::text into v_phone, v_locale from bookings b where b.id = v_booking_id;

  -- ADDITION 1 of 2 — the priced lines that have no session_occurrence: a converted quote's lines
  -- today, rentals in Part 2. Empty (and therefore free) for every booking that has none.
  select coalesce(jsonb_agg(jsonb_build_object(
           'priceLabel', ci.description,
           'quantity', ci.quantity,
           'pax', null::int,
           'unitAmountEur', ci.unit_amount_minor::float / 100,
           'subtotalEur', ci.subtotal_minor::float / 100
         ) order by ci.position), '[]'::jsonb)
    into v_custom
    from booking_custom_items ci
   where ci.booking_id = v_booking_id;

  -- ADDITION 2 of 2 — appended AFTER booking_json's own items, never merged into them.
  return v_base
    || jsonb_build_object('items', coalesce(v_base -> 'items', '[]'::jsonb) || v_custom)
    || jsonb_build_object('activityTitle', v_title, 'when', v_when)
    || jsonb_build_object('payment', coalesce(v_payment, 'null'::jsonb))
    || jsonb_build_object('customerPhone', v_phone)
    || jsonb_build_object('locale', v_locale);
end;
$$;
-- Stated at the point of definition, and naming anon + authenticated rather than PUBLIC alone:
-- Supabase's stock ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function to those two roles
-- EXPLICITLY, CREATE OR REPLACE never resets an existing ACL, and this exact function is one of the
-- two that shipped a live leak from this repo for that reason (closed by 20260818000000).
revoke execute on function api_booking_receipt(jsonb) from public, anon, authenticated;
grant execute on function api_booking_receipt(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8) RLS + grants. A quote is staff data; the guest never reads it with the anon key — the public
--    page resolves it server-side behind the link token (a later task).
--
--    Kept LAST in the file on purpose: tests/integration/quotes-schema.test.ts re-executes this
--    section verbatim (it slices the file from the first revoke statement to EOF) to make the revoke
--    load-bearing under PGlite. Append new statements ABOVE this section, never below it.
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
