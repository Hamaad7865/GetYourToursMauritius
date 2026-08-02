-- Activity map coordinates + summary exposure.
--
-- WHY: the planner map's "Our activities" layer piled every pin into a few spots (some in the sea).
-- 42 of 43 published activities had lat/lng NULL, so the layer fell back to its last resorts — the
-- first itinerary stop with coords, else a Google Places TEXT SEARCH of the marketing title ("Full
-- Day 5 Islands tour Ile Aux Cerfs with Lunch, East, Mauritius"), which lands wherever Google
-- guesses. The fix is data, not map code: give every activity its real departure/meeting point.
--
-- 1) Curated coordinates per slug — the operator's actual jetties/trailheads/bases, good to ~a few
--    hundred metres (same approach as scripts/geocode-transfer-hotels.ts for resorts; these places
--    are well-known and stable). Guarded with `lat is null`, so a re-run — or a later admin fine-tune
--    in /admin ("Map location") — is never overwritten (the airport-fare-reset rule: seeds must not
--    clobber tuned data). `custom-road-trip` is left NULL on purpose: it's the planner's own
--    island-wide product and is excluded from the map layer anyway.
--
-- 2) api_search_activities gains 'region', 'lat', 'lng' in each summary. The browse layer previously
--    resolved coords per activity via api_get_activity (+ rarely Places) — ~42 SEQUENTIAL round
--    trips on every cache rebuild, which is what made the "Our activities" toggle hang. With the
--    point on the summary itself, the whole layer is ONE RPC. The function body is the
--    20260901000600 definition verbatim (verified against the live DB before this migration was
--    written) with only those three fields added.

update activities as a
set lat = v.lat, lng = v.lng
from (
  values
    -- East — Trou d'Eau Douce jetty area (Ile aux Cerfs departures, fanned ~50–150 m so
    -- same-jetty pills don't stack into one point at island zoom)
    ('catamaran-cruise-ile-aux-cerfs', -20.2436, 57.7872),
    ('catapseed-5-islands', -20.2452, 57.7887),
    ('private-full-day-5-islands-tour-ile-aux-cerfs-with-lunch', -20.2444, 57.7879),
    ('private-full-day-catamaran-ile-aux-cerfs', -20.2428, 57.7868),
    ('private-full-day-cataspeed-ile-aux-cerfs', -20.2460, 57.7891),
    ('private-full-day-speed-boat-ile-aux-cerf-with-lunch', -20.2420, 57.7862),
    ('the-blue-cruise-ile-aux-cerfs-5-islands-visit', -20.2468, 57.7895),
    ('speed-boat-ile-aux-cerfs', -20.2412, 57.7856),
    ('seaplane', -20.2385, 57.7905),
    -- East — Belle Mare beach
    ('skydive', -20.1875, 57.7710),
    ('horse-back-riding-on-the-beach', -20.1932, 57.7738),
    ('underwater-sea-walk-excursion', -20.1905, 57.7726),
    -- North — Grand Baie / Sunset Boulevard departures
    ('catamaran-cruise-3-northern-island-adventure', -20.0104, 57.5789),
    ('catamaran-sunset-cruise', -20.0086, 57.5800),
    ('private-full-day-3-northern-island-speed-boat-with-lunch-bbq', -20.0072, 57.5814),
    ('private-full-day-3-northern-islands-adventure', -20.0060, 57.5824),
    ('flat-island-gabriel-island-and-the-gunners-coin-by-speedboat-exclusive-basis-only', -20.0050, 57.5834),
    ('scubadiving', -20.0095, 57.5760),
    -- North — coast + inland bases
    ('blue-safari-submarine-subscooter', -20.0310, 57.5530), -- Trou aux Biches coastal road
    ('helicotour', -20.0553, 57.5449),                       -- Triolet base
    ('visit-to-ambre-island-by-kayak', -20.0560, 57.6800),   -- St Antoine, Poudre d'Or
    ('north-beaches-tour', -20.0269, 57.5586),               -- Mont Choisy public beach
    ('north-tour', -20.1063, 57.5726),                       -- SSR Botanical Garden, Pamplemousses
    ('port-louis-city-tour', -20.1601, 57.4977),             -- Caudan Waterfront
    ('private-shopping-tour', -20.2247, 57.4930),            -- Bagatelle Mall
    -- West — Tamarin bay + Black River harbour
    ('western-cruise-catamaran', -20.3624, 57.3662),
    ('private-full-day-western-cruise-catamaran', -20.3615, 57.3670),
    ('deep-sea-fishing', -20.3600, 57.3655),
    ('swimming-with-dolphins', -20.3258, 57.3703),
    ('private-swimming-with-dolphins-only', -20.3247, 57.3712),
    ('encountering-the-whales-and-swim-with-dolphins-excursion', -20.3268, 57.3695),
    ('swimming-with-dolphins-benitier-island-speedboat-all-inclusive', -20.3240, 57.3720),
    ('private-full-day-dolphin-swimming-ile-aux-benitiers-with-lunch', -20.4266, 57.3629), -- La Gaulette
    ('casela-world-of-adventures', -20.2895, 57.4010),
    -- Centre / South
    ('hiking-at-the-tamarind-falls-7-cascade', -20.2926, 57.4888), -- Henrietta trailhead
    ('black-river-gorges-hiking', -20.4050, 57.4665),              -- Pétrin info centre
    ('hiking-le-morne', -20.4425, 57.3140),                        -- Le Morne trailhead
    ('la-vallee-des-couleurs-nature-park-2', -20.4700, 57.5520),   -- Chamouny
    ('tea-tasting-tour', -20.4400, 57.5210),                       -- Bois Chéri tea factory
    ('south-tour-mauritius', -20.5255, 57.5290),                   -- Gris Gris, Souillac
    ('private-south-east-tour', -20.4074, 57.7003)                 -- Mahébourg waterfront
) as v(slug, lat, lng)
where a.slug = v.slug
  and a.lat is null
  and a.lng is null;

-- ---------------------------------------------------------------------------
-- api_search_activities: the 20260901000600 locale-aware definition, with 'region'/'lat'/'lng'
-- added to each summary (see header). Everything else is unchanged — copied verbatim, per the
-- "a later migration must never silently revert an earlier one" rule.
-- ---------------------------------------------------------------------------
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
            -- Per-OPTION front price, then the cheapest across options: a banded option fronts its
            -- adult (max) tier; a plain option its cheapest non-free tier. Aggregating across the whole
            -- ACTIVITY made any age band inflate the headline to the priciest option's adult rate.
            select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)
            from (
              select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                     max(pr.amount_minor) as max_amt,
                     min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                     min(pr.amount_minor) as min_amt
              from activity_option_prices pr
              join activity_options o on o.id = pr.activity_option_id
              where o.activity_id = a.id
              group by pr.activity_option_id
            ) opt
          ),
          (
            select min(o.private_base_minor)
            from activity_options o
            where o.activity_id = a.id and o.private_base_minor is not null
          )
        )
      end as from_price_minor,
      t.title as translated_title,
      t.summary as translated_summary
    from activities a
    left join activity_translations t
      on t.activity_id = a.id
     and t.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
    -- Second, UNCONDITIONAL join to the French row, used only by the `q` predicate below. `t` above
    -- is locale-parameterized (it resolves to whichever locale was requested, defaulting to 'en' —
    -- which is usually NULL, since English content lives in the base `activities` columns, not an
    -- 'en' overlay row), so it cannot be relied on to hold French text for an English session. tf
    -- always holds the French overlay regardless of the requested locale, which is what lets the
    -- free-text search match French independently of the locale parameter. Same unique-key join
    -- (activity_id, locale), so it cannot fan out rows either.
    left join activity_translations tf
      on tf.activity_id = a.id
     and tf.locale = 'fr'::content_locale
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (p ->> 'region' is null or a.region = p ->> 'region')
      and (
        p ->> 'q' is null
        or a.title ilike '%' || (p ->> 'q') || '%'
        or coalesce(a.summary, '') ilike '%' || (p ->> 'q') || '%'
        or coalesce(tf.title, '') ilike '%' || (p ->> 'q') || '%'
        or coalesce(tf.summary, '') ilike '%' || (p ->> 'q') || '%'
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
        'id', x.id, 'slug', x.slug, 'type', x.type,
        'title', coalesce(x.translated_title, x.title),
        'summary', coalesce(x.translated_summary, x.summary),
        'category', x.category, 'location', x.location, 'durationMinutes', x.duration_minutes,
        'region', x.region, 'lat', x.lat, 'lng', x.lng,
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
