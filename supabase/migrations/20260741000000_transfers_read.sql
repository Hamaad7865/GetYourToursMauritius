-- Transfers — read-only endpoints for the mobile transfer flow (booking still goes through /holds +
-- /bookings via api_book). The QUOTE reuses the EXACT helpers + formula api_book uses
-- (airport_transfer_fare_minor / hotel_transfer_fare_minor / airport_transfer_area_zone / area_region /
-- region_distance_band, and round(oneWay*2*(100-pct)/100) for returns), so a quote can never drift from
-- the charged price. All three are SECURITY DEFINER (read the config/fare tables regardless of RLS) and
-- public (granted to anon) — no PII, just fares.

-- T1: typeahead over the bookable airport-transfer hotels (DB is the authoritative bookable set + the
-- zone/region used for pricing; the mobile layers display extras — coords/area/fromPrice — from content).
create or replace function api_search_transfer_hotels(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(p ->> 'q'), '');
  v_page int := greatest(coalesce((p ->> 'page')::int, 1), 1);
  v_page_size int := least(greatest(coalesce((p ->> 'pageSize')::int, 20), 1), 100);
  v_items jsonb;
  v_total int;
begin
  with filtered as (
    select slug, hotel_name, region, zone
    from airport_transfer_hotels
    where v_q is null or hotel_name ilike '%' || v_q || '%'
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', f.slug, 'name', f.hotel_name, 'region', f.region, 'zone', f.zone
      ) order by f.hotel_name)
      from (select * from filtered order by hotel_name limit v_page_size offset (v_page - 1) * v_page_size) f
    ), '[]'::jsonb),
    (select count(*)::int from filtered)
  into v_items, v_total;
  return jsonb_build_object('items', v_items, 'total', v_total);
end;
$$;

-- T2: curated point-to-point areas with server-authoritative classification. The names mirror
-- src/lib/content/transfer-locations.ts; `region` is the curated value (kept in sync with area_region),
-- `zone` is derived via the SAME helper api_book uses so the picker's pricing can't drift.
create or replace function api_list_transfer_areas(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', t.label,
    'region', t.region,
    'zone', airport_transfer_area_zone(t.label)
  ) order by t.region, t.label), '[]'::jsonb)
  from (values
    ('Grand Baie', 'North'), ('Pereybère', 'North'), ('Cap Malheureux', 'North'),
    ('Trou aux Biches', 'North'), ('Mont Choisy', 'North'), ('Pointe aux Canonniers', 'North'),
    ('Balaclava', 'North'), ('Pointe aux Piments', 'North'), ('Grand Gaube', 'North'), ('Port Louis', 'North'),
    ('Belle Mare', 'East'), ('Trou d''Eau Douce', 'East'), ('Palmar', 'East'), ('Poste Lafayette', 'East'),
    ('Roches Noires', 'East'), ('Centre de Flacq', 'East'),
    ('Mahébourg', 'South'), ('Blue Bay', 'South'), ('Pointe d''Esny', 'South'), ('Bel Ombre', 'South'),
    ('Souillac', 'South'), ('Chamarel', 'South'), ('Grand Port', 'South'),
    ('Flic en Flac', 'West'), ('Tamarin', 'West'), ('Rivière Noire (Black River)', 'West'),
    ('Le Morne', 'West'), ('Wolmar', 'West'), ('Albion', 'West'), ('La Gaulette', 'West'),
    ('Curepipe', 'Central'), ('Quatre Bornes', 'Central'), ('Moka', 'Central'),
    ('Vacoas', 'Central'), ('Ébène', 'Central'), ('Rose Hill', 'Central')
  ) as t(label, region);
$$;

-- T3: the load-bearing quote. Branches exactly like api_book and calls the identical fare helpers, so the
-- returned totalEur equals the charged total cent-for-cent. Transfers price by TOTAL passenger count.
create or replace function api_transfer_quote(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := p ->> 'transferSlug';
  v_pax int := 0;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_trip_type text := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
  v_zone text;
  v_band text;
  v_pickup_region text;
  v_dropoff_region text;
  v_one_way bigint;
  v_ret_pct int;
  v_total bigint;
  v_zone_or_band text;
  v_vehicle text;
begin
  if v_kind not in ('airport-transfer', 'hotel-transfer') then
    raise exception 'invalid_request: unknown transferSlug';
  end if;

  -- pax = sum of the party object, else the scalar `pax`, floored at 1 (matches api_book's v_total_qty).
  if jsonb_typeof(p -> 'party') = 'object' then
    select coalesce(sum(value::int), 0) into v_pax from jsonb_each_text(p -> 'party');
  end if;
  if v_pax < 1 then
    v_pax := greatest(coalesce(nullif(p ->> 'pax', '')::int, 1), 1);
  end if;

  if v_kind = 'airport-transfer' then
    v_zone := coalesce(
      (select zone from airport_transfer_hotels where slug = nullif(p ->> 'dropoffSlug', '')),
      airport_transfer_area_zone(p ->> 'dropoffArea'));
    v_one_way := airport_transfer_fare_minor(v_zone, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
    v_zone_or_band := v_zone;
  else
    v_pickup_region := coalesce(
      (select region from airport_transfer_hotels where slug = nullif(p ->> 'pickupSlug', '')),
      area_region(p ->> 'pickupArea'));
    v_dropoff_region := coalesce(
      (select region from airport_transfer_hotels where slug = nullif(p ->> 'dropoffSlug', '')),
      area_region(p ->> 'dropoffArea'));
    v_band := region_distance_band(v_pickup_region, v_dropoff_region);
    v_one_way := hotel_transfer_fare_minor(v_band, v_pax, v_suv);
    select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
    v_zone_or_band := v_band;
  end if;

  v_ret_pct := coalesce(v_ret_pct, 0);
  v_total := case when v_trip_type = 'return'
    then round(v_one_way::numeric * 2 * (100 - v_ret_pct) / 100)::bigint
    else v_one_way end;

  -- Vehicle bracket — same boundaries as the fare helpers (display only).
  v_vehicle := case
    when v_pax <= 4 then case when v_suv then 'SUV' else 'Sedan' end
    when v_pax <= 6 then 'Family'
    when v_pax <= 14 then 'Van'
    when v_pax <= 25 then 'Coaster'
    else 'Coaster x' || ceil(v_pax::numeric / 25)::int
  end;

  return jsonb_build_object(
    'totalEur', v_total::float / 100,
    'vehicle', v_vehicle,
    'zoneOrBand', v_zone_or_band,
    'tripType', v_trip_type,
    'oneWayEur', v_one_way::float / 100,
    'returnDiscountPct', v_ret_pct
  );
end;
$$;

grant execute on function api_search_transfer_hotels(jsonb) to anon, authenticated, service_role;
grant execute on function api_list_transfer_areas(jsonb) to anon, authenticated, service_role;
grant execute on function api_transfer_quote(jsonb) to anon, authenticated, service_role;
