# Google Maps Cost → $0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the monthly Google Maps Platform bill to $0 by keeping every billed SKU under Google's free monthly allowance — with **no feature removed** and **Google kept on every map** (Mapbox was tried and dropped on 2026-11-10 for visual consistency).

**Architecture:** Stop paying per page view. (1) Tour itinerary stops get stored coordinates from a reviewed, generated lookup table, so visitors never trigger Geocoding. (2) Maps mount only when scrolled near, so crawlers and non-scrollers trigger no Routes calls. (3) The AI planner stops asking for 3 pages of Text Search to show 6 results, caches searches 30 days, and edge-caches photos. (4) Daily quotas in Google Cloud console guarantee $0 even on a freak day.

**Tech Stack:** Next.js 15 (edge runtime, Cloudflare Pages), Google Maps JS API + Places API (New) REST, Supabase `places_cache`, Vitest.

---

## Why the bill happened (evidence, 1 Oct – 9 Nov 2026, billing report grouped by SKU)

| SKU                                        | Calls  | Cost   | Free / month\* | Source in code                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------ | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geocoding                                  | 19,561 | $30.26 | 10,000         | `src/lib/maps/geocode.ts` called by `RoutedItinerary` / `RouteMap` for every itinerary stop **and** the meeting point, per visitor (sessionStorage cache only). Prod: 22 published tours, 101 stops, **0 with stored coords**, 64 distinct names. |
| Places Text Search Enterprise + Atmosphere | 1,943  | $23.52 | 1,000          | `PickupSearch` (planner "where are you staying?") fires a **3-page** search per typed prefix and shows only 6 results; `our-activities.ts` does a 3-page search to read one coordinate.                                                           |
| Places Place Details Photos                | 2,867  | $9.09  | 1,000          | `/api/planner/photo` — a Pages Function response is **not** stored by Cloudflare's CDN just because it sets `Cache-Control`, so most views re-bill.                                                                                               |
| Routes: Compute Routes Essentials          | 13,324 | $5.33  | 10,000         | `RouteMap` `computeRoutes` on every tour-page view, map mounted eagerly.                                                                                                                                                                          |

\* Google's per-SKU monthly free usage (Essentials ≈ 10k, Pro ≈ 5k, Enterprise ≈ 1k). The chart corroborates it: $0/day until 19 Oct, charges from 20 Oct once allowances ran out, $0 again 1–9 Nov. **Confirm the current allowances on Google's pricing page before relying on the numbers in Task 0.**

**Target after this plan:** Geocoding < 500/mo, Routes < 5,000/mo, Text Search < 600/mo, Photos < 800/mo → all inside free allowance → **$0**.

## File map

| File                                                                                       | Responsibility                                                       | Task |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---- |
| Google Cloud console (no code)                                                             | Daily quotas + budget alert                                          | 0    |
| `src/lib/maps/google-places.ts`                                                            | `maxPages` option on search; 30-day search TTL; normalised cache key | 1, 2 |
| `app/api/planner/places/route.ts`                                                          | Accept `?pages=1`                                                    | 1    |
| `src/components/planner/PickupSearch.tsx`                                                  | Ask for 1 page; 400 ms debounce                                      | 1    |
| `src/lib/planner/our-activities.ts`                                                        | Use `resolvePlaceByText` (1 page)                                    | 1    |
| `app/api/planner/photo/route.ts`                                                           | Edge Cache API store                                                 | 3    |
| `src/components/planner/Thumb.tsx`, `assistant/StopCard.tsx`, `assistant/CompareTable.tsx` | `loading="lazy"` on photos                                           | 3    |
| `scripts/build-place-coords.mjs` (new)                                                     | One-off, reviewed OSM lookup → generated table                       | 4    |
| `src/lib/content/_place-coords.gen.ts` (new, generated)                                    | Name → `{lat,lng}`                                                   | 4    |
| `src/lib/maps/place-coords.ts` (new)                                                       | `lookupPlaceCoords(title)`                                           | 4    |
| `src/lib/maps/geocode.ts`                                                                  | Check table before Google                                            | 4    |
| `src/lib/maps/useNearViewport.ts` (new)                                                    | IntersectionObserver hook                                            | 5    |
| `src/components/gyg/detail/RoutedItinerary.tsx`                                            | Mount map only when near                                             | 5    |
| `src/components/maps/RouteMap.tsx`                                                         | Per-session route memo                                               | 6    |
| `docs/handbook/landmines.md`, `docs/handbook/services.md`                                  | The rule, so it never recurs                                         | 7    |

Commit straight to `main` (owner preference), `git add` named files only — **never `git add -A`** (unrelated WIP lives in this tree).

---

### Task 0: Guardrails in Google Cloud console (owner, ~10 min, do first)

No code. This alone guarantees $0 from today; Tasks 1–6 make sure the caps are never hit.

- [ ] **Step 1: Budget alert.** Billing → Budgets & alerts → Create budget → scope: project `belle-mare-tours`, amount **$5/month**, alerts at 50 %, 90 %, 100 % → email the owner.
- [ ] **Step 2: Daily quotas.** APIs & Services → each API → Quotas & system limits → edit the _per day_ limit:

  | API              | Quota to edit                         | Set to  | Why                             |
  | ---------------- | ------------------------------------- | ------- | ------------------------------- |
  | Geocoding API    | Requests per day                      | **300** | 300 × 31 = 9,300 < 10k free     |
  | Places API (New) | `SearchTextRequest` per day           | **30**  | 930 < 1k free (Enterprise tier) |
  | Places API (New) | Place photo / `GetPhotoMedia` per day | **30**  | 930 < 1k free                   |
  | Places API (New) | `GetPlaceRequest` per day             | **30**  | Place Details, same tier        |
  | Routes API       | `ComputeRoutes` per day               | **300** | 9,300 < 10k free                |

  When a cap is hit the site degrades the way it already does without a key: maps show the keyless "View on Google Maps" link / straight lines; the planner's place list returns empty. Nothing errors.

- [ ] **Step 3: After Tasks 1–6 ship**, look at Quotas → "current usage" for a week. If usage sits far below the caps, leave them; they are the safety net.

---

### Task 1: Stop paying 3 searches to show 6 pick-up results

**Files:**

- Modify: `src/lib/maps/google-places.ts` (`PlacesSearchArgs`, `searchGooglePlaces`)
- Modify: `app/api/planner/places/route.ts`
- Modify: `src/components/planner/PickupSearch.tsx:91-105`
- Modify: `src/lib/planner/our-activities.ts:117-127`
- Test: `tests/unit/google-places-pages.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/google-places-pages.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchGooglePlaces } from '@/lib/maps/google-places';
import { clearPlacesCache } from '@/lib/maps/places-cache';

/** Every Text Search page is a billed request, so the pick-up box (which shows 6 results) must
 *  ask for ONE page, not three. */
describe('searchGooglePlaces page budget', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearPlacesCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ places: [], nextPageToken: 'more' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('makes exactly one billed request when maxPages is 1', async () => {
    await searchGooglePlaces({ query: 'grand baie', maxPages: 1 }, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still paginates up to 3 by default for the Add-places drawer', async () => {
    await searchGooglePlaces({ query: 'waterfall' }, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`maxPages` is not a known arg; first test sees 3 calls)

Run: `npx vitest run tests/unit/google-places-pages.test.ts`

- [ ] **Step 3: Implement**

In `src/lib/maps/google-places.ts`:

```ts
export interface PlacesSearchArgs {
  query?: string;
  category?: string;
  region?: string;
  /** Text Search pages to fetch (each page is ONE billed request). Default 3 (~60 results). */
  maxPages?: 1 | 2 | 3;
}
```

and in `searchGooglePlaces`, replace `searchTextCached(buildQuery(args), apiKey, 3)` with:

```ts
places = await searchTextCached(buildQuery(args), apiKey, args.maxPages ?? 3);
```

In `app/api/planner/places/route.ts`, inside the `searchGooglePlaces({...})` args object add:

```ts
          maxPages: url.searchParams.get('pages') === '1' ? 1 : undefined,
```

In `src/components/planner/PickupSearch.tsx`, change the fetch URL and the debounce:

```ts
const res = await fetch(`/api/planner/places?q=${encodeURIComponent(q)}&pages=1`).then((r) =>
  r.json(),
);
```

```ts
    }, 400);
```

In `src/lib/planner/our-activities.ts`, swap the import and the call so a coordinate lookup costs one page:

```ts
import { resolvePlaceByText } from '@/lib/maps/google-places';
```

```ts
    searchPlace: async (query) => {
      if (!mapsApiKey) return null;
      const first = await resolvePlaceByText(query, mapsApiKey);
      return first ? { lat: first.lat, lng: first.lng } : null;
    },
```

- [ ] **Step 4: Run the test — expect PASS**, plus the planner suites:

Run: `npx vitest run tests/unit/google-places-pages.test.ts tests/unit -t "planner"`

- [ ] **Step 5: Commit**

```bash
git add src/lib/maps/google-places.ts app/api/planner/places/route.ts src/components/planner/PickupSearch.tsx src/lib/planner/our-activities.ts tests/unit/google-places-pages.test.ts
git commit -m "perf(planner): one billed Places page for the pick-up box and coordinate lookups"
```

---

### Task 2: Cache planner searches 30 days, normalised

**Files:**

- Modify: `src/lib/maps/google-places.ts:11` (`SEARCH_TTL_MS`) and `searchTextCached` cache key
- Test: `tests/unit/google-places-pages.test.ts` (extend)

- [ ] **Step 1: Add the failing test** (append inside the `describe`):

```ts
it('treats case and spacing variants as one cached search', async () => {
  await searchGooglePlaces({ query: 'Grand  Baie', maxPages: 1 }, 'k');
  await searchGooglePlaces({ query: 'grand baie', maxPages: 1 }, 'k');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run — expect FAIL** (2 calls)

Run: `npx vitest run tests/unit/google-places-pages.test.ts`

- [ ] **Step 3: Implement**

```ts
const SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // searches: 30d — same as details; places rarely move
```

In `searchTextCached`:

```ts
const norm = textQuery.toLowerCase().replace(/\s+/g, ' ').trim();
const cacheKey = `s:${CACHE_VERSION}:${norm}|${maxPages}`;
```

(The request to Google still sends the original `textQuery`; only the cache key is normalised.)

- [ ] **Step 4: Run — expect PASS.** Run: `npx vitest run tests/unit/google-places-pages.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/maps/google-places.ts tests/unit/google-places-pages.test.ts
git commit -m "perf(planner): cache Places searches 30 days under a normalised key"
```

---

### Task 3: Bill each planner photo once, and only when seen

**Files:**

- Modify: `app/api/planner/photo/route.ts`
- Modify: `src/components/planner/Thumb.tsx:36`, `src/components/planner/assistant/StopCard.tsx` (`StopPhoto`'s `<img>`), `src/components/planner/assistant/CompareTable.tsx:109`

- [ ] **Step 1: Edge-cache the proxied photo.** In the route, after the `ref`/`key` checks and before the upstream fetch:

```ts
// A Pages Function response is NOT stored by Cloudflare's CDN because of Cache-Control alone —
// without this, nearly every view re-bills a Places photo. `caches` is absent in next dev / vitest.
const edgeCache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
const cacheKey = new Request(new URL(`/api/planner/photo?ref=${encodeURIComponent(ref)}`, req.url));
const cached = edgeCache ? await edgeCache.match(cacheKey) : undefined;
if (cached) return cached;
```

and replace the final `return new Response(res.body, …)` with:

```ts
const out = new Response(res.body, {
  status: 200,
  headers: {
    'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
    'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
  },
});
if (edgeCache) await edgeCache.put(cacheKey, out.clone());
return out;
```

- [ ] **Step 2: Lazy images.** Add `loading="lazy" decoding="async"` to the `<img>` in each of the three components listed above (if one is a Next `<Image>`, it is lazy by default — leave it).

- [ ] **Step 3: Verify.** `npm run typecheck`. Then `npm run dev`, open `/ai-road-trip-planner`, open "Add places", and in the browser pane's network list confirm photo requests fire only for cards scrolled into view.

- [ ] **Step 4: Commit**

```bash
git add app/api/planner/photo/route.ts src/components/planner/Thumb.tsx src/components/planner/assistant/StopCard.tsx src/components/planner/assistant/CompareTable.tsx
git commit -m "perf(planner): edge-cache Places photos and load them only when visible"
```

> Terms check (owner): Google's Places policy restricts caching Places content. The 7-day `s-maxage` here is what the route already asked for; confirm it with Google's current Places policy before shipping, or shorten it.

---

### Task 4: Stored coordinates for every itinerary stop and meeting point

Removes ~all Geocoding. Coordinates come from **OpenStreetMap** (ODbL — storable, needs attribution), never from Google's geocoder (its results may not be stored long-term). Reviewed by a human, as `scripts/geocode-activities.mjs` already does for activities — a geocoder is confidently wrong often enough.

**Files:**

- Create: `scripts/build-place-coords.mjs`
- Create (generated): `src/lib/content/_place-coords.gen.ts`
- Create: `src/lib/maps/place-coords.ts`
- Modify: `src/lib/maps/geocode.ts` (`geocode`)
- Modify: `src/components/maps/ItineraryMap.tsx` (attribution line)
- Test: `tests/unit/place-coords.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/place-coords.test.ts
import { describe, expect, it } from 'vitest';
import { lookupPlaceCoords, normalisePlaceName } from '@/lib/maps/place-coords';

describe('lookupPlaceCoords', () => {
  it('normalises case, accents, punctuation and a trailing ", Mauritius"', () => {
    expect(normalisePlaceName('  Chamarel Waterfall, Mauritius ')).toBe('chamarel waterfall');
    expect(normalisePlaceName('Île aux Cerfs')).toBe('ile aux cerfs');
  });

  it('returns null for an unknown place (the caller falls back to Google)', () => {
    expect(lookupPlaceCoords('definitely not a place 123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing). Run: `npx vitest run tests/unit/place-coords.test.ts`

- [ ] **Step 3: Implement the lookup**

```ts
// src/lib/maps/place-coords.ts
import { PLACE_COORDS } from '@/lib/content/_place-coords.gen';

/** Stored coordinates for itinerary stops / meeting points, generated by
 *  scripts/build-place-coords.mjs from OpenStreetMap and reviewed by hand. Checked BEFORE the billed
 *  Google geocoder so a tour page normally costs zero Geocoding calls. */
export function normalisePlaceName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,?\s*mauritius\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function lookupPlaceCoords(name: string): { lat: number; lng: number } | null {
  return PLACE_COORDS[normalisePlaceName(name)] ?? null;
}
```

Seed the generated file so it compiles (the script overwrites it):

```ts
// src/lib/content/_place-coords.gen.ts
// GENERATED by scripts/build-place-coords.mjs — do not hand-edit; re-run the script.
// Coordinates © OpenStreetMap contributors (ODbL).
export const PLACE_COORDS: Record<string, { lat: number; lng: number }> = {};
```

In `src/lib/maps/geocode.ts`, at the top of `geocode()` (before the memCache check):

```ts
const stored = lookupPlaceCoords(query);
if (stored) return stored;
```

with `import { lookupPlaceCoords } from './place-coords';`.

- [ ] **Step 4: Run — expect PASS.** Run: `npx vitest run tests/unit/place-coords.test.ts`

- [ ] **Step 5: Write the generator** `scripts/build-place-coords.mjs`. Behaviour (model it on `scripts/geocode-activities.mjs`, reuse its Mauritius bounds check):
  1. Read every published activity's `extra->itinerary[*].title`, `extra->itinerary[*].options[*].title` and `meeting_point` via the Supabase REST API (same env vars `geocode-activities.mjs` uses), dedupe by `normalisePlaceName`.
  2. Skip names that already resolve in `src/lib/content/_transfers.gen.ts` hotel coords (use those coords).
  3. For the rest, query `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=mu&limit=1&q=<name>` — **1 request per second**, header `User-Agent: belle-mare-tours-coords-script/1.0` (generic; no personal data).
  4. Reject hits outside the Mauritius bounds; print a table `name | lat,lng | OSM display_name` and a list of misses.
  5. Only with `--apply`: write `_place-coords.gen.ts` sorted by key, keeping any hand-added entries in an `OVERRIDES` object at the top of the script (for misses/wrong hits the owner pins by hand from a map).

- [ ] **Step 6: Run it, review, apply.**

Run: `node scripts/build-place-coords.mjs` → check every row on a map (wrong ones go into `OVERRIDES`) → `node scripts/build-place-coords.mjs --apply`.
Expected: all 64 distinct stop names + meeting points resolved (misses pinned by hand).

- [ ] **Step 7: Attribution.** Under the map legend in `ItineraryMap.tsx` add a muted line: `Stop locations © OpenStreetMap contributors` (pass the string through `t(...)` and add it to `src/lib/i18n/messages.ts`; run `node scripts/i18n-scan.mjs`).

- [ ] **Step 8: Verify zero geocodes.** `npm run dev`, open three tour pages with itineraries, filter the network list on `geocode` → expect **no** requests.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-place-coords.mjs src/lib/content/_place-coords.gen.ts src/lib/maps/place-coords.ts src/lib/maps/geocode.ts src/components/maps/ItineraryMap.tsx src/lib/i18n/messages.ts tests/unit/place-coords.test.ts
git commit -m "perf(maps): stored OSM coordinates for itinerary stops so tour pages stop geocoding"
```

---

### Task 5: Mount itinerary maps only when they are about to be seen

**Files:**

- Create: `src/lib/maps/useNearViewport.ts`
- Modify: `src/components/gyg/detail/RoutedItinerary.tsx`
- Test: `tests/unit/use-near-viewport.test.ts` (new)

- [ ] **Step 1: Write the failing test**

The repo has no React rendering test setup (Vitest runs in `node`, no `@testing-library/react`), so
the observer logic lives in a plain function, `observeNear`, which the hook wraps and the test drives
directly.

```ts
// tests/unit/use-near-viewport.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeNear } from '@/lib/maps/useNearViewport';

describe('observeNear', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fires once on the first intersection, then disconnects', () => {
    let cb: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn((c: IntersectionObserverCallback) => {
        cb = c;
        return { observe: vi.fn(), disconnect };
      }),
    );
    const onNear = vi.fn();
    observeNear({} as Element, '400px', onNear);
    cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onNear).not.toHaveBeenCalled();
    cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(onNear).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('fires immediately when IntersectionObserver does not exist (old browsers keep the map)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onNear = vi.fn();
    observeNear({} as Element, '400px', onNear);
    expect(onNear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run tests/unit/use-near-viewport.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/maps/useNearViewport.ts
'use client';

import { useEffect, useRef, useState } from 'react';

/** Calls `onNear` once, when `el` first comes within `margin` of the viewport. Returns a cleanup.
 *  No IntersectionObserver → calls it at once (old browsers keep the map). */
export function observeNear(el: Element, margin: string, onNear: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onNear();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        onNear();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
  return () => io.disconnect();
}

/** True once the element comes within `margin` of the viewport (one-way latch). Lets a map — and
 *  every billed call it makes — wait until a visitor actually scrolls to it. Crawlers and visitors
 *  who never scroll that far cost nothing. */
export function useNearViewport<T extends Element>(margin = '400px') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near || !ref.current) return;
    return observeNear(ref.current, margin, () => setNear(true));
  }, [near, margin]);
  return [ref, near] as const;
}
```

In `RoutedItinerary.tsx`:

```tsx
const [mapRef, near] = useNearViewport<HTMLDivElement>();
```

gate the ordering effect on `near` as well (`if (!near || status !== 'ready' || stops.length < 3) return;`, add `near` to its deps), and render:

```tsx
<div ref={mapRef}>
  {near ? (
    <ItineraryMap stops={orderedStops} kinds={orderedKinds} />
  ) : (
    <div className="h-[320px] rounded-2xl bg-surface-muted" aria-hidden="true" />
  )}
</div>
```

Match the placeholder height to the real map's container class in `RouteMap.tsx` so nothing jumps (read it there; don't guess).

- [ ] **Step 4: Run — expect PASS.** Run: `npx vitest run tests/unit/use-near-viewport.test.ts`

- [ ] **Step 5: Verify in the browser.** `npm run dev`, open a tour page, don't scroll: network list shows **no** `computeRoutes`/`geocode`. Scroll to the itinerary: the map draws with route and pins exactly as before. Check mobile width too (no layout shift).

- [ ] **Step 6: Commit**

```bash
git add src/lib/maps/useNearViewport.ts src/components/gyg/detail/RoutedItinerary.tsx tests/unit/use-near-viewport.test.ts
git commit -m "perf(maps): mount the tour itinerary map only when it scrolls near"
```

---

### Task 6: Don't recompute the same route twice in a session

`ItineraryBuilder` redraws on every (debounced) edit, and visitors bounce between tours. Same stops → same road.

**Files:**

- Modify: `src/components/maps/RouteMap.tsx` (around the `computeRoutes` call, ~line 263)

- [ ] **Step 1: Implement** a module-level memo keyed by the rounded coordinates:

```ts
/** Same stops → same road. Route paths memoised per page session (not persisted) so a builder edit
 *  that ends where it started, or a revisit, doesn't bill computeRoutes again. */
const routeMemo = new Map<string, google.maps.LatLngLiteral[]>();
const routeKey = (pts: google.maps.LatLngLiteral[]) =>
  pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
```

Before calling `computeRoutes`, check `routeMemo.get(routeKey(points))`; on a hit draw it with `new google.maps.Polyline({ path, strokeColor: '#0E8C92', strokeWeight: 4, strokeOpacity: 0.9, map })` (tracked like the others), set `path`/`drewRoute`, and skip the call. On a miss, after a successful `computeRoutes`, `routeMemo.set(routeKey(points), path)`.

- [ ] **Step 2: Verify.** `npm run typecheck`; in dev, open the custom-trip builder, change a stop and change it back → the second draw makes no `computeRoutes` request.

- [ ] **Step 3: Commit**

```bash
git add src/components/maps/RouteMap.tsx
git commit -m "perf(maps): memoise computed routes per session"
```

---

### Task 7: Write the rule down so it never recurs

**Files:**

- Modify: `docs/handbook/landmines.md`, `docs/handbook/services.md` (Google Maps section)

- [ ] **Step 1: Landmine entry** (append):

```md
### Google Maps bills per call above a small free monthly allowance (Oct 2026: $68)

Every Geocoding / Routes / Places call made on a page view is multiplied by every visitor AND every
crawler. Rules for any map or place feature:

- Never geocode a fixed place per visitor. Store its coordinates (tour stops: `_place-coords.gen.ts`
  via `scripts/build-place-coords.mjs`; activities: `activities.lat/lng`).
- Mount a map with `useNearViewport` — not on page load.
- A Places Text Search page is one billed request: ask for `maxPages: 1` unless the UI shows > 20.
- Cache Places searches/details in `places_cache`; photos go through the edge-cached `/api/planner/photo`.
- Daily quotas + a $5 budget alert are set in Google Cloud console (plan 2026-11-10). If a feature
  "stops working" on a busy day, check Quotas before debugging code.
```

- [ ] **Step 2:** In `services.md`, next to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, add one line: "Quota-capped per day — see landmines.md 'Google Maps bills per call'."

- [ ] **Step 3: Commit**

```bash
git add docs/handbook/landmines.md docs/handbook/services.md
git commit -m "docs(handbook): the Google Maps cost rules and where the caps live"
```

---

### Task 8: Gate, ship, measure

- [ ] **Step 1: Full gate.**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build`
Expected: all green.

- [ ] **Step 2: Push** `git push origin main`; wait for the GitHub Actions `verify` job's final _Edge bundle_ step to be green (the only trustworthy build gate; `pages:build` fails on Windows).

- [ ] **Step 3: Measure after 7 days.** Billing → Reports → Group by SKU, current month, plus APIs & Services → each API → Metrics. Expected per-month run rate: Geocoding < 500, Routes < 5,000, Text Search < 600, Photos < 800. Also on prod:

```sql
select created_at::date, split_part(key, ':', 1) kind, count(*)
from places_cache where created_at > now() - interval '7 days'
group by 1, 2 order by 1 desc;
```

(each row ≈ one billed Places search `s` or details `d` cache miss).

- [ ] **Step 4:** If any SKU still trends above its allowance, its Task 0 quota keeps the bill at $0; open a follow-up for that SKU with the numbers.
