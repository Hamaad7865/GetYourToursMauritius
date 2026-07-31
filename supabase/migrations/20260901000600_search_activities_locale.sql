-- Re-apply the locale-aware api_search_activities.
--
-- WHY THIS EXISTS: migration 20260901000100 was created containing only api_get_activity, and was
-- deployed and recorded in supabase_migrations.schema_migrations by a push that happened while this
-- work was in progress. api_search_activities was then APPENDED to that same file afterwards. Since
-- the version was already recorded, `supabase db push` skipped the file entirely and the appended
-- function never reached production — so activity DETAIL pages resolved French while every card,
-- search result, home rail and "you might also like" row silently kept rendering English.
--
-- The rule this violated: a migration is immutable once it may have been applied. Never append to an
-- existing migration to add a function — always add a new migration. Nothing catches this, because
-- the file on disk is correct, catch-up.sql is correct, setup.sql is correct, and the ledger is
-- correct; only the live database disagrees.

-- The free-text `q` predicate matches BOTH a.title/a.summary (English) AND tf.title/tf.summary
-- (French — via a SECOND, unconditional join to locale = 'fr', see below), regardless of the
-- requested locale: place names and brand terms are shared across languages, so an English query
-- must keep working in a French session and vice versa. Matching both is strictly more useful than
-- gating the translated match behind locale = 'fr', and it keeps the predicate independent of the
-- locale parameter. The existing locale-parameterized `t` join (used for display) can't serve
-- double duty here: it resolves to whichever locale was requested, defaulting to 'en' — which is
-- NULL for almost every activity, since English content lives in the base `activities` columns,
-- not an 'en' overlay row — so it would silently fail to match French during an English session.
-- Ordering stays on the English `title` column — sorting by the translated title would be a
-- cosmetic nicety, not a defect, and isn't worth disturbing the pagination contract for.
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
