-- The customer booking page (/bookings/[ref]) is visible to its owner OR staff (bookings RLS),
-- so a staff account browsing the customer site renders another guest's booking with no visual
-- cue — which read as an IDOR scare in launch week. Expose the ownership fact on the DTO:
-- isOwn = the caller is the booking's user. coalesce(): a null user_id or a null auth.uid()
-- must serialize as false, never null. The body is otherwise the verbatim 20260615121200
-- original (this function's only prior definition — no drift to re-carry). ACL is preserved by
-- create-or-replace; anon/authenticated/service_role EXECUTE stays, which is correct here.
create or replace function api_get_booking(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select booking_json(b.id)
         || jsonb_build_object('isOwn', coalesce(b.user_id = auth.uid(), false))
  from bookings b
  where b.ref = p ->> 'ref';
$$;
