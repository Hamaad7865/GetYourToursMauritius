-- Catalogue filters + facets + a categories read RPC for the mobile filter sheet.
--
-- api_search_activities gains priceMin/priceMax (EUR), durationMin/durationMax (minutes) and minRating
-- filters. The per-row "from" price is computed once in the `filtered` CTE (reproducing the exact
-- displayed-price logic) so the price filter matches what the card shows, and the item builder reuses it.
-- The output shape is otherwise BYTE-IDENTICAL to the previous version, so existing consumers are
-- unaffected. (Re-applied verbatim into supabase/catch-up.sql to keep parity.)
create or replace function api_search_activities(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select a.*,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select min(pr.amount_minor)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
      and (p ->> 'durationMin' is null or coalesce(a.duration_minutes, 0) >= (p ->> 'durationMin')::int)
      and (p ->> 'durationMax' is null or coalesce(a.duration_minutes, 0) <= (p ->> 'durationMax')::int)
      and (p ->> 'minRating' is null or coalesce(a.rating_avg, 0) >= (p ->> 'minRating')::numeric)
  ),
  priced as (
    -- Compare on the raw from_price_minor: a NULL (unpriced activity) yields UNKNOWN under a price bound
    -- and is correctly dropped, rather than coalescing to 0 and slipping into a priceMax result.
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
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
        'minAdvanceDays', coalesce(x.min_advance_days, 1),
        'fromPriceEur', x.from_price_minor::float / 100,
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
    'total', (select count(*)::int from priced),
    'page', coalesce((p ->> 'page')::int, 1),
    'pageSize', coalesce((p ->> 'pageSize')::int, 20)
  );
$$;

-- GET /activities/facets — slider bounds (price/duration) for the q/category/type-scoped catalogue. Uses
-- the SAME from-price expression as search, and excludes the dedicated transfer products (kept off the
-- catalogue) so the bounds match what the list actually shows.
create or replace function api_search_facets(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select a.duration_minutes,
      case
        when a.pricing_mode = 'vehicle'
          then (select sedan_minor from sightseeing_pricing limit 1)
        else (
          select min(pr.amount_minor)
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
        )
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and a.slug <> all (array['airport-transfer', 'hotel-transfer'])
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
      )
  )
  select jsonb_build_object(
    'priceMinEur', (select min(from_price_minor)::float / 100 from scoped),
    'priceMaxEur', (select max(from_price_minor)::float / 100 from scoped),
    'durationMin', (select min(duration_minutes) from scoped),
    'durationMax', (select max(duration_minutes) from scoped)
  );
$$;

-- GET /categories — the active categories for the browse filter (mirror of the public categories read).
create or replace function api_list_categories(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', c.name, 'slug', c.slug, 'imageUrl', c.image_url
  ) order by c.position, c.name), '[]'::jsonb)
  from categories c
  where c.status = 'active';
$$;

grant execute on function api_search_facets(jsonb) to anon, authenticated, service_role;
grant execute on function api_list_categories(jsonb) to anon, authenticated, service_role;
