-- ============================================================================
-- PURGE TRANSACTIONAL DATA
-- Turns the (test-polluted) database into a clean PRODUCTION database, without
-- touching a single thing you built by hand.
--
-- KEEPS (untouched):
--   * the whole catalogue — activities, activity_options, activity_option_prices,
--     activity_images, activity_translations, categories, operators
--   * all config — sightseeing_pricing, transport_band_pricing, region_zone_distance,
--     airport_transfer_*, hotel_transfer_*, planner_places, planner_pricing,
--     rental_vehicles
--   * availability — session_occurrences (see the note on seats below)
--   * places_cache (a Google Places cache — deleting it just costs API calls)
--   * every ADMIN / STAFF login (profiles.role <> 'customer') and its auth user
--
-- DELETES:
--   * every booking + everything hanging off it (booking_items, booking_holds,
--     payments, payment_events — all reached by ON DELETE CASCADE)
--   * abandoned cart holds (holds with booking_id IS NULL never cascade)
--   * the notification outbox, in-app notifications, rate limits, audit logs
--   * chat sessions/messages, leads, wishlists
--   * the test CUSTOMER accounts (profiles + their auth.users rows)
--
-- WHY SEATS FREE THEMSELVES:
--   session_occurrences has NO used_capacity column (id, activity_option_id,
--   operator_id, starts_at, ends_at, capacity, status, created_at). Usage is
--   DERIVED by counting booking_items/booking_holds against the occurrence, so
--   deleting the bookings and holds releases every seat automatically. That is
--   why availability is left completely alone here.
--
-- ⚠️  BACK UP FIRST (Supabase → Database → Backups) — this is irreversible.
--     Also run `npx tsx scripts/dump-catalogue.ts` beforehand; it writes a full
--     logical backup of the catalogue you cannot re-create by hand.
--
-- Run in the Supabase SQL editor. Idempotent: safe to re-run (re-running a
-- second time simply deletes nothing).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) SAFETY: the logins that will SURVIVE. Read this in the output before you
--    trust the rest of the run. If your own admin account is not listed here,
--    ROLL BACK (do not commit) — you would be locking yourself out of /admin.
-- ---------------------------------------------------------------------------
select 'SURVIVING LOGIN' as note, p.id, p.role::text as role, u.email
from profiles p
join auth.users u on u.id = p.id
where p.role <> 'customer'
order by p.role::text, u.email;

-- ---------------------------------------------------------------------------
-- 1) Bookings. CASCADE takes booking_items, booking_holds (the ones attached to
--    a booking), payments, and payment_events with them.
--    notification_outbox.booking_id and chat_sessions.booking_id are SET NULL,
--    not cascade — those tables are cleared explicitly in step 3.
-- ---------------------------------------------------------------------------
delete from bookings;

-- ---------------------------------------------------------------------------
-- 2) Abandoned cart holds. A hold with booking_id IS NULL (checkout started but
--    never paid) is NOT reached by the cascade above, so it must go explicitly.
-- ---------------------------------------------------------------------------
delete from booking_holds;

-- ---------------------------------------------------------------------------
-- 3) Ops / queue junk.
-- ---------------------------------------------------------------------------
delete from notification_outbox;   -- queued + already-sent test emails/WhatsApps
delete from notifications;         -- the in-app admin bell
delete from rate_limits;           -- per-IP counters
delete from audit_logs;            -- admin action trail from testing

-- ---------------------------------------------------------------------------
-- 4) Chat, leads, wishlists.
--    chat_messages first: it hangs off chat_sessions.
-- ---------------------------------------------------------------------------
delete from chat_messages;
delete from chat_sessions;
delete from leads;
delete from wishlists;

-- ---------------------------------------------------------------------------
-- 5) Test CUSTOMER accounts.
--    Deleting the auth user first lets any FK from profiles → auth.users cascade
--    the profile away. The predicate keeps every NON-customer profile (admin /
--    staff / seo), so your own logins survive. The second delete is belt-and-
--    braces for installs where profiles has no FK to auth.users (nothing to
--    cascade), and for customer profiles whose auth user is already gone.
-- ---------------------------------------------------------------------------
delete from auth.users u
where not exists (
  select 1 from profiles p
  where p.id = u.id
    and p.role <> 'customer'
);

delete from profiles where role = 'customer';

commit;

-- ---------------------------------------------------------------------------
-- 6) VERIFY. Every "should be 0" row must read 0, and the catalogue counts must
--    match what you had before the purge.
-- ---------------------------------------------------------------------------
select 'should be 0' as expect, 'bookings'           as t, count(*) as n from bookings
union all select 'should be 0', 'booking_items',       count(*) from booking_items
union all select 'should be 0', 'booking_holds',       count(*) from booking_holds
union all select 'should be 0', 'payments',            count(*) from payments
union all select 'should be 0', 'payment_events',      count(*) from payment_events
union all select 'should be 0', 'notification_outbox', count(*) from notification_outbox
union all select 'should be 0', 'rate_limits',         count(*) from rate_limits
union all select 'should be 0', 'leads',               count(*) from leads
union all select 'should be 0', 'customer profiles',   count(*) from profiles where role = 'customer'
union all select 'KEPT',        'admin/staff profiles',count(*) from profiles where role <> 'customer'
union all select 'KEPT',        'activities',          count(*) from activities
union all select 'KEPT',        'activity_options',    count(*) from activity_options
union all select 'KEPT',        'activity_images',     count(*) from activity_images
union all select 'KEPT',        'categories',          count(*) from categories
union all select 'KEPT',        'session_occurrences', count(*) from session_occurrences
union all select 'KEPT',        'rental_vehicles',     count(*) from rental_vehicles
union all select 'KEPT',        'airport_hotels',      count(*) from airport_transfer_hotels
order by 1 desc, 2;
