-- Guest checkout: SCHEMA ONLY. A visitor books and pays with a Supabase anonymous sign-in instead of
-- an account. Every rule (the caps, moving a booking between guest sessions, claiming paid bookings
-- by confirmed email, the signed manage link, the purge of unused anonymous users) is TypeScript, in
-- src/lib/services/guest.ts. api_book, create_payment and append_payment_event are untouched: the
-- anonymous user OWNS the booking, so the existing owner checks already do the right thing.
--
-- Spec: docs/superpowers/specs/2026-10-29-guest-checkout-design.md
--
-- SHIPS SWITCHED OFF. Nothing changes for visitors until the owner sets
--     update business_settings set guest_checkout_enabled_at = now();
-- Turn it off again with `... set guest_checkout_enabled_at = null`.
--
-- Re-runnable on its own, like every statement catch-up.sql replays.

alter table business_settings
  add column if not exists guest_checkout_enabled_at timestamptz;

comment on column business_settings.guest_checkout_enabled_at is
  'NULL = guest checkout OFF. Set to now() to let visitors book without an account. Read by the '
  'checkout page and POST /api/v1/bookings (src/lib/settings/guest-checkout.ts).';

-- The version signed into a guest booking's manage link. A row exists only once staff have reset the
-- link: no row means version 1, so the table stays almost empty. Bumping it kills every earlier link.
create table if not exists booking_guest_links (
  booking_id uuid primary key references bookings (id) on delete cascade,
  version int not null default 1 check (version > 0),
  reset_at timestamptz,
  reset_by uuid references auth.users (id) on delete set null
);

comment on table booking_guest_links is
  'Revocation for the signed guest manage link (src/lib/guest/link-token.ts). No row = version 1. '
  'service_role only; RLS on with no policies.';

-- RLS with no policies, and production's default privileges revoked too (landmines.md: a table the
-- browser never writes). Name `public` as well: anon and authenticated are members of it.
alter table booking_guest_links enable row level security;
revoke all on booking_guest_links from public, anon, authenticated;
grant select, insert, update, delete on booking_guest_links to service_role;
