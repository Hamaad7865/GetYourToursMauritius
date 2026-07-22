# Belle Mare activities showcase — design

## Goal

The owner wants `/things-to-do-in-belle-mare` (already the deliberate exact-match page for "Belle Mare
activities" / "Belle Mare things to do" — see [349e8a0](../../..)) to feature a real, beautiful,
card-based showcase of the activities that are genuinely _of_ Belle Mare / the east coast, separate from
the general island-wide `/activities` catalogue. This is a content/UX enhancement to an existing page,
**not** a new URL — a new page targeting the same query would cannibalize this one on a domain with
near-zero authority (standing decision, see memory `gytm-seo-targets`).

No ranking outcome is promised. This spec covers on-page SEO (natural keyword coverage across headings,
alt text, and FAQ copy) and content quality — not guaranteed placement, which also depends on off-page
factors (backlinks, GBP, indexing) outside this page's control.

## Background

- `activities.region` (`East`/`West`/`North`/`South`/`Central`) already exists, added for the
  region-based transport-pricing add-on ([20260720000000_activity_transport_pricing.sql](../../../supabase/migrations/20260720000000_activity_transport_pricing.sql)). It is only
  populated today for `per_person`/`per_group` activities — `vehicle`-priced tours (Private/Taxi
  Sightseeing) were intentionally skipped since region didn't affect their pricing.
- `api_search_activities` and `tourSummarySchema` do not currently expose `region` in list/search
  results (only `api_get_activity`, the single-activity detail, does).
- Live catalogue query (2026-07-22) of published, non-planner activities by category/region:

  | Category                 | Region                   | Count            |
  | ------------------------ | ------------------------ | ---------------- |
  | Catamaran cruises        | East                     | 1                |
  | Private Cruises          | East                     | 3                |
  | Private Cruises          | _(null)_                 | 7                |
  | Speedboat Tours          | East                     | 2                |
  | Hiking & Land Adventures | East                     | 1                |
  | Taxi Sightseeing tours   | _(null, vehicle-priced)_ | 7                |
  | _(other categories)_     | West / North / South     | — (out of scope) |

  Of the 7 null-region Private Cruises, 2 have `location = 'East'` already set (both are Île aux Cerfs
  speedboat trips from Trou d'Eau Douce) — a safe, zero-guess backfill source.

## Decisions made (via brainstorming + visual review)

1. **One page, enhanced** — not a new URL. Resolves the cannibalization risk by construction.
2. **Inclusion rule**: an activity appears on this page if `region = 'East'` **or**
   `category = 'Taxi Sightseeing tours'` (every sightseeing tour, regardless of region — it's a flagship
   product line the owner explicitly wants included regardless of which part of the island it explores).
3. **Region backfill**: idempotent migration sets `region = location` for null-region Private Cruises,
   but only where `location` already holds a canonical region word (`North|East|South|West|Central`) — no
   guessing from free-text prose. **Correction (post-ship review, 2026-07-22): all 7 previously-null rows
   had a canonical `location` value, so the backfill fills all 7** (2 → East, 2 → North, 3 → West), not
   just the 2 Île aux Cerfs ones as originally written here — an inaccuracy in this doc, not in the SQL.
   The 5 non-East rows are still correctly excluded from _this page_ by the `region = 'East'` filter; the
   backfill itself is a general-purpose, page-agnostic fill of the column and is a net improvement for the
   region-based transport-pricing feature that owns it (`src/lib/services/pricing.ts`,
   `supabase/migrations/20260720000000_activity_transport_pricing.sql`), which now has real data instead
   of nulls for these rows too.
4. **Layout — grouped by theme** (chosen over a flat grid or a hero-led single grid): matching activities
   split into labelled sections so the page reads as a curated guide, not a filtered catalogue dump:
   - **"Boat trips & Île aux Cerfs"** — Catamaran cruises + Private Cruises + Speedboat Tours (East) = 8
   - **"Sightseeing & day tours"** — all Taxi Sightseeing tours = 7
   - **"More ways to explore"** — catch-all for any other East-tagged activity not in a named group above
     (currently: 1 Hiking & Land Adventures). A group renders only when non-empty, so this scales
     gracefully as the catalogue changes without needing a code change for every new category.
5. **Placement**: the grouped showcase moves to directly after the page's intro section, ahead of all
   existing editorial prose (beach/lagoon, Île aux Cerfs, day trips, getting around) — those become
   supporting content below the fold instead of surrounding a buried 6-card strip. The old single
   unfiltered `<FeaturedTours limit=6>` call is removed, superseded by the grouped sections.

## Implementation

### Data layer

- New migration `supabase/migrations/<ts>_belle_mare_grouping.sql` (mirrored into `catch-up.sql` per the
  DB-sync convention — not applied directly to the live DB from this session):
  - `update activities set region = location where category = 'Private Cruises' and pricing_mode =
'per_person' and region is null and location in ('North','East','South','West','Central');`
- Extend `api_search_activities` (latest body in `supabase/setup.sql`) to accept an optional `region`
  filter in `p`. **Carry forward the full current body** (banded pricing logic, `is_custom_planner`
  exclusion, sort, `minAdvanceDays`, etc.) — do not simplify/rewrite, per the migration-revert-drift
  lesson (a prior incident where a partial redefinition silently dropped an earlier guard). `region` is
  a filter input only — nothing downstream needs it back on each result (the grouping logic only reads
  `category`), so it is **not** added to the output JSON or to `tourSummarySchema` (YAGNI).
- Extend `searchToursQuerySchema` ([tours.ts](../../../src/lib/validation/tours.ts)) with an optional
  `region` field, and forward it through in `searchActivities` ([activities.ts](../../../src/lib/services/activities.ts)).
- **Known trade-off (flagged twice in review, not fixed — documenting instead):** the filter compares the
  raw `a.region` column only. Every other RPC touching this column (`api_get_activity`, `api_book`, the
  transport-pricing path) reads `coalesce(a.region, region_from_coords(a.lat, a.lng))` instead — the admin
  form's "Auto (from map coordinates)" option for this field only works through that coalesced read. Today
  this is a no-op (every activity has `lat`/`lng = null`), so there's no live bug. But the next East-coast
  activity added with a map pin and "Auto" left selected will correctly resolve to East everywhere else
  (detail page, transport fare, AI planner) while silently never appearing on this showcase, since this
  filter alone won't see it. Left as a known gap rather than fixed, since matching the coalesced form here
  would need its own migration + test cycle for a currently-hypothetical case — revisit if/when the admin
  team starts using map-pin-based regions.

### Grouping helper

- New exported function `belleMareActivityGroups()` in `src/lib/seo/landing.ts` (alongside the existing
  `featuredActivities()` — same "SEO landing page support" home) that:
  1. Calls `searchActivities` once with `{ region: 'East', pageSize: 100 }` and once with
     `{ category: 'Taxi Sightseeing tours', pageSize: 100 }`.
  2. Buckets the East results into the named groups by category membership; anything left over becomes
     "More ways to explore"; the sightseeing call is its own group.
  3. Returns `{ title, activities }[]`, omitting empty groups.
- **No new card/grid component** — each group renders via the existing `<FeaturedTours title intro
activities>` ([LandingSections.tsx](../../../src/components/seo/LandingSections.tsx)), which already
  wraps `ActivityGrid`/`ActivityCard` and no-ops on an empty list. Visual consistency with the rest of the
  site is deliberate — the "beautiful" upgrade comes from decluttering, grouping, and prominence, not a
  new card design.

### Page (`app/(site)/things-to-do-in-belle-mare/page.tsx`)

- Fetch the groups server-side; render them right after the intro `ContentSection`.
- Each group gets a natural-language intro line reinforcing target phrases without stuffing (e.g. "Boat
  trips & Île aux Cerfs" section intro mentions "from Belle Mare" / "east coast" once, naturally).
- `itemListJsonLd` is built from the full flattened set across all groups (~16 items) instead of the old
  fixed 6.
- Existing breadcrumb + FAQ JSON-LD, metadata (title/description/keywords already target this exact
  query), and all other prose sections are unaffected.

### On-page SEO (natural, not stuffed)

- Group headings and section intros use real variations of the target phrases across H2s and body copy
  (already-established house pattern elsewhere on this page) — no repeated-keyword blocks, no hidden
  text, no off-topic phrase lists.
- Image alt text on cards already comes from each activity's own `heroImage.alt` — no change needed.
- No change to `<title>`/meta description — already optimized for this query (see existing
  `DEFAULT_METADATA` in this file).

## Testing

- New unit test for the grouping helper (mock `searchActivities` responses covering: mixed categories,
  an item that would double-match, an empty catch-all) — follow the existing
  `tests/unit/landing.test.ts` pattern.
- Full local gate before considering this done: typecheck, lint, full test suite, turbopack preview
  (confirm 3 groups render with real cards, ItemList count matches the rendered total, FAQ/breadcrumb
  unchanged).
- Owner action after merge: re-run `catch-up.sql` for the region backfill + updated `api_search_activities`
  to reach the live DB (standard rollout step for every migration in this project).

## Out of scope

- French-language version of this page (no `/fr/` routing exists anywhere on the site yet — separate,
  larger effort, already tracked elsewhere).
- Backfilling `region` for activities outside the 7 Private Cruises rows identified above — the other
  West/North/South-tagged activities are correctly excluded from this page and need no changes.
- Any change to `/activities` (the general catalogue) or its search UI/filters.
