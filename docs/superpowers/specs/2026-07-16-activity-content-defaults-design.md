# Per-category standard content (admin-editable "shared defaults")

**Status:** approved design, ready for an implementation plan
**Date:** 2026-07-16

## Problem

Five content lists appear on an activity page: Highlights, What's included, Not included, What to
bring, Know before you go. Each activity can already set its own in `/admin`. On top of that, two
**shared default sets are hardcoded in the codebase**:

| File                             | Constants                                              | Applied to                                             |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `src/lib/content/sightseeing.ts` | `SIGHTSEEING_HIGHLIGHTS`, `SIGHTSEEING_IMPORTANT_INFO` | every activity with `pricingMode === 'vehicle'`        |
| `src/lib/content/catamaran.ts`   | `CATAMARAN_WHAT_TO_BRING`, `CATAMARAN_KNOW_BEFORE`     | every activity with `category === 'Catamaran cruises'` |

They are merged in `app/(site)/activities/[slug]/page.tsx` (~lines 144–167).

Three problems:

1. **Not editable.** Changing "carry cash for entrance fees" needs a developer and a deploy.
2. **Only two of nine categories get defaults**, and includes / not-included have **no** shared
   defaults at all.
3. **Highlights are silently replaced.** For any vehicle-priced tour the page renders
   `SIGHTSEEING_HIGHLIGHTS` _instead of_ the activity's own highlights, so whatever staff type into
   the Highlights box on those tours never appears. The box is a trap. (Replacement itself is correct
   — see "Why highlights replace" — but the silence is not; this spec fixes the silence in admin.)

## Goals

- The owner edits every standard set in `/admin`, no deploy.
- Standard content covers all five lists, including includes / not-included (new).
- Any category can have a standard set.
- **Day-one parity for every activity except two deliberate fixes** — see "Scope change: the exact
  delta". No activity changes by accident.

## Non-goals

- Per-activity assignment of an arbitrary set (rejected: another field to maintain on 46 activities).
- A snippet library that copies text into activities (rejected: no live link, edits don't propagate).
- Translating standard content (`activity_translations` is out of scope; defaults are English-only,
  matching the hardcoded sets they replace).
- Touching `api_get_activity` (see Read path).

## Decisions

| Decision         | Choice                                                    | Why                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope            | **By `activities.category`**                              | Categories are owner-managed and already the mental model.                                                                                                                                                                        |
| Vehicle rule     | **Dropped**                                               | `Taxi Sightseeing tours` is its own category (13 activities, 12 vehicle-priced), so a per-category set covers it. Keying off a _pricing_ field also swept in `Airport transfers` (2 activities, both `pricing_mode = 'vehicle'`). |
| Highlights       | **Replace** (shared wins), + an admin warning             | See "Why highlights replace" — merging them would actively make 9 live tours worse.                                                                                                                                               |
| Other four lists | **Merge: shared first, then the activity's own, deduped** | Exactly how What to bring / Know before you go already behave.                                                                                                                                                                    |
| Read path        | **New `api_content_defaults` RPC**                        | Avoids re-applying `api_get_activity` (the revert-drift landmine).                                                                                                                                                                |

Live category counts that informed the scoping decision (2026-07-16):

| Category                 | Activities | Vehicle-priced |
| ------------------------ | ---------- | -------------- |
| Taxi Sightseeing tours   | 13         | 12             |
| Private Cruises          | 10         | 0              |
| Speedboat Tours          | 6          | 0              |
| Hiking & Land Adventures | 6          | 0              |
| Sea & water activities   | 5          | 0              |
| Catamaran cruises        | 4          | 0              |
| Air activities           | 3          | 0              |
| Airport transfers        | 2          | 2              |
| Dolphin swims            | 1          | 0              |

Categories are owner-created free text — **not** the fixed list in `SITE.CATEGORIES` or the
`activity_category` enum. The design must not hardcode category names anywhere except the seed.

### Scope change: the exact delta

Swapping the sightseeing scope from `pricing_mode = 'vehicle'` to `category = 'Taxi Sightseeing tours'`
does **not** select the same activities. The two sets disagree on exactly three rows (verified against
live data, 2026-07-16). Both live changes are fixes, and there are no others:

| Δ     | Activity         | Category               | `pricing_mode`   | Status    | Verdict                                                                                                                                                                        |
| ----- | ---------------- | ---------------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loses | Airport Transfer | Airport transfers      | `vehicle`        | published | **Fix.** A transfer should not advertise "a fully flexible route — add, swap or skip stops on the day" or "entrance fees to attractions are not included".                     |
| Loses | Private Transfer | Airport transfers      | `vehicle`        | draft     | Not live; no visible change.                                                                                                                                                   |
| Gains | Custom Road Trip | Taxi Sightseeing tours | `vehicle_custom` | published | **Fix.** The AI road-trip product is the most sightseeing-like thing on the site, yet today gets none of the shared content because `=== 'vehicle'` excludes `vehicle_custom`. |

Every other activity renders exactly as it does today. **Verify these two published pages after
deploying**, since they are the only intended visual changes.

## Data model

New table, mirroring the shape of the other admin-tuned config tables:

```sql
create table activity_content_defaults (
  category       text primary key,     -- matches activities.category (free text, owner-managed)
  highlights     text[] not null default '{}',
  inclusions     text[] not null default '{}',
  exclusions     text[] not null default '{}',
  what_to_bring  text[] not null default '{}',
  important_info text[] not null default '{}',
  updated_at     timestamptz not null default now()
);
```

- No FK to `categories`: `activities.category` is free text with no FK either, so a text key keeps the
  two consistent. See "Category rename" below for the consequence.
- A category with no row simply has no shared content — the activity renders only its own lists.
- Column names mirror the existing field names: `important_info` is the DB name for the list the UI
  calls "Know before you go" and the code calls `extra.importantInfo`.

**RLS:** public read, staff-only write — the same shape as the other public-read config tables.

## Merge semantics

Semantics are **per field, fixed in code** — no per-set toggle UI.

**Includes, Not included, What to bring, Know before you go — merge:**

```
merged = [...shared, ...own.filter(x => !shared.includes(x))]
```

Shared lines lead, the activity's own follow, exact-string duplicates dropped. This is precisely
today's What-to-bring / Know-before-you-go behaviour, extended to Includes and Not-included (which
have no shared defaults today).

**Highlights — replace:** when the activity's category has a standard set with a non-empty
`highlights`, it replaces the activity's own. Unchanged from today.

Source of truth for both lives in `src/lib/catalogue/` (pure, unit-testable), not in the page.

### Why highlights replace

Merging highlights was the original decision. Live data killed it. The two lists are different
_kinds_ of content:

| Source                             | Example                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Shared (`SIGHTSEEING_HIGHLIGHTS`)  | "Private, air-conditioned vehicle with a professional English-speaking driver-guide — exclusively for your group, never shared." |
| Per-activity (currently invisible) | `Trou aux Biches Beach`, `Mont Choisy Beach`, `La Cuvette Beach`                                                                 |

The shared set is prose _operator promises_. The per-activity lists are **bare place names — the stops
each tour visits** (Chamarel Adventure Tour: `Trou aux Cerfs Volcano Crater`, `Grand Bassin`,
`Alexandra Falls & Black River Gorges`), which largely duplicate the Itinerary section already on the
page.

Merging would render six long prose sentences followed by five bare labels — incoherent — across **9
of 12** `Taxi Sightseeing tours` (44 hidden lines) and both `Airport transfers` (6 lines). It would
also break the day-one parity goal. So highlights keep replacing.

### The Highlights trap, fixed in admin

Replace means the Highlights box does nothing on those tours — the trap that motivated the original
merge decision. Fix it where it belongs, in the UI, not by degrading the page: when an activity's
category has a standard set with non-empty highlights, `ActivityForm` shows an inline notice on the
Highlights field ("This category's standard highlights replace anything here — edit them in
Content"). The box stops lying; no live page changes.

Those per-tour stop lists are left where they are. Migrating them into the Itinerary is a reasonable
follow-up, deliberately out of scope here.

## Read path

New RPC — small, additive, public-read:

```sql
create or replace function api_content_defaults(p jsonb default '{}'::jsonb)
returns jsonb ...
grant execute on function api_content_defaults(jsonb) to anon, authenticated, service_role;
```

Returns all rows (≤ ~10; the whole table is smaller than one activity payload), so the activity page,
and later any other page, can merge client-agnostically. Deliberately **not** folded into
`api_get_activity`: that function is huge and re-applied by many migrations, and re-applying it is the
documented revert-drift hazard.

Follows the `api_list_rental_vehicles` precedent for a public read: `security definer`,
`set search_path = public`, granted to `anon, authenticated, service_role`.

**Failure mode:** if the RPC errors (table missing pre-migration, DB blip), the page falls back to
empty defaults and renders the activity's own lists. The activity page must never fail because
standard content is unavailable.

## Admin module

New screen at `/admin/content`, in the sidebar under Categories.

- Lists every category from the `categories` table (not a hardcoded list), each showing whether it has
  a standard set.
- Selecting one edits five list-editors — the same add/remove row control already used for "What to
  bring" in `ActivityForm`.
- Save upserts the row; saving five empty lists deletes it (no empty rows accumulating).
- Restricted to staff/admin, consistent with the other admin screens. Note the `seo` role is
  deliberately RLS-locked out of most tables; standard content is catalogue copy, so it follows the
  same rule as the activity editor (staff/admin only).

Mirrors the structure of `AdminRentalFleet` / `AdminVehiclePricing`.

## Migration

`supabase/migrations/20260811000000_activity_content_defaults.sql`, appended byte-identically to the
end of `supabase/catch-up.sql`, then `npm run setup:sql` to regenerate `supabase/setup.sql`. The
catch-up-parity and setup-sql-parity tests enforce this. (`20260810000000` is already taken twice —
by `seo_module` and `telegram_owner_alerts` — so the next free stamp is `20260811000000`.)

Contents:

1. `create table if not exists activity_content_defaults (...)`
2. RLS: enable, public-read policy, staff-write policy.
3. `api_content_defaults` + grants.
4. **Seed today's hardcoded content, so nothing changes visually:**
   - `Taxi Sightseeing tours` ← `SIGHTSEEING_HIGHLIGHTS` (→ `highlights`) + `SIGHTSEEING_IMPORTANT_INFO` (→ `important_info`)
   - `Catamaran cruises` ← `CATAMARAN_WHAT_TO_BRING` (→ `what_to_bring`) + `CATAMARAN_KNOW_BEFORE` (→ `important_info`)
   - `on conflict (category) do nothing` — idempotent, and never stomps content the owner has since edited.

Then delete `src/lib/content/sightseeing.ts` and `src/lib/content/catamaran.ts`. The seed is the only
surviving copy of that text, which is the point: one source of truth, and it is now editable.

Both files are imported by exactly one consumer, `app/(site)/activities/[slug]/page.tsx` — the file
this change rewrites — so the deletion is clean. `isCatamaranCruise()` has a single caller (that same
page, line 148) and disappears with the hardcoded scoping it existed to express; nothing to re-home.

## Category rename ⚠️

`src/lib/admin/categories.ts:updateCategory` already re-points `activities.category` from the old name
to the new one **before** renaming the category row, deliberately: that ordering self-heals on retry,
whereas rename-first does not.

`activity_content_defaults.category` must be re-pointed **in the same block, with the same ordering**,
or a rename silently detaches a category from its standard content. This is the single most likely way
this feature rots.

## Testing

**Unit** (`src/lib/catalogue/`)

- merge: shared first, own appended, exact duplicates dropped
- empty shared → own unchanged; empty own → shared unchanged; both empty → empty
- a category with no row → no shared content
- **highlights replace, they do not merge** — non-empty shared highlights win outright; empty shared
  highlights fall back to the activity's own (so a category with a set but no highlights doesn't blank
  the section)

**Integration (PGlite)**

- migration applies; the two seed rows land with the expected line counts
- `api_content_defaults` is callable by `anon` (it is public read)
- staff can write, anon cannot (RLS)
- re-running the seed is idempotent and does not overwrite edited content

**Regression**

- category rename re-points `activity_content_defaults` (the landmine above)
- an activity in a category with a standard set renders shared + own, deduped (the four merged lists)
- a `Taxi Sightseeing tours` activity still renders ONLY the shared highlights — the parity guarantee,
  and the specific thing the 50 hidden lines would have broken
- an `Airport transfers` activity gets NO sightseeing content, even though it is `pricing_mode =
'vehicle'` — pins the intended delta so nobody "helpfully" restores the vehicle rule later
- `catch-up-parity` + `setup-sql-parity` stay green

## Rollout

1. Owner re-runs `supabase/catch-up.sql` (creates the table + RPC + seeds). Idempotent.
2. Deploy, then verify:
   - a `Taxi Sightseeing tours` tour and a `Catamaran cruises` cruise — **unchanged**;
   - `/activities/airport-transfer` — sightseeing content **gone** (intended fix);
   - the Custom Road Trip page — sightseeing content **now present** (intended fix).
3. Owner edits standard content at `/admin/content`.

## Risks

| Risk                                                          | Mitigation                                                                                                                             |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Highlights merge surfaces 50 hidden lines across 11 tours~~ | **Resolved in design**: highlights replace rather than merge, so nothing new surfaces. The trap is fixed with an admin notice instead. |
| Category rename detaches standard content                     | Re-point in `updateCategory`, covered by a regression test                                                                             |
| Seed text drifts from the deleted constants                   | Migration is generated from the constants in the same change; day-one parity verified on the live site                                 |
| Extra DB round-trip per activity page                         | One small query, ≤10 rows; page is edge-rendered and cached. Fails soft to empty defaults                                              |
