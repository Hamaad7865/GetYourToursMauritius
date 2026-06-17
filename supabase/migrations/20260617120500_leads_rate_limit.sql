-- F7: throttle the public, unauthenticated lead-capture endpoint.
--
-- api_capture_lead is anon-granted and inserted a row on every call with no rate limit, so anyone
-- could script unlimited writes — flooding the admin inbox and the leads table. Add a per-IP hourly
-- cap as defence in depth (the primary control should be a Cloudflare Rate Limiting rule / Turnstile
-- at the edge; the route also drops obvious bots via a honeypot field before this runs).

alter table leads add column if not exists ip text;
create index if not exists leads_ip_created_idx on leads (ip, created_at);

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

  insert into leads (name, contact, interest_activity_id, source, ip)
  values (
    p ->> 'name', p ->> 'contact',
    nullif(p ->> 'interestActivityId', '')::uuid,
    coalesce(p ->> 'source', 'web'),
    v_ip
  )
  returning * into v_lead;
  return jsonb_build_object(
    'id', v_lead.id, 'name', v_lead.name, 'contact', v_lead.contact,
    'interestActivityId', v_lead.interest_activity_id, 'status', v_lead.status,
    'source', v_lead.source, 'createdAt', v_lead.created_at
  );
end;
$$;
