-- Bookings and their line items. `status` is a lifecycle state machine; every
-- transition is recorded in audit_logs. `payment_state` is a CACHED projection of
-- the payment_events ledger (source of truth lives there). Commission is deferred:
-- agency_commission_minor = 0 and operator_payout_minor = total for now; the
-- columns exist so a real split can be switched on without a migration.

create table bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('BMT-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  -- Idempotency anchor for create_booking (client-supplied, server fallback).
  idempotency_key text unique,
  user_id uuid references auth.users (id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  status booking_status not null default 'draft',
  source booking_source not null default 'web',
  currency text not null default 'EUR',
  total_minor int not null default 0 check (total_minor >= 0),
  agency_commission_minor int not null default 0 check (agency_commission_minor >= 0),
  operator_payout_minor int not null default 0 check (operator_payout_minor >= 0),
  payment_state payment_state not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_user_idx on bookings (user_id);
create index bookings_status_idx on bookings (status);
create index bookings_created_idx on bookings (created_at);

create table booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  session_occurrence_id uuid not null references session_occurrences (id) on delete restrict,
  activity_option_id uuid not null references activity_options (id) on delete restrict,
  price_label text not null,
  quantity int not null check (quantity > 0),
  unit_amount_minor int not null check (unit_amount_minor >= 0),
  subtotal_minor int not null check (subtotal_minor >= 0),
  created_at timestamptz not null default now()
);
create index booking_items_booking_idx on booking_items (booking_id);
create index booking_items_occurrence_idx on booking_items (session_occurrence_id);
