# Per-Stop Itinerary Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "optional stops" model with per-stop alternatives — each itinerary stop can offer options, and the customer picks exactly one per stop (no add/remove/reorder).

**Architecture:** Each `extra.itinerary` stop gains `options?: AltStop[]` (alternatives). The admin curates them under each stop; the customer chooses one per stop on the tour page; the chosen route still saves to `bookings.custom_itinerary`. Pure TS — `extra` is opaque jsonb passed through the catalogue API, so **no migration**.

**Tech Stack:** Next.js 15 + TypeScript, Zod DTOs, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-per-stop-options-and-gyg-booking-flow-design.md` (Feature 1).

**Removes** the PR #2 flat model: `extra.optionalStops`/`extra.maxStops`, the add/remove/move route reducer, the admin "Optional stops" section, and the add/remove/reorder builder UI.

---

## Task 1: DTO — per-stop `options`, drop the flat pool

**Files:**

- Modify: `src/lib/validation/tours.ts`
- Modify: `tests/unit/catalogue.test.ts` (replace the optionalStops case)

- [ ] **Step 1: Replace the failing DTO test**

In `tests/unit/catalogue.test.ts`, replace the `describe('activityExtraSchema — optional stops', …)` block with:

```ts
describe('activityExtraSchema — per-stop options', () => {
  it('parses a stop with alternatives and tolerates stops without them', () => {
    const extra = activityExtraSchema.parse({
      itinerary: [
        { title: 'Port Louis', area: 'Capital' },
        {
          title: 'Pamplemousses Botanical Garden',
          area: 'North',
          options: [
            { title: 'Fort Adelaide', area: 'Port Louis' },
            { title: 'Apravasi Ghat', area: 'Port Louis', lat: -20.16, lng: 57.5 },
          ],
        },
      ],
    });
    expect(extra.itinerary?.[0]?.options).toBeUndefined();
    expect(extra.itinerary?.[1]?.options).toHaveLength(2);
    expect(extra.itinerary?.[1]?.options?.[0]?.title).toBe('Fort Adelaide');
    // The dropped flat-pool keys are no longer part of the schema output.
    const stripped = activityExtraSchema.parse({
      itinerary: [{ title: 'X' }],
      optionalStops: [{ title: 'Y' }],
      maxStops: 6,
    } as never);
    expect((stripped as Record<string, unknown>).optionalStops).toBeUndefined();
    expect((stripped as Record<string, unknown>).maxStops).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/catalogue.test.ts -t "per-stop options"`
Expected: FAIL — `options` is stripped (unknown key), so `toHaveLength(2)` throws.

- [ ] **Step 3: Update the schema**

In `src/lib/validation/tours.ts`:

- Add an alt-stop schema and `options` on `itineraryStopSchema` (replace the existing `itineraryStopSchema` definition):

```ts
/** A swappable alternative place for a stop (no nested options — one level deep). */
export const altStopSchema = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type AltStop = z.infer<typeof altStopSchema>;

export const itineraryStopSchema = z.object({
  title: z.string(),
  area: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  /** Alternatives the customer can pick INSTEAD of this stop's primary place. */
  options: z.array(altStopSchema).optional(),
});
export type ItineraryStop = z.infer<typeof itineraryStopSchema>;
```

- In `activityExtraSchema`, **remove** the two flat-pool fields:

```ts
  // (delete these two lines)
  optionalStops: z.array(itineraryStopSchema).optional(),
  maxStops: z.number().int().positive().optional(),
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/catalogue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/tours.ts tests/unit/catalogue.test.ts
git commit -m "feat(itinerary): per-stop options on the stop schema; drop the flat pool"
```

---

## Task 2: Pure per-stop selection helpers (replace the route reducer)

**Files:**

- Replace: `src/lib/itinerary/route.ts`
- Replace: `tests/unit/itinerary-route.test.ts`

- [ ] **Step 1: Replace the test**

Overwrite `tests/unit/itinerary-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { placeForStop, chosenRoute, divergesFromDefault } from '@/lib/itinerary/route';
import type { ItineraryStop } from '@/lib/validation/tours';

const STOPS: ItineraryStop[] = [
  { title: 'Port Louis', area: 'Capital' },
  {
    title: 'Pamplemousses',
    area: 'North',
    options: [{ title: 'Fort Adelaide', area: 'Port Louis' }],
  },
];

describe('per-stop selection', () => {
  it('placeForStop returns the primary for 0 / out-of-range, the alternative otherwise', () => {
    expect(placeForStop(STOPS[1]!, 0)).toEqual({
      title: 'Pamplemousses',
      area: 'North',
      lat: undefined,
      lng: undefined,
    });
    expect(placeForStop(STOPS[1]!, 1)).toEqual({
      title: 'Fort Adelaide',
      area: 'Port Louis',
      lat: undefined,
      lng: undefined,
    });
    expect(placeForStop(STOPS[1]!, 9).title).toBe('Pamplemousses'); // out of range → primary
    expect(placeForStop(STOPS[0]!, 1).title).toBe('Port Louis'); // no options → primary
  });

  it('chosenRoute maps each stop to its selected place, defaulting to primary', () => {
    expect(chosenRoute(STOPS, { 1: 1 }).map((p) => p.title)).toEqual([
      'Port Louis',
      'Fort Adelaide',
    ]);
    expect(chosenRoute(STOPS, {}).map((p) => p.title)).toEqual(['Port Louis', 'Pamplemousses']);
  });

  it('divergesFromDefault is true only when some stop picks an alternative', () => {
    expect(divergesFromDefault({})).toBe(false);
    expect(divergesFromDefault({ 0: 0, 1: 0 })).toBe(false);
    expect(divergesFromDefault({ 1: 1 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/itinerary-route.test.ts`
Expected: FAIL — `placeForStop`/`chosenRoute`/`divergesFromDefault` don't exist (old module exported add/remove/move).

- [ ] **Step 3: Replace the module**

Overwrite `src/lib/itinerary/route.ts`:

```ts
import type { AltStop, ItineraryStop } from '@/lib/validation/tours';

/** The place chosen for a stop: 0 = the stop's primary place; 1.. = options[index-1]. */
export function placeForStop(stop: ItineraryStop, sel: number): AltStop {
  if (sel <= 0 || !stop.options || sel > stop.options.length) {
    return { title: stop.title, area: stop.area ?? null, lat: stop.lat, lng: stop.lng };
  }
  const o = stop.options[sel - 1]!;
  return { title: o.title, area: o.area ?? null, lat: o.lat, lng: o.lng };
}

/** The chosen route = the selected place for each stop, in order. */
export function chosenRoute(
  stops: ItineraryStop[],
  selectedByStop: Record<number, number>,
): AltStop[] {
  return stops.map((s, i) => placeForStop(s, selectedByStop[i] ?? 0));
}

/** True when any stop picks an alternative (index > 0) — i.e. a real customisation. */
export function divergesFromDefault(selectedByStop: Record<number, number>): boolean {
  return Object.values(selectedByStop).some((v) => v > 0);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/itinerary-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/itinerary/route.ts tests/unit/itinerary-route.test.ts
git commit -m "feat(itinerary): pure per-stop selection helpers (replace route reducer)"
```

---

## Task 3: Admin — per-stop alternatives editor; drop the flat pool

**Files:**

- Modify: `src/lib/admin/activity-write.ts`
- Modify: `src/components/admin/ActivityForm.tsx`

- [ ] **Step 1: Form model carries per-stop options, drops the pool**

In `src/lib/admin/activity-write.ts`:

- `ItineraryStopInput` — add `options`:

```ts
export interface ItineraryStopInput {
  title: string;
  area: string;
  description: string;
  tags: string[];
  /** Alternatives the customer can pick instead of this stop. */
  options: { title: string; area: string }[];
}
```

- `ActivityFormValues` — **remove** `optionalStops` and `maxStops` (added in PR #2).
- `EMPTY_ACTIVITY` — **remove** `optionalStops: []` and `maxStops: null`.
- `buildExtra` — write per-stop options; drop the flat pool. Replace the whole function:

```ts
function buildExtra(v: ActivityFormValues) {
  const itinerary = v.itinerary
    .filter((s) => s.title.trim())
    .map((s) => ({
      title: s.title.trim(),
      area: s.area.trim() || null,
      description: s.description.trim() || null,
      tags: s.tags.filter((t) => t.trim()),
      options: s.options
        .filter((o) => o.title.trim())
        .map((o) => ({ title: o.title.trim(), area: o.area.trim() || null })),
    }))
    .map(({ options, ...rest }) => (options.length ? { ...rest, options } : rest));
  return itinerary.length ? { itinerary } : {};
}
```

- `ExtraShape` — reflect per-stop options; drop pool keys:

```ts
interface ExtraShape {
  itinerary?: Array<{
    title?: string;
    area?: string | null;
    description?: string | null;
    tags?: string[];
    options?: Array<{ title?: string; area?: string | null }>;
  }>;
}
```

- `loadActivityForEdit` — map options back, and **remove** the `optionalStops`/`maxStops` reads added in PR #2. The itinerary map becomes:

```ts
    itinerary: (extra.itinerary ?? []).map((s) => ({
      title: s.title ?? '',
      area: s.area ?? '',
      description: s.description ?? '',
      tags: s.tags ?? [],
      options: (s.options ?? []).map((o) => ({ title: o.title ?? '', area: o.area ?? '' })),
    })),
```

(and delete the `optionalStops:` and `maxStops:` lines from the returned object).

- [ ] **Step 2: Admin UI — alternatives under each stop, remove the Optional-stops section**

In `src/components/admin/ActivityForm.tsx`:

- **Delete** the entire `<Section title="Optional stops (customer-customizable)">…</Section>` block added in PR #2 (the one with the second `ItineraryEditor` + the "Max stops" number input).
- In the `ItineraryEditor` component, inside each stop card (after the `<StringList label="Tags" …/>` block, before the card's closing `</div>`), add an alternatives editor:

```tsx
<div className="mt-3 rounded-lg bg-ink/[0.03] p-3">
  <div className="text-[12px] font-bold text-ink">
    Alternatives (the customer picks one instead)
  </div>
  <p className="mb-2 text-[11.5px] text-ink-muted">
    Leave empty to keep this stop fixed. Add e.g. Fort Adelaide so the customer can swap it for{' '}
    {stop.title.trim() || 'this stop'}.
  </p>
  {stop.options.map((opt, oi) => (
    <div key={oi} className="mb-2 flex items-center gap-2">
      <input
        className={inputClass}
        value={opt.title}
        onChange={(e) =>
          update(i, {
            options: stop.options.map((o, idx) =>
              idx === oi ? { ...o, title: e.target.value } : o,
            ),
          })
        }
        placeholder="Alternative place (e.g. Fort Adelaide)"
      />
      <input
        className={inputClass}
        value={opt.area}
        onChange={(e) =>
          update(i, {
            options: stop.options.map((o, idx) =>
              idx === oi ? { ...o, area: e.target.value } : o,
            ),
          })
        }
        placeholder="Area"
      />
      <button
        type="button"
        aria-label="Remove alternative"
        onClick={() => update(i, { options: stop.options.filter((_, idx) => idx !== oi) })}
        className="shrink-0 text-ink-muted hover:text-coral"
      >
        <IconX width={16} height={16} />
      </button>
    </div>
  ))}
  <button
    type="button"
    onClick={() => update(i, { options: [...stop.options, { title: '', area: '' }] })}
    className="rounded-full border border-ink/15 px-3 py-1 text-[12px] font-bold text-ink hover:border-teal hover:text-teal"
  >
    + Add alternative
  </button>
</div>
```

- The `ItineraryEditor`'s "Add stop" button creates a stop **with** an empty options array:

```tsx
        onClick={() => onChange([...stops, { title: '', area: '', description: '', tags: [], options: [] }])}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (If `inputClass` / `IconX` / `StringList` aren't in scope inside `ItineraryEditor`, they already are — the existing editor uses `inputClass` and `IconX`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/activity-write.ts src/components/admin/ActivityForm.tsx
git commit -m "feat(admin): per-stop alternatives editor; remove the flat optional-stops pool"
```

---

## Task 4: Customer builder — per-stop chooser

**Files:**

- Replace: `src/components/gyg/detail/ItineraryBuilder.tsx`
- Modify: `app/activities/[slug]/page.tsx`

- [ ] **Step 1: Rewrite the builder**

Overwrite `src/components/gyg/detail/ItineraryBuilder.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { chosenRoute, divergesFromDefault, placeForStop } from '@/lib/itinerary/route';
import { RouteMap } from '@/components/maps/RouteMap';
import { PickupMap } from '@/components/maps/PickupMap';
import { mapsDirectionsUrl } from '@/lib/maps/urls';

/**
 * Per-stop route chooser: a fixed timeline of the tour's stops. Any stop that has alternatives shows
 * the primary + alternatives as selectable chips; the customer picks ONE per stop (no add/remove/
 * reorder). The chosen route is stashed in sessionStorage (`gytm:itinerary:<slug>`) for checkout —
 * only when it diverges from all-primaries — and the map draws the live driving route with a car.
 */
export function ItineraryBuilder({ slug, stops }: { slug: string; stops: ItineraryStop[] }) {
  // selectedByStop[i] = 0 (primary) | 1.. (options[n-1]).
  const [selectedByStop, setSelectedByStop] = useState<Record<number, number>>({});
  const [pickup, setPickup] = useState('');

  const route = useMemo(() => chosenRoute(stops, selectedByStop), [stops, selectedByStop]);

  // Stash only when the customer actually swapped something (else null = standard route).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `gytm:itinerary:${slug}`;
    if (divergesFromDefault(selectedByStop)) {
      window.sessionStorage.setItem(key, JSON.stringify(route));
    } else {
      window.sessionStorage.removeItem(key);
    }
  }, [slug, selectedByStop, route]);

  const mapStops: ItineraryStop[] = useMemo(
    () => [...(pickup.trim() ? [{ title: pickup.trim() } as ItineraryStop] : []), ...route],
    [pickup, route],
  );
  const [mapStopsDebounced, setMapStopsDebounced] = useState(mapStops);
  useEffect(() => {
    const t = setTimeout(() => setMapStopsDebounced(mapStops), 500);
    return () => clearTimeout(t);
  }, [mapStops]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <div className="mb-4 rounded-xl border border-ink/10 p-3">
          <div className="text-[13px] font-bold text-ink">Your pickup (start of the route)</div>
          <PickupMap
            value={pickup}
            onChange={setPickup}
            placeholder="Hotel, Airbnb or cruise port"
          />
        </div>

        <ol className="relative m-0 list-none p-0">
          {stops.map((stop, i) => {
            const sel = selectedByStop[i] ?? 0;
            const hasOptions = (stop.options?.length ?? 0) > 0;
            const choices = [
              { title: stop.title, area: stop.area ?? null },
              ...(stop.options ?? []).map((o) => ({ title: o.title, area: o.area ?? null })),
            ];
            return (
              <li key={i} className="relative flex items-start gap-3 pb-4">
                <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/10 text-[12px] font-bold text-teal">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold text-ink">
                    {placeForStop(stop, sel).title}
                  </div>
                  {placeForStop(stop, sel).area && (
                    <div className="text-[13px] text-ink-muted">{placeForStop(stop, sel).area}</div>
                  )}
                  {hasOptions && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {choices.map((c, ci) => {
                        const active = sel === ci;
                        return (
                          <button
                            key={ci}
                            type="button"
                            onClick={() => setSelectedByStop((m) => ({ ...m, [i]: ci }))}
                            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${
                              active
                                ? 'border-teal bg-teal/5 text-teal-dark'
                                : 'border-ink/15 text-ink-muted hover:border-teal'
                            }`}
                          >
                            {c.title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 text-[12px] text-ink-muted">
          Pick the places you want at each stop — no extra cost. Your driver follows your choices.
        </p>
      </div>

      <div>
        <RouteMap stops={mapStopsDebounced} animate />
        <a
          href={mapsDirectionsUrl(mapStopsDebounced.map((s) => s.title))}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm font-bold text-teal underline underline-offset-2 hover:text-teal-dark"
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Page renders the builder when any stop has alternatives**

In `app/activities/[slug]/page.tsx`:

- **Remove** the `const optionalStops = activity.extra.optionalStops ?? [];` line (added in PR #2).
- Replace the itinerary `<section>` conditional with one driven by per-stop options:

```tsx
{
  itinerary.length > 0 && (
    <section className="mt-8 border-t border-ink/10 pt-7">
      <SectionTitle>Itinerary</SectionTitle>
      {itinerary.some((s) => (s.options?.length ?? 0) > 0) ? (
        <ItineraryBuilder slug={activity.slug} stops={itinerary} />
      ) : (
        <>
          <Itinerary stops={itinerary} meetingPoint={activity.meetingPoint} />
          <p className="mt-3 text-[12.5px] text-ink-muted">
            For reference only. Itineraries are subject to change.
          </p>
        </>
      )}
    </section>
  );
}
```

(The `ItineraryBuilder` import stays; its props are now just `slug` + `stops`.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. Grep `app/activities/[slug]/page.tsx` + the codebase for any remaining `optionalStops` / `maxStops` references and remove them.

- [ ] **Step 4: Commit**

```bash
git add src/components/gyg/detail/ItineraryBuilder.tsx "app/activities/[slug]/page.tsx"
git commit -m "feat(detail): per-stop alternatives chooser (replaces the add/remove builder)"
```

---

## Task 5: Full green gate + review

**Files:** none (verification)

- [ ] **Step 1: Grep for dead references**

Run: `git grep -nE "optionalStops|maxStops|addStop|removeStop|moveStop|withIds|toStops" -- src tests app` (excluding the docs/specs).
Expected: no hits in `src`/`tests`/`app` (only the old spec/plan docs may mention them). Fix any stragglers.

- [ ] **Step 2: Full green gate**

Stop any running dev preview first. Then:
Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 3: Preview (real browser)**

In the user's browser (the headless preview can't render Google Maps): add an alternative to a stop in admin, open the tour page, and confirm the stop shows the primary + alternative as chips, picking one updates the line + the map, and booking with a swap saves the route to the voucher.

- [ ] **Step 4: Commit any fixes + push**

```bash
git add -A && git commit -m "chore: green gate for per-stop itinerary options"
git push
```

---

## Self-Review

**Spec coverage (Feature 1):**

- `options` on the stop schema; drop `optionalStops`/`maxStops` → Task 1. ✓
- Per-stop selection helpers (replace route reducer) → Task 2. ✓
- Admin alternatives editor; remove the Optional-stops section → Task 3. ✓
- Customer per-stop chooser (no add/remove/reorder); keep pickup + map; stash on divergence → Task 4. ✓
- Booking persistence unchanged (no migration) → covered (custom_itinerary path untouched). ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type/name consistency:** `placeForStop`/`chosenRoute`/`divergesFromDefault` defined in Task 2, used in Task 4. `ItineraryStop.options` / `AltStop` defined in Task 1, used in Tasks 2–4. `ItineraryStopInput.options` (admin) defined in Task 3, used in its editor. The builder's props drop to `{ slug, stops }` (Task 4) — matching the page's render call.

**Risk:** Removing `optionalStops`/`maxStops` is safe — they were jsonb-only (no DB column); stored values are simply ignored on parse. Grep in Task 5 Step 1 catches any missed reference.
