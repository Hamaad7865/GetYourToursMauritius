# ZilAi / Planner endpoints — mobile contract

These power the **ZilAi** AI Road-Trip Planner. They live **outside `/api/v1`** (under `/api/ai/*`,
`/api/planner/*`, plus two image helpers), so they are **not in `/api/v1/openapi`** — this doc is their
typed contract for the Flutter client.

## Conventions

- All routes are edge runtime. JSON responses use the **same success envelope** as v1:
  `{ ok: true, data: <body>, meta?: {...} }`; errors `{ ok: false, error: { code, message, details? } }`.
  (The two image routes return raw image bytes on success, JSON only on error.)
- **Auth:** public + optional bearer (`authenticateOptional`) — no token = anonymous; a _present-but-invalid_
  token = 401; a valid token is accepted but never required.
- **Rate limiting:** per-IP, per-route, DB-backed, keyed on `cf-connecting-ip` (60s window). On limit →
  `429` `{ error.code: "rate_limited" }`. Cloudflare is the documented primary edge control. **Mobile
  note:** app traffic shares a NAT/IP more than web; expect 429s under load and back off. These caps were
  set for web abuse posture — review before high-volume app use.

## Shared types

```ts
type PlannerPlace = {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  durationMin: number;
  closesAt: string | null;
  blurb: string | null;
  imageUrl: string | null; // imageUrl is a /api/planner/photo proxy URL
};
type PlannedRoute = {
  legs: { km: number; minutes: number }[];
  totalKm: number;
  totalMinutes: number;
  estimate: boolean; // estimate=true → haversine fallback
};
```

---

## POST `/api/ai/trip-planner`

One turn of the grounded ZilAi co-pilot (Gemini tool-calling, grounded in live Google Places + Routes).
Rate limit **15 / 60s**.

- **Body:**
  ```ts
  { messages: { role: 'user' | 'assistant'; content: string /*1..4000*/ }[] /*1..12*/,
    itinerary?: PlannerPlace[] /*max 12*/ }
  ```
- **`data`:**
  ```ts
  { reply: string; places: PlannerPlace[]; route: PlannedRoute | null;
    rejectedFarRegion: string[]; droppedOverCap: string[] }
  ```
  No model configured → graceful fallback `reply`, `places: []`, `route: null`.

## POST `/api/ai/place-insights`

One AI insight per place + an overall day tip (Gemini `generateObject`). Rate limit **30 / 60s**.

- **Body:** `{ places: { name: string/*1..200*/; category: string/*<=60*/; region: string/*<=60*/ }[] /*1..12*/ }`
- **`data`:** `{ insights: { overall: string; items: { name: string; insight: string }[] } | null }`
  (`null` when no model / empty input).

## POST `/api/planner/optimize`

Optimal driving order via Google Route Optimization (service-account auth). Best-effort. Rate limit **30 / 60s**.

- **Body:** `{ pickup: { lat: number; lng: number }, stops: { lat: number; lng: number }[] /*1..25*/ }`
- **`data`:** `{ order: number[] | null }` — original stop indices in optimal order; `null` when unavailable
  (`stops.length < 2`, no service account, upstream error) → keep current order.

## GET `/api/planner/places`

Live place discovery from Google Places (New). Rate limit **30 / 60s**. Edge-cached 1h.

- **Query:** `ids` (comma-separated place ids, first 25) → resolve by id; else `q` + `category` + `region` → search.
  No Maps key configured → `data: []`.
- **`data`:** `PlannerPlace[]`.

## GET `/api/planner/from-tour`

Preload a sightseeing tour's itinerary into the planner (resolves each stop to a real place). Rate limit
**30 / 60s**. Edge-cached 1h.

- **Query:** `slug` (activity slug).
- **`data`:** `{ tour: string | null /*activity title*/, slug: string, places: PlannerPlace[] }`. Unknown
  slug / empty → `{ tour: null, slug, places: [] }`.

## GET `/api/planner/photo`

Server proxy for a Google Places photo (keeps the Maps key server-side). **No auth, no rate limit.**

- **Query:** `ref` — must match `^places/[\w-]+/photos/[\w-]+$`, else `400`. No key → `404`; upstream fail → `502`.
- **Success:** raw image bytes, `Content-Type` from upstream, `Cache-Control: public, max-age=86400, immutable`.

## GET `/api/img`

Caches + re-serves an allowlisted remote image (currently host `upload.wikimedia.org` only). **No auth, no
rate limit.**

- **Query:** `u` — an `https://` URL on the allowlisted host. Invalid → `400`; upstream fail → `404`.
- **Success:** raw image bytes, `Cache-Control: public, max-age=86400, immutable`.

---

## Booking from the planner

The planner has **no dedicated booking endpoint**. A planned day → quote → hold → checkout reuses the
generic `/api/v1/holds` + `/api/v1/bookings` (`api_book`) with `vehicle_custom` pricing. The web handoff is
web-coupled (sessionStorage → `/checkout`); the mobile client must reproduce that orchestration natively and
mirror the `vehicle_custom` rates. (Transfer quotes have a dedicated read endpoint — see
`GET /api/v1/transfers/quote`.)

## Internal-only (NOT for mobile)

`POST /api/v1/internal/notifications/drain` and `POST /api/v1/internal/maintenance` require the
`INTERNAL_TASK_SECRET` (`x-internal-secret` header or Bearer), run as service-role, and are cron-only.
