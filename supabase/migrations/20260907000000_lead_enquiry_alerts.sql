-- Website enquiry alerts.
--
-- The floating "WhatsApp us" button became a real enquiry FORM (ContactFloat), so a visitor's question
-- now lands in `leads` instead of in the owner's phone. Two gaps had to close for that to be an
-- improvement rather than a regression:
--
--   1. `leads` could not hold what the form collects. The single 200-char `contact` blob has to carry
--      email + phone already, and truncating a customer's actual question mid-sentence is not an
--      option — so the free text, the page they asked from, and the optional trip fields get real
--      columns. `contact` keeps being written exactly as before, so ContactForm, InquiryWidget and
--      the admin list all keep working untouched.
--
--   2. A lead notified NOBODY. Rows sat in /admin/leads until somebody thought to look — the same
--      hole owner booking alerts closed in 20260804000000. Every new lead now enqueues ONE owner
--      email on the existing outbox rails (drained every 2 minutes by the cron worker), using the
--      literal recipient sentinel 'owner' so the drain resolves the real address from
--      OWNER_NOTIFY_EMAIL at send time and no personal contact detail is stored in the DB.

alter table leads add column if not exists message text;
alter table leads add column if not exists page_url text;
alter table leads add column if not exists preferred_date date;
alter table leads add column if not exists party_size int;

-- Mirrors the form's own 1..99 bound. Every pre-existing row is null, so this validates instantly.
alter table leads drop constraint if exists leads_party_size_range;
alter table leads
  add constraint leads_party_size_range
  check (party_size is null or party_size between 1 and 99);

-- Re-applies the 20260617120500 body VERBATIM (per-IP hourly cap intact — the endpoint is public and
-- unauthenticated) with the four new fields threaded through insert + return. Empty strings are
-- normalised to null so an untouched optional input never stores '' and renders as a blank row in the
-- owner's email.
create or replace function api_capture_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead leads;
  v_ip text := nullif(p ->> 'ip', '');
  v_recent int;
  v_max_per_hour constant int := 8;
begin
  if v_ip is not null then
    select count(*) into v_recent
    from leads
    where ip = v_ip and created_at > now() - interval '1 hour';
    if v_recent >= v_max_per_hour then
      raise exception 'rate_limited' using detail = format('ip %s', v_ip);
    end if;
  end if;

  insert into leads (
    name, contact, interest_activity_id, source, ip,
    message, page_url, preferred_date, party_size
  )
  values (
    p ->> 'name', p ->> 'contact',
    nullif(p ->> 'interestActivityId', '')::uuid,
    coalesce(p ->> 'source', 'web'),
    v_ip,
    nullif(p ->> 'message', ''),
    nullif(p ->> 'pageUrl', ''),
    nullif(p ->> 'preferredDate', '')::date,
    nullif(p ->> 'partySize', '')::int
  )
  returning * into v_lead;
  return jsonb_build_object(
    'id', v_lead.id, 'name', v_lead.name, 'contact', v_lead.contact,
    'interestActivityId', v_lead.interest_activity_id, 'status', v_lead.status,
    'source', v_lead.source, 'createdAt', v_lead.created_at
  );
end;
$$;

-- Re-assert the 20260807000000 lockdown. CREATE OR REPLACE preserves privileges, but this file is
-- also appended to catch-up.sql AFTER that lockdown runs, so stating it here keeps the grant correct
-- no matter which of the two paths applied it (same convention as every api_book redefinition).
revoke execute on function api_capture_lead(jsonb) from public, anon, authenticated;
grant execute on function api_capture_lead(jsonb) to service_role;

-- The payload carries EVERYTHING the email needs, so the drain's enrich step is pure and synchronous
-- (no DB round-trip, hence no failure mode that could strand the row) — the same shape
-- enqueue_review_invites / owner_date_changed already rely on. The activity title is resolved here,
-- at insert time, because that is the one fact the lead row itself doesn't carry.
create or replace function enqueue_lead_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if new.interest_activity_id is not null then
    select a.title into v_title from activities a where a.id = new.interest_activity_id;
  end if;

  -- No booking_id: this is an ad-hoc notification, and the column is nullable for exactly that case.
  insert into notification_outbox (channel, recipient, template, payload, idempotency_key)
  values (
    'email', 'owner', 'owner_new_lead',
    jsonb_build_object(
      'leadId', new.id,
      'name', new.name,
      'contact', new.contact,
      'message', new.message,
      'pageUrl', new.page_url,
      'activityTitle', v_title,
      'preferredDate', new.preferred_date,
      'partySize', new.party_size,
      'source', new.source
    ),
    'owner_new_lead:' || new.id
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists leads_notify_owner on leads;
create trigger leads_notify_owner
after insert on leads
for each row execute function enqueue_lead_notification();
