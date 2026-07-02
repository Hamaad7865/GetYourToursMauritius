# Admin-managed activity card ordering — design spec (2026-07-02)

## Context
Activity cards on `/activities` (and its category views) are ordered `rating_count desc, title` — no manual
control. Categories already have an admin reorder (`api_swap_category_positions`, up/down). The owner wants
to **drag-and-drop the activity cards into a custom order, per category.**

## Decisions (locked)
- **Drag & drop** reorder (not up/down arrows).
- **Per category.** Because an activity has exactly ONE `category`, a single per-activity `sort` column
  already yields independent per-category ordering (a category view sorts only its own rows). No
  category-scoped position table needed.

## Architecture
### Layer 1 — DB (migration `2026XXXX_activity_sort.sql` + byte-identical catch-up append)
- `alter table activities add column if not exists sort int not null default 0;`
- **Re-apply `api_search_activities` VERBATIM** from the winning catch-up body, changing the result
  `order by` to **`sort, rating_count desc, title`** (manual order wins; unordered rows keep the old
  rating/title order since default sort = 0). ([[gytm-migration-revert-drift]] — appended byte-identically;
  parity test guards it.)
- New `api_reorder_activities(p jsonb)` `security definer` (guards `is_staff()`): given `p.ids` = an ordered
  array of activity ids, set `sort = array index` for each in one atomic UPDATE (unnest WITH ORDINALITY).
  Grant execute to authenticated.
- `types.ts`: add `sort` to `ActivitiesRow`/`Insert`; add `api_reorder_activities` to Functions.

### Layer 2 — Admin (drag & drop on the Tours screen)
- [AdminActivities.tsx](src/components/admin/AdminActivities.tsx): load `sort`; order the list by it. When a
  SINGLE category is selected (not "all"), the cards become draggable (HTML5 native drag — no dependency):
  `draggable`, `onDragStart/onDragOver/onDrop` reorder the filtered rows locally, then persist the new order
  of that category's ids via `api_reorder_activities`. When category = "all", dragging is disabled with a
  hint ("Filter to a category to reorder") — cross-category drag is meaningless (sort is per-category).
- New `src/lib/admin/activity-order.ts`: `reorderActivities(orderedIds: string[])` → browser-client
  `rpc('api_reorder_activities', { ids })`. Optimistic local reorder; refetch on error.

### Cross-cutting
- Un-reordered categories are unchanged (default sort 0 → rating/title tiebreak).
- Public read unaffected in shape (no DTO change — `sort` drives ORDER BY only, not the payload).
- Revert-drift: `api_search_activities` re-applied byte-identically into migration + catch-up.

## Verification
1. Integration (PGlite): after `api_reorder_activities({ ids: [C,A,B] })`, `api_search_activities` for that
   category returns C,A,B; a second category is untouched; `is_staff()` guard rejects a non-staff caller.
2. Catch-up parity green (api_search_activities migration == catch-up).
3. E2E (best-effort preview): drag a catamaran card in `/admin` (Catamaran cruises filter) → order persists →
   `/activities?category=Catamaran cruises` reflects it.
4. typecheck + lint + full suite green.

## Owner action
Re-run `supabase/catch-up.sql` (adds `sort` + re-applies `api_search_activities` + the reorder RPC), then
drag the cards on `/admin` → Tours (with a category selected).

## Out of scope (YAGNI)
Cross-category global ordering; a separate order for the all-view (it inherits `sort`); reordering the
homepage featured strips; drag on touch beyond native support.
