# Editable Highlights (Custom Badges) — Design

> Brainstormed 2026-06-20. Third of three follow-ups (after the multi-option selector and the single-map
> drop-off). Lets admin define a per-activity "badges" strip (icon + title + subtitle) that replaces the
> hardcoded QuickFacts highlights on the activity detail page.

**Problem:** The QuickFacts strip (`Sections.tsx`) mixes badges derived from editable fields (Duration ←
`durationMinutes`, Live tour guide ← `languages`, Pickup ← `pickupAvailable`, Free cancellation ←
`cancellationPolicy`) with THREE hardcoded ones ("Reserve now & pay later", "Instant confirmation", the
"Private group" subtitle). The owner wants full per-activity control: a custom badge list.

**Owner's choice:** **fully custom badge list** — admin adds any number of `{ icon, title, subtitle }`
badges; they REPLACE the fixed strip for that activity.

## Locked decisions
1. **Storage = `activities.extra.badges`** (JSONB array). **No migration / no owner DB action** — the
   winning `api_get_activity` already returns `a.extra` wholesale (migration `20260615121400`, preserved by
   every later override incl. `catch-up.sql`). The ONLY reason `badges` wouldn't flow is that Zod strips
   keys not declared in `activityExtraSchema` — so we add `badges` there.
2. **Icons = a fixed registry** (~14 existing SVGs from `@/components/ui/icons`). Admin picks by key from a
   dropdown; we store the key string. No free-form upload (keeps the strip on-brand).
3. **Fallback = current strip when empty.** An activity with no `extra.badges` keeps today's derived/
   hardcoded QuickFacts unchanged. The moment it has ≥1 badge, those REPLACE the strip. So existing
   activities are visually unchanged until an admin opts in.
4. **Badge shape:** `{ icon: string (registry key); title: string; subtitle: string }`. Order = array order
   (admin add/remove/reorder). Empty rows (no icon or no title) are dropped on save.

## Architecture (all TypeScript — no SQL)
- **Schema:** add `badges: z.array(badgeSchema).optional()` to `activityExtraSchema` in
  `src/lib/validation/tours.ts`. It then flows through `tourDetailSchema.parse` → the page automatically.
- **Icon registry:** `src/components/ui/badge-icons.tsx` — `BADGE_ICONS: { key, label, Icon }[]` (for the
  admin dropdown) + `badgeIcon(key): IconComponent | null` (for render). The SVG icon components are pure
  (no hooks), so this is safe in both the server `QuickFacts` and the client form.
- **Pure helper:** `src/lib/catalogue/badges.ts` — `normalizeBadges(rows)`: trim, drop rows missing icon or
  title, cap title/subtitle length, cap count (e.g. 8). Used by `buildExtra` on save; unit-tested.
- **Admin:** `ActivityForm.tsx` gains a `BadgesEditor` (rows of icon `<select>` + title + subtitle, add/
  remove), modelled on the existing `StringList`/`ItineraryEditor`. `activity-write.ts`: `ExtraShape` +
  `ActivityFormValues` + `EMPTY_ACTIVITY` gain `badges`; `loadActivityForEdit` maps `extra.badges` in;
  `buildExtra` writes `normalizeBadges(v.badges)` alongside `itinerary` (only when non-empty).
- **Render:** `QuickFacts` (`Sections.tsx`) takes a `badges` prop; when non-empty it renders those (icon via
  `badgeIcon(key)`, in the EXACT existing badge layout) and returns early; else the current derived strip.
  `page.tsx` passes `activity.extra.badges ?? []`.

## Testing
- Unit: `normalizeBadges` (drops icon-less/title-less rows, trims, caps count); `badgeIcon` (known key →
  component, unknown → null).
- Manual: an activity with 3 custom badges shows exactly those on the detail page; an activity with none is
  unchanged; admin add/edit/remove round-trips through save + reload.

## Out of scope
- Free-form icon upload; changing the derived badges' own logic (already editable via their fields);
  per-badge i18n (titles/subtitles are admin free text, shown as entered — like other DB content).
- Note (pre-existing, NOT introduced here): `buildExtra` only writes the `extra` keys the form manages
  (`itinerary`, now `badges`); other keys (`importantInfo`, `availability`, `startWindow`, `returnWindow`)
  are not round-tripped by the admin form today. Unchanged by this work.
