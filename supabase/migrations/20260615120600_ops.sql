-- Operational tables: notification outbox (drained by a worker, never sent inside
-- a booking transaction), audit logs (all admin/operator changes), leads, reviews,
-- and the AI chat session/messages.

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel notification_channel not null,
  recipient text not null,
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  status notification_status not null default 'pending',
  idempotency_key text unique,
  booking_id uuid references bookings (id) on delete set null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_status_idx on notification_outbox (status, created_at);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  diff jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_created_idx on audit_logs (created_at);

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null,
  interest_activity_id uuid references activities (id) on delete set null,
  status lead_status not null default 'new',
  source text not null default 'web',
  created_at timestamptz not null default now()
);
create index leads_status_idx on leads (status);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  author text not null,
  rating int not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now()
);
create index reviews_activity_idx on reviews (activity_id);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  booking_id uuid references bookings (id) on delete set null,
  lead_id uuid references leads (id) on delete set null,
  created_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_session_idx on chat_messages (session_id, created_at);
