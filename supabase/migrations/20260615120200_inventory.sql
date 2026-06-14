-- Concrete bookable inventory. A session_occurrence is a single dated/timed
-- departure of an activity_option with a fixed capacity. Availability is COMPUTED
-- from this capacity minus confirmed booking_items minus active holds — never
-- stored as a decrementing counter.

create table session_occurrences (
  id uuid primary key default gen_random_uuid(),
  activity_option_id uuid not null references activity_options (id) on delete cascade,
  operator_id uuid not null references operators (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity >= 0),
  status occurrence_status not null default 'open',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index session_occurrences_option_idx on session_occurrences (activity_option_id);
create index session_occurrences_starts_idx on session_occurrences (starts_at);
create index session_occurrences_operator_idx on session_occurrences (operator_id);
