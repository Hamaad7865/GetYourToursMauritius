-- Account profile + GDPR export RPCs, so the mobile app has the same profile/export/delete the web
-- Server Actions provide. Owner-scoped (auth.uid()); profile read/update create the row if missing (the
-- app has no handle_new_user trigger — the row is created lazily). Account DELETE reuses the existing
-- api_erase_user (data) + the service-role auth.admin.deleteUser (auth user) in the route. The
-- enforce_profile_role trigger keeps role pinned to 'customer' through these writes.

-- GET /account/profile — create-if-missing, then return the profile.
create or replace function api_get_profile(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into profiles (id) values (v_uid) on conflict (id) do nothing;
  select * into v_row from profiles where id = v_uid;
  return jsonb_build_object(
    'id', v_row.id,
    'fullName', v_row.full_name,
    'phone', v_row.phone,
    'dateOfBirth', v_row.date_of_birth,
    'role', v_row.role,
    'memberSince', v_row.created_at
  );
end;
$$;

-- PATCH /account/profile — update only the provided keys (fullName/phone/dateOfBirth); empty string → null.
create or replace function api_update_profile(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  insert into profiles (id) values (v_uid) on conflict (id) do nothing;
  update profiles set
    full_name = case when p ? 'fullName' then nullif(btrim(p ->> 'fullName'), '') else full_name end,
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else phone end,
    date_of_birth = case when p ? 'dateOfBirth' then nullif(p ->> 'dateOfBirth', '')::date else date_of_birth end
  where id = v_uid
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id,
    'fullName', v_row.full_name,
    'phone', v_row.phone,
    'dateOfBirth', v_row.date_of_birth,
    'role', v_row.role,
    'memberSince', v_row.created_at
  );
end;
$$;

-- GET /account/export — the caller's GDPR data export (profile incl. dateOfBirth + bookings). A stable
-- shape (nulls for absent fields) so the mobile client gets a typed payload.
create or replace function api_export_user(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_profile profiles;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;
  select * into v_profile from profiles where id = v_uid;
  return jsonb_build_object(
    'profile', jsonb_build_object(
      'fullName', v_profile.full_name,
      'phone', v_profile.phone,
      'email', v_email,
      'dateOfBirth', v_profile.date_of_birth
    ),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', b.ref,
        'status', b.status,
        'date', coalesce(
          (select min(so.starts_at) from booking_items bi
             join session_occurrences so on so.id = bi.session_occurrence_id
            where bi.booking_id = b.id),
          b.created_at),
        'totalEur', b.total_minor::float / 100,
        'currency', b.currency,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('label', bi.price_label, 'qty', bi.quantity))
          from booking_items bi where bi.booking_id = b.id
        ), '[]'::jsonb),
        'pickup', b.pickup_location,
        'dropoff', b.dropoff_location,
        'gender', b.traveller_gender,
        'company', b.traveller_company,
        'country', b.traveller_country,
        'specialNotes', b.special_notes,
        'roomOrCabin', b.room_or_cabin,
        'luggageDetails', b.luggage_details,
        'childSeatAge', b.child_seat_age,
        'flightNumber', b.flight_number,
        'arrivalTime', b.arrival_time,
        'returnDate', b.return_date,
        'returnTime', b.return_time,
        'departureFlightNumber', b.departure_flight_number
      ) order by b.created_at desc)
      from bookings b where b.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function api_get_profile(jsonb) from public;
revoke execute on function api_update_profile(jsonb) from public;
revoke execute on function api_export_user(jsonb) from public;
grant execute on function api_get_profile(jsonb) to authenticated;
grant execute on function api_update_profile(jsonb) to authenticated;
grant execute on function api_export_user(jsonb) to authenticated;
