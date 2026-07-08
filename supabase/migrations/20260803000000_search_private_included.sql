-- Listing cards for a private-only activity showed the "From €X" price but no group size, because
-- the private "base covers up to N guests" count (private_included) wasn't surfaced. A private option's
-- pricing_mode is still per_person (privateness is per-OPTION), so the card can't infer it from the mode.
-- This re-applies the winning api_search_activities body VERBATIM (from 20260802000000_from_price_private_base.sql)
-- with ONE additive output key: `fromPriceIncluded` = the cheapest private option's private_included,
-- emitted ONLY when the from-price came from a private base (no tier prices) — so a card can show
-- "from €650 · up to 4". Null for every non-private activity, so no other card changes.
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
        else coalesce(
          (
            select (case when bool_or(pr.min_age is not null or pr.max_age is not null) then max(pr.amount_minor) else coalesce(min(pr.amount_minor) filter (where pr.amount_minor > 0), min(pr.amount_minor)) end)
            from activity_option_prices pr
            join activity_options o on o.id = pr.activity_option_id
            where o.activity_id = a.id
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
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
    select * from filtered
    where (p ->> 'priceMin' is null or from_price_minor >= (p ->> 'priceMin')::numeric * 100)
      and (p ->> 'priceMax' is null or from_price_minor <= (p ->> 'priceMax')::numeric * 100)
  ),
  paged as (
    select * from priced
    order by sort, rating_count desc, title
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
        'fromPriceIncluded', case
          when x.pricing_mode = 'vehicle'
            or exists (
              select 1 from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = x.id
            ) then null
          else (
            select o.private_included
            from activity_options o
            where o.activity_id = x.id and o.private_base_minor is not null
            order by o.private_base_minor asc
            limit 1
          )
        end,
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
