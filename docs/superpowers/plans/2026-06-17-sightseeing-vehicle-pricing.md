# Sightseeing Vehicle Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price every Sightseeing tour by one global rule — €70 per block of 4 people, with a flat €85 SUV upgrade for parties of 1–4 — capped at 25, server-authoritative.

**Architecture:** A one-row `sightseeing_pricing` config table holds the two tunable prices. `pricing_mode='vehicle'` triggers the rule in `create_booking` (recomputed from the config + party size; no per-tour price rows). `api_book` reserves one vehicle slot and threads an `suv` flag. The catalogue API returns the config so the booking widget mirrors the same numbers. Replaces the unused flat-bracket vehicle mode.

**Tech Stack:** Postgres (plpgsql, SECURITY DEFINER RPCs) on Supabase, PGlite for tests, Next.js 15 App Router + TypeScript, Zod DTOs, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-sightseeing-vehicle-pricing-design.md`

**Key facts discovered (do not regress):**
- Latest `create_booking` = `20260616190000_vehicle_pricing.sql` (7-arg, flat-bracket vehicle branch).
- Latest `api_book` = `20260617120100_booking_authz_integrity.sql` — it **dropped the vehicle branch** (always holds `v_total_qty`) and added F23 (replay-disclosure guard) + F25 (party bound). My rewrite must keep F23/F25 **and** restore the vehicle branch.
- New migration must sort after `20260617120500_*` → name it `20260617130000_sightseeing_vehicle_pricing.sql`.
- Tests call `create_booking(...)` with **7 positional args**; adding `p_suv boolean default false` as the 8th keeps those calls valid (they bind via the default) **only after** the old 7-arg function is dropped.
- Catch-up pattern evolved to **one dated file per batch** (`catch-up-2026-06-17-bugfixes.sql`); make a new `catch-up-2026-06-17-sightseeing-pricing.sql`.

---

## Task 1: DB migration — config table + rewritten `create_booking` / `api_book` / catalogue

**Files:**
- Create: `supabase/migrations/20260617130000_sightseeing_vehicle_pricing.sql`
- Test: `tests/integration/security-fixes.test.ts` (replace `seedVehicle` + the 3 vehicle tests; add a catalogue-config test)

- [ ] **Step 1: Replace the vehicle tests with the new-model tests (failing first)**

In `tests/integration/security-fixes.test.ts`, replace the `seedVehicle` helper (currently lines ~151–163) and the three vehicle tests (`'charges a flat price by vehicle bracket…'`, `'rejects a vehicle party larger than the biggest vehicle'`, `'counts vehicles, not people…'`) with:

```ts
  async function seedVehicle(capacity: number): Promise<{ occurrenceId: string; optionId: string }> {
    const { occurrenceId, optionId } = await seedOccurrence(db, capacity);
    await db.pg.query(
      `update activities set pricing_mode = 'vehicle' where id = (select activity_id from activity_options where id = $1)`,
      [optionId],
    );
    return { occurrenceId, optionId };
  }

  it('charges €70 per block of 4 by party size; SUV is a flat €85 upgrade ≤4', async () => {
    for (const [people, suv, expectMinor, vehicle] of [
      [1, false, 7000, 'Sedan'],
      [4, false, 7000, 'Sedan'],
      [4, true, 8500, 'SUV'],
      [5, false, 14000, 'Family car'],
      [6, false, 14000, 'Family car'],
      [7, false, 14000, 'Minibus'],
      [12, false, 21000, 'Minibus'],
      [14, false, 28000, 'Minibus'],
      [15, false, 28000, 'Coaster'],
      [25, false, 49000, 'Coaster'],
    ] as const) {
      await db.asOwner();
      const { occurrenceId } = await seedVehicle(10);
      const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
        occurrenceId,
        `veh-${people}-${suv}`,
      ]);
      const { rows: b } = await db.pg.query<{ id: string; total_minor: number | string }>(
        `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb, $4)`,
        [`veh-bk-${people}-${suv}`, h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: people }]), suv],
      );
      expect(Number(b[0]!.total_minor)).toBe(expectMinor);
      const { rows: item } = await db.pg.query<{
        quantity: number;
        pax: number;
        subtotal_minor: number | string;
        price_label: string;
      }>(`select quantity, pax, subtotal_minor, price_label from booking_items where booking_id = $1`, [b[0]!.id]);
      expect(item[0]!.quantity).toBe(1); // one vehicle slot
      expect(item[0]!.pax).toBe(people); // people on board
      expect(item[0]!.price_label).toBe(vehicle);
      expect(Number(item[0]!.subtotal_minor)).toBe(expectMinor);
    }
  });

  it('rejects a sightseeing party larger than 25', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedVehicle(50);
    const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, 'veh-over')`, [
      occurrenceId,
    ]);
    await expect(
      db.pg.query(
        `select * from create_booking('veh-over-bk', $1, 'X', 'x@x.com', null, 'web'::booking_source, $2::jsonb, false)`,
        [h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: 26 }])],
      ),
    ).rejects.toThrow(/exceeds_vehicle_capacity/);
  });

  it('counts vehicles, not people, against the day — two vehicles fill a capacity-2 day', async () => {
    await db.asOwner();
    const { occurrenceId } = await seedVehicle(2); // two vehicle slots
    for (const n of [1, 2]) {
      const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
        occurrenceId,
        `cap-${n}`,
      ]);
      await db.pg.query(
        `select * from create_booking($1, $2, 'X', 'x@x.com', null, 'web'::booking_source, $3::jsonb, false)`,
        [`cap-bk-${n}`, h[0]!.id, JSON.stringify([{ price_label: 'Vehicle', quantity: 10 }])],
      );
    }
    await expect(db.pg.query(`select * from create_hold($1, 1, 'cap-3')`, [occurrenceId])).rejects.toThrow();
  });

  it('catalogue exposes the global vehicle pricing config (from €70) for vehicle mode', async () => {
    await db.asOwner();
    const { optionId } = await seedVehicle(10);
    const { rows: a } = await db.pg.query<{ slug: string }>(
      `select slug from activities where id = (select activity_id from activity_options where id = $1)`,
      [optionId],
    );
    const { rows } = await db.pg.query<{ data: { pricingMode: string; fromPriceEur: number; vehiclePricing: unknown } }>(
      `select api_get_activity($1::jsonb) as data`,
      [JSON.stringify({ slug: a[0]!.slug })],
    );
    expect(rows[0]!.data.pricingMode).toBe('vehicle');
    expect(rows[0]!.data.fromPriceEur).toBe(70);
    expect(rows[0]!.data.vehiclePricing).toMatchObject({
      perBlockEur: 70,
      suvFlatEur: 85,
      blockSize: 4,
      maxParty: 25,
    });
  });
```

- [ ] **Step 2: Run the vehicle tests — expect FAIL (old flat-bracket function + no config table + no 8-arg signature)**

Run: `npx vitest run tests/integration/security-fixes.test.ts -t "vehicle|sightseeing|€70|capacity-2|catalogue exposes"`
Expected: FAIL (e.g. wrong totals like 7500/8500, or `function create_booking(... , boolean) does not exist`, or `relation "sightseeing_pricing" does not exist`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260617130000_sightseeing_vehicle_pricing.sql`:

```sql
-- Sightseeing vehicle pricing — ONE global rule for every sightseeing tour.
--
-- Price = €70 per block of 4 people (per_block_minor * ceil(P / 4)), with a flat €85 SUV upgrade for
-- parties of 1-4. Party is capped at 25. The vehicle name is a function of P (Sedan/Family car/
-- Minibus/Coaster; SUV when upgraded). The two prices live in a single-row config table so the owner
-- changes them once for all tours. Each booking still reserves ONE vehicle slot of the day's capacity
-- (quantity = 1) and records people in booking_items.pax. Replaces the old flat-bracket vehicle mode.

-- 1) Global config: one row, two tunable prices. RLS on with NO policies → only the SECURITY DEFINER
--    RPCs (which bypass RLS) read it; the owner edits it from the SQL editor (service role).
create table if not exists sightseeing_pricing (
  id              boolean primary key default true check (id),
  per_block_minor int not null default 7000,  -- €70 per block of 4
  suv_flat_minor  int not null default 8500,  -- €85 SUV, flat, parties of 1-4
  updated_at      timestamptz not null default now()
);
insert into sightseeing_pricing (id) values (true) on conflict (id) do nothing;
alter table sightseeing_pricing enable row level security;

-- 2) create_booking gains p_suv (8th arg). Drop the old 7-arg first so this REPLACES it rather than
--    creating an overload (7-arg positional callers then bind here via the default).
drop function if exists create_booking(text, uuid, text, text, text, booking_source, jsonb);

create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_per_block bigint;
  v_suv_flat bigint;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  select a.pricing_mode into v_mode
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  -- Aggregate quantity (people) per price_label, collapsing duplicate lines.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_mode = 'vehicle' then
    -- Global sightseeing rule. P = v_qty_total (people on board).
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select per_block_minor, suv_flat_minor into v_per_block, v_suv_flat from sightseeing_pricing limit 1;
    if v_per_block is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 and p_suv then
      v_total := v_suv_flat;
      v_vehicle := 'SUV';
    else
      v_total := v_per_block * ceil(v_qty_total::numeric / 4)::int;
      v_vehicle := case
        when v_qty_total <= 4 then 'Sedan'
        when v_qty_total <= 6 then 'Family car'
        when v_qty_total <= 14 then 'Minibus'
        else 'Coaster'
      end;
    end if;
    -- The hold reserves ONE vehicle, not P seats.
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: price each aggregated tier from the DB.
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_mode = 'vehicle' then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  update booking_holds set booking_id = v_booking.id where id = v_hold.id;
  return v_booking;
end;
$$;

grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to anon, authenticated, service_role;

-- 3) api_book: keep F23 (replay-disclosure guard) + F25 (party bound), restore the vehicle branch
--    (hold ONE vehicle), and thread the suv flag to create_booking.
create or replace function api_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_total_qty bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  -- Vehicle bookings take ONE slot of the day's capacity regardless of party size.
  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23: a replay with someone else's key must not echo back their booking.
  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

-- 4) Catalogue: for vehicle mode, fromPriceEur = the €70 base and expose the config block so the
--    booking widget mirrors the exact numbers. Non-vehicle modes unchanged.
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', a.title, 'summary', a.summary,
    'description', a.description, 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', a.meeting_point,
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(a.inclusions), 'exclusions', to_jsonb(a.exclusions),
    'highlights', to_jsonb(a.highlights), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', a.seo_title, 'seoDescription', a.seo_description,
    'extra', a.extra,
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
      else (
        select min(pr.amount_minor)::float / 100
        from activity_option_prices pr join activity_options o on o.id = pr.activity_option_id
        where o.activity_id = a.id
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'perBlockEur', per_block_minor::float / 100,
        'suvFlatEur', suv_flat_minor::float / 100,
        'blockSize', 4,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description,
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  where a.slug = p ->> 'slug';
$$;

create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*
    from activities a
    where a.status = 'published'
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  ),
  paged as (
    select * from filtered
    order by rating_count desc, title
    limit coalesce((p ->> 'pageSize')::int, 20)
    offset (coalesce((p ->> 'page')::int, 1) - 1) * coalesce((p ->> 'pageSize')::int, 20)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'slug', x.slug, 'type', x.type, 'title', x.title, 'summary', x.summary,
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'ratingAvg', x.rating_avg, 'ratingCount', x.rating_count, 'pricingMode', x.pricing_mode,
        'fromPriceEur', case
          when x.pricing_mode = 'vehicle'
            then (select per_block_minor from sightseeing_pricing limit 1)::float / 100
          else (
            select min(pr.amount_minor)::float / 100
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = x.id
          )
        end,
        'fromPriceMaxGuests', case when x.pricing_mode = 'vehicle' then null else (
          select pr.max_guests
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = x.id
          order by pr.amount_minor asc nulls last
          limit 1
        ) end,
        'heroImage', (
          select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
          from activity_images img where img.activity_id = x.id order by img.position limit 1
        ),
        'images', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
            order by img.position
          )
          from activity_images img where img.activity_id = x.id
        ), '[]'::jsonb)
      ))
      from paged x
    ), '[]'::jsonb),
    'total', (select count(*)::int from filtered),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;
```

- [ ] **Step 4: Run the vehicle tests — expect PASS**

Run: `npx vitest run tests/integration/security-fixes.test.ts`
Expected: PASS (all, including the per-group test which is untouched).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617130000_sightseeing_vehicle_pricing.sql tests/integration/security-fixes.test.ts
git commit -m "feat(pricing): global sightseeing vehicle rule in create_booking/api_book"
```

---

## Task 2: Thread the `suv` flag through the booking service

**Files:**
- Modify: `src/lib/validation/booking.ts` (add `suv` to `createBookingInputSchema`)
- Modify: `src/lib/services/bookings.ts` (forward `suv` to the `api_book` payload)
- Test: `tests/integration/booking-flow.test.ts` (add a vehicle+SUV booking via the service)

- [ ] **Step 1: Write the failing service test**

Add to `tests/integration/booking-flow.test.ts` (mirror the file's existing setup — it builds a `ctx` via `publicServiceContext`/`pgliteRpc` and seeds an occurrence; reuse whatever helper the file already uses to create a bookable occurrence, then set the activity to vehicle mode). Add:

```ts
  it('books a vehicle tour at the SUV flat price when suv is set', async () => {
    await db.asOwner();
    const { occurrenceId, slug } = await seedBookableVehicle(db); // sets pricing_mode='vehicle', published, 1 daily slot
    const booking = await createBooking(ctx, {
      occurrenceId,
      expectedSlug: slug,
      party: { Vehicle: 3 },
      suv: true,
      customer: { name: 'A', email: 'a@x.com' },
      idempotencyKey: 'svc-suv-1',
    });
    expect(booking.totalEur).toBe(85);
    expect(booking.items[0]!.priceLabel).toBe('SUV');
    expect(booking.items[0]!.pax).toBe(3);
    expect(booking.items[0]!.quantity).toBe(1);
  });
```

If `booking-flow.test.ts` lacks a `seedBookableVehicle` helper, add one next to its existing seed helper that: creates a published activity + option + an open occurrence with `daily_capacity`/capacity ≥ 1, sets `pricing_mode='vehicle'`, and returns `{ occurrenceId, slug }`. (No price rows.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/integration/booking-flow.test.ts -t "SUV flat price"`
Expected: FAIL — `suv` is dropped by the input schema, so the price is €70 (Sedan), not €85.

- [ ] **Step 3: Add `suv` to the booking input schema**

In `src/lib/validation/booking.ts`, inside `createBookingInputSchema` (after `party`):

```ts
  /** Sightseeing vehicle mode only: the customer chose the SUV upgrade (flat price, parties ≤4).
   *  Ignored by every other pricing mode and for parties over the SUV tier. */
  suv: z.boolean().optional(),
```

- [ ] **Step 4: Forward `suv` in the service**

In `src/lib/services/bookings.ts`, in the `callRpc(ctx, 'api_book', { ... })` object, add after `party: input.party,`:

```ts
    suv: input.suv ?? false,
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run tests/integration/booking-flow.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation/booking.ts src/lib/services/bookings.ts tests/integration/booking-flow.test.ts
git commit -m "feat(pricing): thread the SUV upgrade flag through the booking service"
```

---

## Task 3: Catalogue DTO — `vehiclePricing` config

**Files:**
- Modify: `src/lib/validation/tours.ts` (add `vehiclePricingSchema` + field on `tourDetailSchema`)

- [ ] **Step 1: Add the schema + field**

In `src/lib/validation/tours.ts`, after `tourPriceSchema` (before `tourImageSchema`), add:

```ts
/** Global sightseeing vehicle-pricing config, returned for vehicle-mode tours so the booking widget
 *  mirrors the server's exact numbers (price is still recomputed server-side at booking time). */
export const vehiclePricingSchema = z.object({
  perBlockEur: z.number().nonnegative(),
  suvFlatEur: z.number().nonnegative(),
  blockSize: z.number().int().positive(),
  maxParty: z.number().int().positive(),
});
export type VehiclePricing = z.infer<typeof vehiclePricingSchema>;
```

Then in `tourDetailSchema.extend({ ... })`, add a field (after `reviews: z.array(reviewSchema),`):

```ts
  vehiclePricing: vehiclePricingSchema.nullish(),
```

- [ ] **Step 2: Verify the DTO parses (existing + new)**

Run: `npx vitest run tests/integration/security-fixes.test.ts -t "catalogue exposes" && npm run typecheck`
Expected: PASS / no type errors. (The `catalogue exposes…` test from Task 1 already asserts the raw RPC shape; this step confirms the Zod type compiles and non-vehicle activities still parse with `vehiclePricing` absent.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/validation/tours.ts
git commit -m "feat(pricing): expose vehiclePricing config on the tour detail DTO"
```

---

## Task 4: Client pricing mirror + booking widget + cart + checkout + card

**Files:**
- Modify: `src/lib/services/pricing.ts` (add `sightseeingQuote` + bands; remove `pickVehicleBracket`/`maxVehicleCapacity`)
- Modify: `tests/unit/pricing.test.ts` (replace the bracket tests)
- Modify: `src/components/gyg/detail/BookingWidget.tsx` (vehicle UX)
- Modify: `app/activities/[slug]/page.tsx` (pass `vehiclePricing`)
- Modify: `src/lib/cart/useCart.ts` (`CartItem.suv`)
- Modify: `src/components/checkout/Checkout.tsx` (forward `suv`)
- Modify: `src/components/gyg/PlaceCard.tsx` (unit label — verify, no change needed)

- [ ] **Step 1: Replace the pricing unit tests (failing first)**

In `tests/unit/pricing.test.ts`, change the import line to drop the removed helpers and add the new one:

```ts
import { centsToEur, eurToCents, quoteTotal, sightseeingQuote } from '@/lib/services/pricing';
```

Delete the `VEHICLE_BRACKETS` const and the entire `describe('pickVehicleBracket / maxVehicleCapacity', …)` block, and add:

```ts
const SIGHTSEEING = { perBlockEur: 70, suvFlatEur: 85, blockSize: 4, maxParty: 25 };

describe('sightseeingQuote', () => {
  it('charges €70 per block of 4, named by party size', () => {
    const cases: Array<[number, string, number]> = [
      [1, 'Sedan', 70],
      [4, 'Sedan', 70],
      [5, 'Family car', 140],
      [6, 'Family car', 140],
      [7, 'Minibus', 140],
      [8, 'Minibus', 140],
      [9, 'Minibus', 210],
      [12, 'Minibus', 210],
      [13, 'Minibus', 280],
      [14, 'Minibus', 280],
      [15, 'Coaster', 280],
      [20, 'Coaster', 350],
      [24, 'Coaster', 420],
      [25, 'Coaster', 490],
    ];
    for (const [people, vehicle, total] of cases) {
      const q = sightseeingQuote(people, false, SIGHTSEEING);
      expect(q.vehicle).toBe(vehicle);
      expect(q.totalEur).toBe(total);
    }
  });

  it('applies the flat €85 SUV upgrade only for parties of 1–4', () => {
    expect(sightseeingQuote(2, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(4, true, SIGHTSEEING)).toEqual({ vehicle: 'SUV', totalEur: 85 });
    expect(sightseeingQuote(5, true, SIGHTSEEING)).toEqual({ vehicle: 'Family car', totalEur: 140 });
  });

  it('throws above the cap and below 1', () => {
    expect(() => sightseeingQuote(26, false, SIGHTSEEING)).toThrow(ServiceError);
    expect(() => sightseeingQuote(0, false, SIGHTSEEING)).toThrow(ServiceError);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`sightseeingQuote` not exported)**

Run: `npx vitest run tests/unit/pricing.test.ts`
Expected: FAIL — `sightseeingQuote is not a function` / import error.

- [ ] **Step 3: Rewrite the vehicle helpers in `pricing.ts`**

In `src/lib/services/pricing.ts`, replace the `VehicleBracket` interface and the `pickVehicleBracket` + `maxVehicleCapacity` functions (current lines ~110–136) with:

```ts
export interface SightseeingPricing {
  /** €70 per block of `blockSize` people. */
  perBlockEur: number;
  /** Flat SUV upgrade price for parties of 1..blockSize. */
  suvFlatEur: number;
  blockSize: number;
  maxParty: number;
}

/** Sensible defaults if the catalogue config hasn't loaded — mirrors the migration's seed row. */
export const SIGHTSEEING_DEFAULT: SightseeingPricing = {
  perBlockEur: 70,
  suvFlatEur: 85,
  blockSize: 4,
  maxParty: 25,
};

/** Vehicle name by party size. NAME only — the price comes from the per-block rule. MUST mirror the
 *  SQL `CASE` in create_booking (Sedan ≤4, Family car ≤6, Minibus ≤14, Coaster ≤25). */
export const VEHICLE_BANDS: ReadonlyArray<{ max: number; name: string }> = [
  { max: 4, name: 'Sedan' },
  { max: 6, name: 'Family car' },
  { max: 14, name: 'Minibus' },
  { max: 25, name: 'Coaster' },
];

export interface SightseeingQuote {
  vehicle: string;
  totalEur: number;
}

/**
 * Sightseeing price for a party: €70 × ceil(people / 4), or the flat SUV price for parties of 1..4
 * when `suv` is set. The DB (`create_booking`) is authoritative; this mirrors it for the widget and
 * unit tests. Throws outside 1..maxParty.
 */
export function sightseeingQuote(people: number, suv: boolean, cfg: SightseeingPricing): SightseeingQuote {
  if (!Number.isInteger(people) || people < 1 || people > cfg.maxParty) {
    throw new ValidationError(`Party of ${people} is outside 1–${cfg.maxParty}`);
  }
  if (people <= cfg.blockSize && suv) {
    return { vehicle: 'SUV', totalEur: cfg.suvFlatEur };
  }
  const band = VEHICLE_BANDS.find((b) => people <= b.max) ?? VEHICLE_BANDS[VEHICLE_BANDS.length - 1]!;
  const blocks = Math.ceil(people / cfg.blockSize);
  return { vehicle: band.name, totalEur: cfg.perBlockEur * blocks };
}
```

- [ ] **Step 4: Run the unit tests — expect PASS**

Run: `npx vitest run tests/unit/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the vehicle UX in `BookingWidget.tsx`**

Make these exact edits in `src/components/gyg/detail/BookingWidget.tsx`:

(a) Imports — replace the pricing import:

```ts
import { sightseeingQuote, SIGHTSEEING_DEFAULT } from '@/lib/services/pricing';
import type { PricingMode, TourOption, VehiclePricing } from '@/lib/validation/tours';
```
(Remove `maxVehicleCapacity, pickVehicleBracket` and the separate `PricingMode, TourOption` import line — fold `VehiclePricing` in.)

(b) Props — add `vehiclePricing` to the destructured params and the prop type:

```ts
  pricingMode = 'per_person',
  vehiclePricing = null,
  image = null,
}: {
  slug: string;
  type: TourType;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
  title: string;
  pricingMode?: PricingMode;
  /** Global sightseeing config (vehicle mode only). Falls back to SIGHTSEEING_DEFAULT. */
  vehiclePricing?: VehiclePricing | null;
  image?: string | null;
}) {
```

(c) Add an `suv` state next to the other `useState`s:

```ts
  const [suv, setSuv] = useState(false);
```

(d) Replace the vehicle-bracket derivations (current block "Vehicle pricing: the cheapest option's price rows…" through `bookingLabel`, ~lines 119–134) with a config-driven version. Also define a `bookingOptionId` that works WITHOUT price rows:

```ts
  // Vehicle mode prices from the global config (no per-tour price rows). The bookable option is just
  // the activity's option; availability is fetched against it.
  const vcfg = vehiclePricing ?? SIGHTSEEING_DEFAULT;
  const maxCap = isVehicle ? vcfg.maxParty : 0;
  const bookingOptionId = isVehicle ? (options[0]?.id ?? null) : (cheapest?.optionId ?? null);
  const suvActive = isVehicle && suv && participants <= vcfg.blockSize;
  const vehicleQuote = isVehicle
    ? sightseeingQuote(Math.min(Math.max(participants, 1), vcfg.maxParty), suvActive, vcfg)
    : null;
  const bookingLabel = (isVehicle ? vehicleQuote?.vehicle : cheapest?.label) ?? cheapest?.label ?? 'Vehicle';
```

(e) `unitLabel` — vehicle stays `'per vehicle'`; no change needed beyond it already keying on `isVehicle`.

(f) Availability effect — change the guard + filter from `cheapest` to `bookingOptionId`:
- Replace `if (!cheapest) {` with `if (!bookingOptionId) {`.
- Replace `if (s.activityOptionId !== cheapest.optionId) continue;` with `if (s.activityOptionId !== bookingOptionId) continue;`.
- Change the effect dep `cheapest?.optionId` → `bookingOptionId`.

(g) `maxParticipants` — the vehicle branch already uses `maxCap`; keep. But it currently relies on `maxCap` from `maxVehicleCapacity`; now `maxCap = vcfg.maxParty`. Good.

(h) `total` — replace the `isVehicle ? (selectedBracket?.amountEur ?? null)` arm with `isVehicle ? (vehicleQuote?.totalEur ?? null)`.

(i) `pickDate` vehicle clamp — replace `Math.max(1, maxCap)` usage stays valid (maxCap now = 25).

(j) The vehicle chip block (`{isVehicle && selectedBracket && ( … )}`) — replace with:

```tsx
        {isVehicle && vehicleQuote && (
          <div className="mt-3.5 space-y-2.5">
            {participants <= vcfg.blockSize && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSuv(false)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
                    !suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
                  }`}
                >
                  Sedan · {eur(vcfg.perBlockEur)}
                </button>
                <button
                  type="button"
                  onClick={() => setSuv(true)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${
                    suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'
                  }`}
                >
                  SUV · {eur(vcfg.suvFlatEur)}
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] font-semibold text-teal-dark">
              <IconUsers width={15} height={15} className="text-teal" />
              {vehicleQuote.vehicle} · for {participants} {participants === 1 ? 'passenger' : 'passengers'}
            </div>
          </div>
        )}
```

(k) The "more than {maxCap}" contact link block — keep; `maxCap` is now 25. (No change.)

(l) Checkout query (`goToCheckout`) — add `suv` to the params:

```ts
      guests: String(participants),
      unit: unitLabel,
      suv: suvActive ? '1' : '0',
    });
```

(m) `handleAddToCart` — add `suv: suvActive` to the cart item and keep `unitEur` flat:

```ts
      unitEur: isVehicle ? (vehicleQuote?.totalEur ?? 0) : cheapest.amountEur,
      pricingMode,
      suv: suvActive,
      maxGuests: isVehicle ? maxCap : cheapest.maxGuests,
```

(Also: anywhere `goToCheckout`/`handleAddToCart` early-return on `!cheapest`, change to allow vehicle mode — guard on `bookingOptionId` instead. Concretely, in both handlers replace `if (!selected || !cheapest)` with `if (!selected || !bookingOptionId)`.)

- [ ] **Step 6: Pass `vehiclePricing` from the detail page**

In `app/activities/[slug]/page.tsx`, in the `<BookingWidget … />` props (after `pricingMode={activity.pricingMode}`):

```tsx
                vehiclePricing={activity.vehiclePricing}
```

- [ ] **Step 7: Add `suv` to the cart item**

In `src/lib/cart/useCart.ts`, in the `CartItem` interface (after `pricingMode: PricingMode;`):

```ts
  /** Vehicle mode: the SUV upgrade was chosen (display only; price is already in unitEur). */
  suv?: boolean;
```

- [ ] **Step 8: Forward `suv` from checkout**

In `src/components/checkout/Checkout.tsx`:
- After the other `params.get(...)` reads add:
```ts
  const suv = params.get('suv') === '1';
```
- In the `POST /api/v1/bookings` body (the `JSON.stringify({ … })`), after `party: { [label]: qty },` add:
```ts
            suv,
```

- [ ] **Step 9: Verify card unit label (no code change expected)**

`src/components/gyg/PlaceCard.tsx` already renders `'per vehicle'` for `pricingMode === 'vehicle'` and "From €{fromPriceEur}" (= €70 from the API). Confirm by reading lines ~40–48 and ~116–120; only change if it references a removed helper (it does not).

- [ ] **Step 10: Typecheck + lint + unit tests**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/pricing.test.ts`
Expected: no type/lint errors; unit tests PASS. Fix any remaining references to `pickVehicleBracket`/`maxVehicleCapacity`/`selectedBracket`/`brackets`/`vehicleOption` in `BookingWidget.tsx` (grep for them — all must be gone).

- [ ] **Step 11: Commit**

```bash
git add src/lib/services/pricing.ts tests/unit/pricing.test.ts src/components/gyg/detail/BookingWidget.tsx app/activities/[slug]/page.tsx src/lib/cart/useCart.ts src/components/checkout/Checkout.tsx
git commit -m "feat(pricing): sightseeing vehicle widget — €70/4 + SUV toggle, contact-us at 25"
```

---

## Task 5: Admin form — global-pricing copy, drop the per-tour bracket prefill

**Files:**
- Modify: `src/components/admin/ActivityForm.tsx`

- [ ] **Step 1: Replace the vehicle help text + remove the bracket prefill**

In `src/components/admin/ActivityForm.tsx`:

(a) Delete the `STANDARD_VEHICLE_BRACKETS` const and the `withStandardVehicleBrackets` function (current lines ~21–34) — vehicle pricing is global now.

(b) In the Pricing `<Field>`, change the vehicle-mode help text and remove the prefill button. Replace the help `<p>`'s vehicle arm and the `{v.pricingMode === 'vehicle' && … Use standard vehicle brackets … }` button block with:

```tsx
            <p className="mt-1.5 text-[12px] text-ink-muted">
              {v.pricingMode === 'vehicle'
                ? 'Sightseeing vehicle pricing is global: €70 per 4 people, with a flat €85 SUV upgrade for parties of 1–4, capped at 25. It applies to every vehicle-priced tour — no per-tour price tiers needed. Change it once in the sightseeing_pricing table.'
                : v.pricingMode === 'per_group'
                  ? 'The price buys one group of up to “fits up to” people; bigger parties pay for extra groups (ceil(people / size) × price).'
                  : 'Each guest pays the tier price. “Fits up to” is an optional hard cap per tier.'}
            </p>
```

(c) In the "Options & pricing" `<Section>`, gate the price-tier editor so vehicle mode shows a note instead (the global rule ignores per-tour tiers). Wrap the `<OptionsEditor …/>` so that when `v.pricingMode === 'vehicle'` it renders a short note; otherwise the editor. Minimal version — replace the `<OptionsEditor … />` line with:

```tsx
        {v.pricingMode === 'vehicle' ? (
          <p className="rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
            Vehicle-priced tours use the global sightseeing rule (€70 per 4 · €85 SUV · max 25). Add a
            single option (e.g. “Sightseeing”) so dates can be scheduled — no price tiers required.
          </p>
        ) : (
          <OptionsEditor options={v.options} onChange={(x) => set('options', x)} />
        )}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors (no dangling references to the removed const/function).

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ActivityForm.tsx
git commit -m "feat(admin): vehicle mode uses global sightseeing pricing (no per-tour tiers)"
```

---

## Task 6: Catch-up SQL, regenerate artifacts, full green gate

**Files:**
- Create: `supabase/catch-up-2026-06-17-sightseeing-pricing.sql`
- Regenerate: `supabase/setup.sql`, `openapi.json` (+ `supabase/seed.sql` if it changes)
- Modify: `memory/gytm-db-sync.md` (note the new catch-up file)

- [ ] **Step 1: Write the idempotent catch-up file**

Create `supabase/catch-up-2026-06-17-sightseeing-pricing.sql` with this exact content: a `begin;` / `commit;` wrapper around the **identical statements** from `supabase/migrations/20260617130000_sightseeing_vehicle_pricing.sql` (every statement there is already idempotent — `create table if not exists`, `insert … on conflict do nothing`, `enable row level security` (no-op if on), `drop function if exists`, `create or replace`). Header:

```sql
-- ============================================================================
-- Belle Mare Tours — sightseeing vehicle-pricing catch-up (2026-06-17)
-- Brings an ALREADY-LIVE DB to the global sightseeing rule: €70 per 4 people,
-- flat €85 SUV (≤4), capped at 25. Idempotent — safe to run more than once.
-- Assumes the DB is current through the 2026-06-17 bug-fix catch-up.
-- ============================================================================
begin;

-- (paste the full body of migrations/20260617130000_sightseeing_vehicle_pricing.sql here)

commit;
```

- [ ] **Step 2: Regenerate the generated artifacts**

Run: `npm run setup:sql ; npm run openapi:write`
Then `git status` — review the diffs to `supabase/setup.sql` and `openapi.json` (the new migration + the `vehiclePricing` DTO). They must be regenerated, never hand-edited.

- [ ] **Step 3: Full green gate**

Stop any running dev preview first (the Windows build clobbers the dev `.next`). Then:

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 4: Update the DB-sync memory note**

In `memory/gytm-db-sync.md`, add a line under the catch-up guidance noting that the latest dated catch-up is `catch-up-2026-06-17-sightseeing-pricing.sql` (global sightseeing pricing), and the pattern is now one dated, idempotent catch-up file per batch (not only `catch-up.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/catch-up-2026-06-17-sightseeing-pricing.sql supabase/setup.sql openapi.json supabase/seed.sql memory/gytm-db-sync.md
git commit -m "chore(db): catch-up + regenerated artifacts for sightseeing vehicle pricing"
```

---

## Self-Review

**Spec coverage:**
- Rule (€70/4 + €85 SUV ≤4, cap 25) → Task 1 `create_booking`, Task 4 `sightseeingQuote`. ✓
- `sightseeing_pricing` config + RLS → Task 1. ✓
- `pricing_mode='vehicle'` trigger, no price rows → Task 1 (`create_booking` reads config, not rows), Task 5 (admin). ✓
- `booking_items.pax`, quantity=1 (vehicles) → Task 1 (already-present column; insert sets pax=P, quantity=1). ✓
- `api_book` + `p_suv`, one-vehicle hold, F23/F25 preserved → Task 1, Task 2 (service thread), Task 4 (checkout). ✓
- Catalogue returns config + `fromPriceEur=70` → Task 1, Task 3 (DTO). ✓
- Widget 1–25, Sedan/SUV toggle, contact-us at cap → Task 4. ✓
- Voucher "12 passengers · Minibus" → unchanged `booking_json`/`coalesce(pax,quantity)` already in place; `price_label` now the vehicle name (Task 1). ✓
- Tests (1→€70 … 25→€490, 26→reject, capacity-as-vehicles, SUV) → Task 1 + Task 4. ✓
- catch-up.sql append → Task 6 (new dated file, per evolved pattern). ✓

**Placeholder scan:** None — every step has concrete code/commands. The one "paste the body" instruction (Task 6 Step 1) is a deterministic copy of a fully-specified file, not a TBD.

**Type/name consistency:** `sightseeingQuote(people, suv, cfg)` returns `{ vehicle, totalEur }` — used identically in widget + tests. `VehiclePricing` (Zod, tours.ts) is structurally identical to `SightseeingPricing` (pricing.ts), so passing `activity.vehiclePricing` into `sightseeingQuote` typechecks. `create_booking` 8th arg `p_suv` matches the `$4` positional in tests and the `v_suv` pass-through in `api_book`. `price_label` vehicle names (`Sedan`/`Family car`/`Minibus`/`Coaster`/`SUV`) match between the SQL `CASE` and `VEHICLE_BANDS` + the SUV branch.

**Risk to watch during execution:** `BookingWidget` currently hard-depends on `cheapest` (a price row) for availability + booking; Task 4 step (d)/(f) introduces `bookingOptionId` so vehicle tours (no price rows) still fetch availability and book. Grep the file after editing to ensure no `cheapest.`-based guard blocks vehicle mode.
