-- Durable, shared cache for Google Places responses (the AI Road Trip Planner's browse + co-pilot),
-- so a given place/search is fetched from the billed Places API roughly once per TTL platform-wide
-- (not once per server instance). Written only by trusted server code via the service-role key; never
-- exposed to anon/authenticated. Entries carry their own expiry (lazy: reads ignore expired rows).
create table if not exists places_cache (
  key        text primary key,
  data       jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists places_cache_expires_idx on places_cache (expires_at);

alter table places_cache enable row level security;
revoke all on places_cache from anon, authenticated;
grant select, insert, update, delete on places_cache to service_role;
