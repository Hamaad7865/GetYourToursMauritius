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
-- docs/handbook/landmines.md and has already cost this repo a guard once. It has now cost it a second
-- one: a migration that landed AFTER this file carries a copy of api_erase_user predating the
-- intro_note line, so intro_note is scrubbed here as well and not only in that UPDATE.
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
  -- this trigger was created to be immune to, and which has already happened once here (a migration
  -- landed after this one carrying a copy of api_erase_user that predates the intro_note line). So
  -- the durable place for it is beside the lines, on the parent. Filtered, so a re-run is 0 rows.
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
--   * it FAILS CLOSED on a catalogue line — see the guard below.
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

  -- FAIL CLOSED on a catalogue line, until the hold path exists.
  --
  -- A catalogue line names an occurrence, so it carries capacity and must travel through the
  -- existing hold path into booking_items — that is the pay route's job, in a later task. Copying
  -- `total_minor` whole while dropping the line would charge the guest for a seat nobody reserved,
  -- with no voucher line and no day-sheet entry; and append_payment_event's oversell re-check loops
  -- `select distinct session_occurrence_id from booking_items where booking_id = …`, which would be
  -- EMPTY, so the booking would confirm unconditionally. converted_at would then lock the quote, so
  -- the lines could never be attached by a second call either. A comment saying "that is the pay
  -- route's job" is not a guard.
  --
  -- DELETE THIS GUARD IN THE TASK THAT ADDS THE HOLD PATH, not before.
  if exists (
    select 1 from quote_items qi where qi.quote_id = v_quote.id and qi.kind = 'catalogue'
  ) then
    raise exception 'quote_has_catalogue_lines';
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
  -- The sum is over ALL lines, not just the ones copied below: the catalogue guard above already
  -- guarantees every line reaches the booking, and when that guard is lifted the catalogue lines will
  -- travel through the hold path and must still be part of the total they were priced into.
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

  insert into bookings (
    customer_name, customer_email, customer_phone, status, source,
    currency, total_minor, operator_payout_minor, payment_state, locale
  )
  values (
    v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, 'payment_pending', 'quote',
    v_quote.currency, v_quote.total_minor, v_quote.total_minor, 'pending', v_quote.locale
  )
  returning * into v_booking;

  -- The `kind <> 'catalogue'` filter is redundant after the guard above and stays deliberately:
  -- booking_custom_items has a `check (kind <> 'catalogue')`, so this select is what keeps the two
  -- statements agreeing when the guard is lifted and catalogue lines start taking the hold path.
  insert into booking_custom_items (
    booking_id, position, kind, description, starts_at, ends_at,
    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor
  )
  select v_booking.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind <> 'catalogue';

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
