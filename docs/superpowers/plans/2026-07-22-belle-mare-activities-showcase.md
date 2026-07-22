# Belle Mare Activities Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/things-to-do-in-belle-mare`'s buried 6-card strip into a prominent, grouped, card-based showcase of the activities that are genuinely east-coast/Belle-Mare-based, with natural on-page SEO copy.

**Architecture:** A DB migration adds an optional `region` filter to the existing `api_search_activities` RPC and backfills `region` for 2 previously-untagged Île aux Cerfs trips. A new `belleMareActivityGroups()` helper in `src/lib/seo/landing.ts` fetches East-region activities plus all Sightseeing tours and buckets them into 3 named groups. The page renders each group with the existing `FeaturedTours` component (no new UI component) directly after its intro, ahead of the existing editorial prose.

**Tech Stack:** Next.js (App Router, edge runtime), Supabase Postgres (SQL functions via RPC), Zod validation, Vitest.

**Spec:** [docs/superpowers/specs/2026-07-22-belle-mare-activities-showcase-design.md](../specs/2026-07-22-belle-mare-activities-showcase-design.md)

---

### Task 1: Migration — `region` filter on `api_search_activities` + backfill

**Files:**

- Create: `supabase/migrations/20260824000000_belle_mare_activity_grouping.sql`
- Modify: `supabase/catch-up.sql` (append the same SQL at the end of the file)
- Modify: `supabase/setup.sql` (regenerated, not hand-edited)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260824000000_belle_mare_activity_grouping.sql`:

```sql
-- Belle Mare activities showcase: add an optional `region` filter to api_search_activities, and
-- backfill `region` for the 2 Île aux Cerfs Private Cruises rows that were missed by the original
-- transport-pricing backfill (seed-activity-regions.sql only covered a handful of categories).
-- See docs/superpowers/specs/2026-07-22-belle-mare-activities-showcase-design.md.

-- 1) Zero-guess backfill: only fills a NULL region with an ALREADY-canonical value copied from the
--    activity's own `location` field. Never invents a region from free-text prose. Idempotent — only
--    touches rows still NULL, so a re-run (or an admin edit in between) is never clobbered.
update activities
set region = location
where category = 'Private Cruises'
  and pricing_mode = 'per_person'
  and region is null
  and location in ('North', 'East', 'South', 'West', 'Central');

-- 2) api_search_activities: add an optional `region` filter so a page can show only activities from
--    one part of the island. `region` is a FILTER INPUT only — the output JSON is unchanged, since
--    nothing downstream needs region back on each result. Full body carried forward verbatim from its
--    prior definition in setup.sql, plus the single added filter line below — see the
--    migration-revert-drift lesson: a partial redefinition here would silently drop the banded-pricing
--    front price, the is_custom_planner exclusion, minAdvanceDays, or the sort order.
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
      end as from_price_minor
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and (p ->> 'category' is null or a.category::text = p ->> 'category')
      and (p ->> 'type' is null or a.type::text = p ->> 'type')
      and (p ->> 'region' is null or a.region = p ->> 'region')
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
```

- [ ] **Step 2: Append the same SQL to `catch-up.sql`**

Open `supabase/catch-up.sql`, go to the end of the file, and append the exact same SQL block from
Step 1 (the `update activities ...` statement followed by the full `create or replace function
api_search_activities` block), with the same leading comment. `catch-up.sql` is a flat, append-only,
idempotent replay script — no wrapping needed, just paste the block after the last statement.

- [ ] **Step 3: Regenerate `setup.sql`**

Run: `npm run setup:sql`
Expected: command exits 0 with no error output.

- [ ] **Step 4: Verify the regenerated file picked up the change**

Run: `grep -n "a.region = p ->> 'region'" supabase/setup.sql`
Expected: one match, inside the last (bottommost) `api_search_activities` definition in the file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260824000000_belle_mare_activity_grouping.sql supabase/catch-up.sql supabase/setup.sql
git commit -m "feat(db): add region filter to api_search_activities + backfill 2 Ile aux Cerfs trips"
```

---

### Task 2: TS query layer — `region` on `SearchToursQuery` + forwarded in `searchActivities`

**Files:**

- Modify: `src/lib/validation/tours.ts:219-231`
- Modify: `src/lib/services/activities.ts:37-59`

- [ ] **Step 1: Add `region` to `searchToursQuerySchema`**

In `src/lib/validation/tours.ts`, find:

```typescript
export const searchToursQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  type: tourTypeSchema.optional(),
  /** "From" price range in EUR (matched against the displayed fromPriceEur). */
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  /** Duration range in minutes. */
  durationMin: z.coerce.number().int().nonnegative().optional(),
  durationMax: z.coerce.number().int().nonnegative().optional(),
  /** Minimum average rating (0–5). */
  minRating: z.coerce.number().min(0).max(5).optional(),
});
```

Replace with (adds one field, `region`, right after `type`):

```typescript
export const searchToursQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  type: tourTypeSchema.optional(),
  /** Home/boarding region of the activity (East/West/North/South/Central) — e.g. the Belle Mare
   *  showcase filters to East. Not exposed in search results, filter-only. */
  region: z.enum(['North', 'East', 'South', 'West', 'Central']).optional(),
  /** "From" price range in EUR (matched against the displayed fromPriceEur). */
  priceMin: z.coerce.number().nonnegative().optional(),
  priceMax: z.coerce.number().nonnegative().optional(),
  /** Duration range in minutes. */
  durationMin: z.coerce.number().int().nonnegative().optional(),
  durationMax: z.coerce.number().int().nonnegative().optional(),
  /** Minimum average rating (0–5). */
  minRating: z.coerce.number().min(0).max(5).optional(),
});
```

- [ ] **Step 2: Forward `region` to the RPC call in `searchActivities`**

In `src/lib/services/activities.ts`, find:

```typescript
const data = await callRpc(ctx, 'api_search_activities', {
  q: query.q ?? null,
  category: query.category ?? null,
  type: query.type ?? null,
  priceMin: query.priceMin ?? null,
  priceMax: query.priceMax ?? null,
  durationMin: query.durationMin ?? null,
  durationMax: query.durationMax ?? null,
  minRating: query.minRating ?? null,
  page: query.page,
  pageSize: query.pageSize,
});
```

Replace with (adds one line, `region`, right after `type`):

```typescript
const data = await callRpc(ctx, 'api_search_activities', {
  q: query.q ?? null,
  category: query.category ?? null,
  type: query.type ?? null,
  region: query.region ?? null,
  priceMin: query.priceMin ?? null,
  priceMax: query.priceMax ?? null,
  durationMin: query.durationMin ?? null,
  durationMax: query.durationMax ?? null,
  minRating: query.minRating ?? null,
  page: query.page,
  pageSize: query.pageSize,
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/tours.ts src/lib/services/activities.ts
git commit -m "feat: add region filter to SearchToursQuery and searchActivities"
```

---

### Task 3: `belleMareActivityGroups()` grouping helper (TDD)

**Files:**

- Modify: `src/lib/seo/landing.ts` (add the new export)
- Modify: `tests/unit/landing.test.ts` (add the new describe block)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/landing.test.ts`, change the import line:

```typescript
const { featuredActivities } = await import('@/lib/seo/landing');
```

to:

```typescript
const { featuredActivities, belleMareActivityGroups } = await import('@/lib/seo/landing');
```

Then add this new `describe` block at the end of the file (after the closing `});` of the
`featuredActivities` describe block):

```typescript
describe('belleMareActivityGroups', () => {
  it('buckets East boat/cruise categories into "Boat trips & Île aux Cerfs"', async () => {
    searchActivities
      .mockResolvedValueOnce({
        items: [
          { slug: 'catamaran-east', category: 'Catamaran cruises' },
          { slug: 'speedboat-east', category: 'Speedboat Tours' },
        ],
        total: 2,
      }) // region: East
      .mockResolvedValueOnce({ items: [], total: 0 }); // category: Taxi Sightseeing tours
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Boat trips & Île aux Cerfs');
    expect(groups[0]!.activities).toHaveLength(2);
    expect(searchActivities.mock.calls[0]![1]).toMatchObject({ region: 'East' });
    expect(searchActivities.mock.calls[1]![1]).toMatchObject({
      category: 'Taxi Sightseeing tours',
    });
  });

  it('always includes Taxi Sightseeing tours as its own group, regardless of region', async () => {
    searchActivities
      .mockResolvedValueOnce({ items: [], total: 0 }) // region: East — none
      .mockResolvedValueOnce({
        items: [{ slug: 'south-tour', category: 'Taxi Sightseeing tours' }],
        total: 1,
      });
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Sightseeing & day tours');
    expect(groups[0]!.activities).toHaveLength(1);
  });

  it('puts an East activity outside the named categories into the "More ways to explore" catch-all', async () => {
    searchActivities
      .mockResolvedValueOnce({
        items: [{ slug: 'hiking-east', category: 'Hiking & Land Adventures' }],
        total: 1,
      })
      .mockResolvedValueOnce({ items: [], total: 0 });
    const groups = await belleMareActivityGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('More ways to explore');
  });

  it('omits every group when nothing matches (no blank sections)', async () => {
    searchActivities.mockResolvedValue({ items: [], total: 0 });
    const groups = await belleMareActivityGroups();
    expect(groups).toEqual([]);
  });

  it('never throws — a malformed catalogue response yields no groups', async () => {
    searchActivities.mockResolvedValue(null);
    await expect(belleMareActivityGroups()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/landing.test.ts`
Expected: FAIL — `belleMareActivityGroups` is not exported from `@/lib/seo/landing` (or `undefined is
not a function`).

- [ ] **Step 3: Implement `belleMareActivityGroups()`**

In `src/lib/seo/landing.ts`, add this below the existing `featuredActivities` function (keep the
existing function and its imports untouched):

```typescript
export interface ActivityGroup {
  title: string;
  intro: string;
  activities: TourSummary[];
}

const BOAT_TRIP_CATEGORIES = ['Catamaran cruises', 'Private Cruises', 'Speedboat Tours'];
const SIGHTSEEING_CATEGORY = 'Taxi Sightseeing tours';

/**
 * Belle Mare / east-coast activities, grouped for the /things-to-do-in-belle-mare showcase:
 * "Boat trips & Île aux Cerfs" (East-region boat/cruise categories), "Sightseeing & day tours"
 * (every Private Sightseeing tour, any region — a flagship product line included regardless of which
 * part of the island it explores), and a "More ways to explore" catch-all for anything else tagged
 * East. A group is omitted entirely when empty, so a future catalogue change never renders a blank
 * heading. Never throws — a catalogue/DB hiccup yields [] for that fetch, same convention as
 * featuredActivities above.
 */
export async function belleMareActivityGroups(): Promise<ActivityGroup[]> {
  const ctx = publicServiceContext();

  const fetchAll = async (query: {
    region?: string;
    category?: string;
  }): Promise<TourSummary[]> => {
    try {
      const { items } = await searchActivities(ctx, { ...query, page: 1, pageSize: 100 });
      return items;
    } catch (error) {
      console.error('[landing] belle mare catalogue fetch failed', error);
      return [];
    }
  };

  const [east, sightseeing] = await Promise.all([
    fetchAll({ region: 'East' }),
    fetchAll({ category: SIGHTSEEING_CATEGORY }),
  ]);

  const boatTrips = east.filter((a) => BOAT_TRIP_CATEGORIES.includes(a.category));
  const claimed = new Set(boatTrips.map((a) => a.id));
  const catchAll = east.filter((a) => !claimed.has(a.id));

  return [
    {
      title: 'Boat trips & Île aux Cerfs',
      intro:
        "Catamarans, speedboats and private cruises that depart the east coast — Belle Mare's classic day on the water.",
      activities: boatTrips,
    },
    {
      title: 'Sightseeing & day tours',
      intro:
        'Private, door-to-door day tours with pickup from your Belle Mare hotel — see the rest of Mauritius at your own pace.',
      activities: sightseeing,
    },
    {
      title: 'More ways to explore',
      intro: 'A few more east-coast experiences worth adding to your Belle Mare itinerary.',
      activities: catchAll,
    },
  ].filter((g) => g.activities.length > 0);
}
```

Note: `TourSummary` is already imported at the top of `landing.ts`; no new import needed for the
function body itself.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/landing.test.ts`
Expected: PASS — all tests in the file green, including the 5 new ones and the pre-existing
`featuredActivities` ones (unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo/landing.ts tests/unit/landing.test.ts
git commit -m "feat: add belleMareActivityGroups grouping helper"
```

---

### Task 4: Restructure `/things-to-do-in-belle-mare` to render the grouped showcase

**Files:**

- Modify: `app/(site)/things-to-do-in-belle-mare/page.tsx`

- [ ] **Step 1: Swap the import**

Find:

```tsx
import { featuredActivities } from '@/lib/seo/landing';
```

Replace with:

```tsx
import { belleMareActivityGroups } from '@/lib/seo/landing';
```

- [ ] **Step 2: Replace the data fetch + ItemList JSON-LD source**

Find:

```tsx
export default async function ThingsToDoInBelleMarePage() {
  const featured = await featuredActivities({ limit: 6 });

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Things to do in Belle Mare', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {featured.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            featured.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
          )}
        />
      )}
```

Replace with:

```tsx
export default async function ThingsToDoInBelleMarePage() {
  const groups = await belleMareActivityGroups();
  const allActivities = groups.flatMap((g) => g.activities);

  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Things to do in Belle Mare', path: PATH },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      {allActivities.length > 0 && (
        <JsonLd
          data={itemListJsonLd(
            allActivities.map((a) => ({ name: a.title, path: `/activities/${a.slug}` })),
          )}
        />
      )}
```

- [ ] **Step 3: Move the showcase up and make it grouped**

Find (currently right after the `"why"` ContentSection, well above the prose sections):

```tsx
<FeaturedTours
  title="Bookable Belle Mare activities"
  intro="Live tours and boat trips you can book right now — every one includes door-to-door pickup from Belle Mare hotels and villas."
  activities={featured}
/>
```

Replace with:

```tsx
{
  groups.map((group) => (
    <FeaturedTours
      key={group.title}
      title={group.title}
      intro={group.intro}
      activities={group.activities}
    />
  ));
}
```

(Leave every other section — `beach`, `ile-aux-cerfs`, `day-trips`, `getting-around`, `faq`, `book`,
and `EnquireRow` — exactly where they are; only the old single `FeaturedTours` call is replaced.)

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0, no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: all tests pass, including `tests/unit/landing.test.ts` from Task 3.

- [ ] **Step 6: Commit**

```bash
git add "app/(site)/things-to-do-in-belle-mare/page.tsx"
git commit -m "feat: group Belle Mare activities showcase by theme, move above the fold"
```

---

### Task 5: Manual verification in the browser preview

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server and open the page**

Run: `npm run dev`
Then navigate to `http://localhost:3000/things-to-do-in-belle-mare`.

- [ ] **Step 2: Confirm the grouped sections render**

Expected: "Boat trips & Île aux Cerfs" and "Sightseeing & day tours" sections render with real activity
cards (photo, category chip, rating, price) directly after the intro paragraph, before the "The beach &
the lagoon" prose section. A "More ways to explore" section renders too if any catch-all activity
exists at the time of testing.

- [ ] **Step 3: Confirm JSON-LD**

View page source (or use the browser's page-read tool) and confirm the `ItemList` JSON-LD script tag
lists every card actually rendered on the page (not just 6).

- [ ] **Step 4: Confirm the FAQ and breadcrumb are unchanged**

Scroll to the FAQ accordion near the bottom and confirm the same 6 questions from `FAQS` still render,
and the breadcrumb still reads "Home / Things to do in Belle Mare".

- [ ] **Step 5: Note the owner follow-up**

No commit for this task. In your final summary to the user, note that `supabase/catch-up.sql` needs to
be re-run against the live database before the region backfill and the new `region` filter take effect
in production (standard rollout step for every migration in this project).
