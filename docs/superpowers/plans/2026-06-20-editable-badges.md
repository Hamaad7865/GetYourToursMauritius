# Editable Highlights (Custom Badges) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Admin defines a per-activity badge strip (`{ icon, title, subtitle }[]` in `activities.extra.badges`) that replaces the hardcoded QuickFacts highlights on the detail page.

**Architecture:** All TypeScript — `extra` already flows from `api_get_activity` (returns `a.extra` wholesale); Zod just needs the `badges` field declared. Icon registry shared by the admin picker + the renderer. No DB migration, no owner action.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-editable-badges-design.md`.

---

## Task 1: Schema + icon registry + pure normalize helper

**Files:**

- Modify: `src/lib/validation/tours.ts`
- Create: `src/components/ui/badge-icons.tsx`, `src/lib/catalogue/badges.ts`, `tests/unit/badges.test.ts`

- [ ] **Step 1: Schema.** In `src/lib/validation/tours.ts`, add a badge schema and wire it into `activityExtraSchema` (READ the file to match style; `activityExtraSchema` is a `z.object({ itinerary, importantInfo, availability, startWindow, returnWindow })`):

```typescript
export const activityBadgeSchema = z.object({
  icon: z.string(),
  title: z.string(),
  subtitle: z.string().default(''),
});
export type ActivityBadge = z.infer<typeof activityBadgeSchema>;
// inside activityExtraSchema, add:
  badges: z.array(activityBadgeSchema).optional(),
```

- [ ] **Step 2: Icon registry** `src/components/ui/badge-icons.tsx`. READ `src/components/ui/icons.tsx` to confirm the exact exported component names. Then:

```tsx
import type { SVGProps } from 'react';
import {
  IconClock,
  IconUsers,
  IconGlobe,
  IconCheck,
  IconCalendar,
  IconBolt,
  IconShield,
  IconPin,
  IconStar,
  IconHeart,
  IconWallet,
  IconTrophy,
  IconChat,
  IconTag,
} from '@/components/ui/icons';

type IconCmp = (p: SVGProps<SVGSVGElement>) => React.ReactElement;

/** Curated, on-brand icon set the admin can pick from for custom badges. key is stored in extra.badges. */
export const BADGE_ICONS: { key: string; label: string; Icon: IconCmp }[] = [
  { key: 'clock', label: 'Clock / duration', Icon: IconClock },
  { key: 'users', label: 'Group / people', Icon: IconUsers },
  { key: 'globe', label: 'Languages / globe', Icon: IconGlobe },
  { key: 'check', label: 'Check', Icon: IconCheck },
  { key: 'calendar', label: 'Calendar / cancellation', Icon: IconCalendar },
  { key: 'bolt', label: 'Instant / bolt', Icon: IconBolt },
  { key: 'shield', label: 'Shield / safety', Icon: IconShield },
  { key: 'pin', label: 'Pickup / location', Icon: IconPin },
  { key: 'star', label: 'Star', Icon: IconStar },
  { key: 'heart', label: 'Heart', Icon: IconHeart },
  { key: 'wallet', label: 'Reserve / pay later', Icon: IconWallet },
  { key: 'trophy', label: 'Award', Icon: IconTrophy },
  { key: 'chat', label: 'Guide / support', Icon: IconChat },
  { key: 'tag', label: 'Price / tag', Icon: IconTag },
];

const BY_KEY = new Map(BADGE_ICONS.map((b) => [b.key, b.Icon]));
/** Resolve a stored icon key to its component, or null when unknown. */
export function badgeIcon(key: string): IconCmp | null {
  return BY_KEY.get(key) ?? null;
}
```

(If any listed icon doesn't exist in `icons.tsx`, drop it from the list and note which.)

- [ ] **Step 3: Failing test** `tests/unit/badges.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { normalizeBadges } from '@/lib/catalogue/badges';

describe('normalizeBadges', () => {
  it('keeps complete rows and trims', () => {
    const out = normalizeBadges([
      { icon: 'bolt', title: '  Instant  ', subtitle: '  E-voucher  ' },
    ]);
    expect(out).toEqual([{ icon: 'bolt', title: 'Instant', subtitle: 'E-voucher' }]);
  });
  it('drops rows missing an icon or a title', () => {
    expect(
      normalizeBadges([
        { icon: '', title: 'X', subtitle: '' },
        { icon: 'pin', title: '', subtitle: '' },
      ]),
    ).toEqual([]);
  });
  it('caps the count at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      icon: 'star',
      title: `T${i}`,
      subtitle: '',
    }));
    expect(normalizeBadges(many)).toHaveLength(8);
  });
});
```

- [ ] **Step 4: Run, expect FAIL** — `npx vitest run tests/unit/badges.test.ts`.

- [ ] **Step 5: Implement** `src/lib/catalogue/badges.ts`:

```typescript
import type { ActivityBadge } from '@/lib/validation/tours';

export interface BadgeInput {
  icon: string;
  title: string;
  subtitle: string;
}

/** Trim, drop rows missing an icon or title, cap field lengths + the count. The form's source of truth on save. */
export function normalizeBadges(rows: BadgeInput[]): ActivityBadge[] {
  const out: ActivityBadge[] = [];
  for (const r of rows) {
    const icon = r.icon.trim();
    const title = r.title.trim().slice(0, 60);
    const subtitle = r.subtitle.trim().slice(0, 120);
    if (!icon || !title) continue;
    out.push({ icon, title, subtitle });
    if (out.length >= 8) break;
  }
  return out;
}
```

- [ ] **Step 6: Run → PASS.**

- [ ] **Step 7: Verify + commit** — `npm run typecheck && npm run lint && npx vitest run tests/unit/badges.test.ts`.

```bash
git add src/lib/validation/tours.ts src/components/ui/badge-icons.tsx src/lib/catalogue/badges.ts tests/unit/badges.test.ts
git commit -m "feat(catalogue): badge schema, icon registry, normalizeBadges helper"
```

---

## Task 2: Admin — load, edit, save custom badges

**Files:**

- Modify: `src/lib/admin/activity-write.ts`, `src/components/admin/ActivityForm.tsx`

- [ ] **Step 1: Form value type.** In `activity-write.ts` (READ it first): add `badges: BadgeInput[]` to `ActivityFormValues` (import `BadgeInput` from `@/lib/catalogue/badges`); add `badges: []` to `EMPTY_ACTIVITY`; extend the internal `ExtraShape` with `badges?: Array<{ icon?: string; title?: string; subtitle?: string }>`.

- [ ] **Step 2: Load.** In `loadActivityForEdit`, map the stored badges into the form:

```typescript
badges: (extra.badges ?? []).map((b) => ({ icon: b.icon ?? '', title: b.title ?? '', subtitle: b.subtitle ?? '' })),
```

- [ ] **Step 3: Save.** In `buildExtra`, after the itinerary block, add badges via the Task-1 helper and include only when non-empty (match the existing `itinerary.length ? {...} : {}` idiom):

```typescript
import { normalizeBadges } from '@/lib/catalogue/badges';
// ...
const badges = normalizeBadges(v.badges);
const out: Record<string, unknown> = {};
if (itinerary.length) out.itinerary = itinerary;
if (badges.length) out.badges = badges;
return out;
```

(Refactor the current `return itinerary.length ? { itinerary } : {}` into this shape. Confirm `buildExtra`'s return type still satisfies its caller `activityRow`.)

- [ ] **Step 4: BadgesEditor UI.** In `ActivityForm.tsx`, add a `BadgesEditor` component modelled on the existing `StringList`/`ItineraryEditor` (READ those for the exact card/add/remove styling + the `set(...)` pattern). Each row: an icon `<select>` (options from `BADGE_ICONS` — `import { BADGE_ICONS } from '@/components/ui/badge-icons'` — `value={row.icon}`, option `value={b.key}` label `{b.label}`), a Title text input, a Subtitle text input, and a remove button; plus an "Add badge" button. Show a tiny preview of the chosen icon next to the select if easy (optional). Wire it into the form body near the existing Highlights/Itinerary editors:

```tsx
<BadgesEditor badges={v.badges} onChange={(x) => set('badges', x)} />
```

Add a one-line help text: "Custom badges replace the default highlights strip on the activity page. Leave empty to keep the defaults."

- [ ] **Step 5: Verify + commit** — `npm run typecheck && npm run lint && npx vitest run` (all green; report numbers).

```bash
git add src/lib/admin/activity-write.ts src/components/admin/ActivityForm.tsx
git commit -m "feat(admin): custom badges editor (icon + title + subtitle) on the activity form"
```

---

## Task 3: Render custom badges + page wiring + green gate

**Files:**

- Modify: `src/components/gyg/detail/Sections.tsx`, `app/(site)/activities/[slug]/page.tsx`

- [ ] **Step 1: QuickFacts render.** READ `QuickFacts` in `Sections.tsx` (the badge layout: a `grid sm:grid-cols-2` of `{ icon, title, sub }` rows with a `h-12 w-12` icon tile). Add a `badges?: { icon: string; title: string; subtitle: string }[]` prop. Right after `const t = await getT();`, branch:

```tsx
if (badges && badges.length > 0) {
  return (
    <div className="border-t border-ink/10 pt-6">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {badges.map((b, i) => {
          const Icon = badgeIcon(b.icon);
          return (
            <div key={`${b.icon}-${b.title}-${i}`} className="flex items-start gap-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-ink">
                {Icon ? <Icon width={22} height={22} /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold leading-tight text-ink">
                  {b.title}
                </span>
                {b.subtitle ? (
                  <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">
                    {b.subtitle}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// else: existing derived-strip logic unchanged
```

Import `badgeIcon` from `@/components/ui/badge-icons`. Match the EXACT classes the existing strip uses (copy from the current render so custom + default look identical).

- [ ] **Step 2: Page wiring.** In `app/(site)/activities/[slug]/page.tsx`, where `extra` is read (e.g. `const itinerary = activity.extra.itinerary ?? []`), add `const badges = activity.extra.badges ?? [];` and pass `badges={badges}` to `<QuickFacts ... />`.

- [ ] **Step 3: Green gate** — `npm run typecheck && npm run lint && npx vitest run` all green (report real numbers). Reason through: an activity with custom badges renders exactly those (unknown icon key → no icon, text still shows); an activity with none renders the current derived strip unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/gyg/detail/Sections.tsx "app/(site)/activities/[slug]/page.tsx"
git commit -m "feat(activity): render custom badges strip when set, else the default highlights"
```

- [ ] **Step 5: Review** — request a focused review (spec compliance + the fallback-when-empty behaviour + that no derived-strip activity regressed).

---

## Self-review (author)

**Spec coverage:** custom badge list replaces strip (T3 branch) ✓; stored in `extra.badges`, no migration (T1 schema only) ✓; fixed icon registry/picker (T1 registry + T2 select) ✓; fallback when empty (T3 early-return only when `badges.length`) ✓; add/remove rows (T2 editor) ✓; empty rows dropped on save (T1 `normalizeBadges` + T2 `buildExtra`) ✓.

**Type consistency:** `ActivityBadge` (`{icon,title,subtitle}`, subtitle defaulted) from `tours.ts`; `BadgeInput` (form, all required strings) from `badges.ts`; `BADGE_ICONS`/`badgeIcon` from `badge-icons.tsx`; `normalizeBadges(BadgeInput[]) → ActivityBadge[]`. QuickFacts prop matches `extra.badges` shape.

**Verify-at-execution-time:** the exact `icons.tsx` export names (T1 Step 2 — drop any missing); the `activityExtraSchema`/`ActivityFormValues`/`buildExtra` exact shapes (T1/T2 — read); the QuickFacts badge classes (T3 — copy from current render); that `extra` truly reaches the page (confirmed: winning `api_get_activity` returns `a.extra`; `tourDetailSchema` parses `extra`).
