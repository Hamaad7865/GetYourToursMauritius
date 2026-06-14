-- Event-sourced payment ledger. `payment_events` is APPEND-ONLY and is the source
-- of truth; `payments` carries the idempotency anchor plus a cached projection
-- (status/paid_minor/refunded_minor) refreshed atomically by the append RPC.
-- Payment confirmation comes ONLY from the verified webhook, never a success page.

create table payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  idempotency_key text not null unique,
  provider text not null default 'peach',
  amount_minor int not null check (amount_minor >= 0),
  currency text not null default 'EUR',
  status payment_state not null default 'pending',
  paid_minor int not null default 0 check (paid_minor >= 0),
  refunded_minor int not null default 0 check (refunded_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_booking_idx on payments (booking_id);

create table payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete cascade,
  type text not null,
  -- Provider's event id for webhook dedupe; null for internal events (e.g. intent).
  provider_event_id text,
  amount_minor int not null default 0,
  -- Provider's own timestamp; the reducer orders by this, not by arrival.
  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Idempotent webhook append: a (payment, provider_event_id) pair lands at most once.
  unique (payment_id, provider_event_id)
);
create index payment_events_payment_idx on payment_events (payment_id, occurred_at);
