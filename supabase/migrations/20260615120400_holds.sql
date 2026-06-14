-- Booking holds: temporary capacity reservations. Created atomically by the
-- create_hold() RPC (SELECT FOR UPDATE on the occurrence). Holds expire after 15
-- minutes; expiry is lazy in the capacity formula (status='active' AND
-- expires_at > now()) and a pg_cron sweeper flips stale ones to 'expired'.

create table booking_holds (
  id uuid primary key default gen_random_uuid(),
  session_occurrence_id uuid not null references session_occurrences (id) on delete cascade,
  booking_id uuid references bookings (id) on delete set null,
  quantity int not null check (quantity > 0),
  status hold_status not null default 'active',
  idempotency_key text not null unique,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);
create index booking_holds_occurrence_idx on booking_holds (session_occurrence_id);
create index booking_holds_active_idx on booking_holds (session_occurrence_id, status, expires_at);
create index booking_holds_booking_idx on booking_holds (booking_id);
