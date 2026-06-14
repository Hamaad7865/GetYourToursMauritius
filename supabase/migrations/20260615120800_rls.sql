-- Row Level Security on every table (deny-by-default) + grants + function execute
-- permissions. Supabase model: broad table grants to anon/authenticated, with RLS
-- doing the real row-level gating. service_role bypasses RLS (webhook/cron/admin).

-- ---------------------------------------------------------------------------
-- Grants (RLS still filters rows for anon/authenticated)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

-- Append-only tables: no UPDATE/DELETE for anyone via the API (inserts go through
-- SECURITY DEFINER RPCs / triggers that run as the table owner).
revoke update, delete on payment_events from anon, authenticated, service_role;
revoke update, delete on audit_logs from anon, authenticated, service_role;

-- Enable RLS everywhere.
alter table operators enable row level security;
alter table profiles enable row level security;
alter table activities enable row level security;
alter table activity_translations enable row level security;
alter table activity_images enable row level security;
alter table activity_options enable row level security;
alter table activity_option_prices enable row level security;
alter table session_occurrences enable row level security;
alter table booking_holds enable row level security;
alter table bookings enable row level security;
alter table booking_items enable row level security;
alter table payments enable row level security;
alter table payment_events enable row level security;
alter table notification_outbox enable row level security;
alter table audit_logs enable row level security;
alter table leads enable row level security;
alter table reviews enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

-- ---------------------------------------------------------------------------
-- Operators — public read, staff manage
-- ---------------------------------------------------------------------------
create policy operators_read on operators for select using (true);
create policy operators_staff on operators for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Profiles — own row, staff see all
-- ---------------------------------------------------------------------------
create policy profiles_select on profiles for select using (id = auth.uid() or is_staff());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_staff()) with check (id = auth.uid() or is_staff());
create policy profiles_staff on profiles for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Catalogue — public reads PUBLISHED only; staff manage everything
-- ---------------------------------------------------------------------------
create policy activities_read on activities for select using (status = 'published' or is_staff());
create policy activities_staff on activities for all using (is_staff()) with check (is_staff());

create policy activity_translations_read on activity_translations for select using (
  exists (select 1 from activities a where a.id = activity_id and (a.status = 'published' or is_staff()))
);
create policy activity_translations_staff on activity_translations for all
  using (is_staff()) with check (is_staff());

create policy activity_images_read on activity_images for select using (
  exists (select 1 from activities a where a.id = activity_id and (a.status = 'published' or is_staff()))
);
create policy activity_images_staff on activity_images for all
  using (is_staff()) with check (is_staff());

create policy activity_options_read on activity_options for select using (
  exists (select 1 from activities a where a.id = activity_id and (a.status = 'published' or is_staff()))
);
create policy activity_options_staff on activity_options for all
  using (is_staff()) with check (is_staff());

create policy aop_read on activity_option_prices for select using (
  exists (
    select 1 from activity_options o
    join activities a on a.id = o.activity_id
    where o.id = activity_option_id and (a.status = 'published' or is_staff())
  )
);
create policy aop_staff on activity_option_prices for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Inventory — public sees occurrences of published activities; staff manage
-- ---------------------------------------------------------------------------
create policy occurrences_read on session_occurrences for select using (
  is_staff() or exists (
    select 1 from activity_options o
    join activities a on a.id = o.activity_id
    where o.id = activity_option_id and a.status = 'published'
  )
);
create policy occurrences_staff on session_occurrences for all using (is_staff()) with check (is_staff());

-- Holds are internal (managed by RPCs); only staff read directly.
create policy holds_staff on booking_holds for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Bookings — customers see/insert their own; staff manage
-- ---------------------------------------------------------------------------
create policy bookings_select on bookings for select using (user_id = auth.uid() or is_staff());
create policy bookings_insert on bookings for insert with check (user_id = auth.uid() or is_staff());
create policy bookings_staff on bookings for all using (is_staff()) with check (is_staff());

create policy booking_items_select on booking_items for select using (
  exists (select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or is_staff()))
);
create policy booking_items_staff on booking_items for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Payments — customer reads own (via booking); writes only via RPC/service_role
-- ---------------------------------------------------------------------------
create policy payments_select on payments for select using (
  is_staff() or exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid())
);
create policy payments_staff on payments for all using (is_staff()) with check (is_staff());

-- payment_events: read own/staff; append-only (no write policies -> denied; inserts via RPC).
create policy payment_events_select on payment_events for select using (
  is_staff() or exists (
    select 1 from payments p join bookings b on b.id = p.booking_id
    where p.id = payment_id and b.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Ops tables
-- ---------------------------------------------------------------------------
create policy outbox_staff on notification_outbox for all using (is_staff()) with check (is_staff());

-- audit_logs: staff read; append-only (inserts via RPC/trigger as owner).
create policy audit_select on audit_logs for select using (is_staff());

-- Leads: anyone may capture a lead; staff read/manage.
create policy leads_insert on leads for insert with check (true);
create policy leads_staff on leads for all using (is_staff()) with check (is_staff());

-- Reviews: public read; authenticated may submit; staff manage.
create policy reviews_read on reviews for select using (true);
create policy reviews_insert on reviews for insert with check (auth.uid() is not null);
create policy reviews_staff on reviews for all using (is_staff()) with check (is_staff());

-- Chat: owner or staff.
create policy chat_sessions_select on chat_sessions for select using (user_id = auth.uid() or is_staff());
create policy chat_sessions_insert on chat_sessions for insert with check (user_id = auth.uid() or user_id is null);
create policy chat_sessions_staff on chat_sessions for all using (is_staff()) with check (is_staff());

create policy chat_messages_select on chat_messages for select using (
  exists (select 1 from chat_sessions s where s.id = session_id and (s.user_id = auth.uid() or is_staff()))
);
create policy chat_messages_staff on chat_messages for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Function execute permissions
-- ---------------------------------------------------------------------------
revoke execute on function append_payment_event(uuid, text, text, int, timestamptz, jsonb) from public;
grant execute on function append_payment_event(uuid, text, text, int, timestamptz, jsonb) to service_role;

revoke execute on function expire_holds() from public;
grant execute on function expire_holds() to service_role;

grant execute on function create_hold(uuid, int, text) to anon, authenticated, service_role;
grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb)
  to anon, authenticated, service_role;
grant execute on function release_hold(uuid) to authenticated, service_role;
