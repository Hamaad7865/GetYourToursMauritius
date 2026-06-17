# AI Road Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a chat-led AI Road Trip Planner page where a visitor describes a day, a grounded Gemini co-pilot builds a map-backed itinerary from a curated Mauritius place list with real Google drive times, and converts it into a taxi/day-trip quote priced by an admin-editable vehicle table.

**Architecture:** Follows the existing seams exactly — Postgres `api_*` SECURITY DEFINER functions for public data + writes (called via `ctx.db.rpc`), direct browser-client table writes under RLS for admin editing (the `categories` pattern), framework-agnostic service layer (`ServiceContext`), edge route handlers wrapped in `apiHandler`, and a `'use client'` React page composed from focused components. New facts (places, drive times, vehicle prices) always come from the DB/Google — never invented by the model.

**Tech Stack:** Next.js 15 App Router (edge runtime), Supabase Postgres + RLS, `ai` ^4.1.46 + `@ai-sdk/google` ^1.1.17 (Gemini Flash), Google Distance Matrix API, Tailwind (brand tokens), Vitest + PGlite.

---

## Decisions locked (from brainstorming)

- **Interaction:** chat-led **hybrid** page — co-pilot chat + live itinerary + map (not chat-only).
- **Goal:** convert to **taxi/day-trip quotes** (lead capture, human confirms — mirrors competitor but instant + grounded).
- **Grounding (V1):** **curated `planner_places` seed table** + **real Google Distance Matrix** drive times. (V2, out of scope here: live Google Places discovery.)
- **AI:** **tool-calling Gemini agent** (Approach A) with caching, on `gemini-1.5-flash`, behind the swappable provider seam.
- **Pricing:** flat **vehicle day-rate by party size**, **admin-editable** (DB table + admin editor). Default tiers:

  | Party | Vehicle | Price (EUR) | `is_suv` |
  |---|---|---|---|
  | 1–4 | Standard car (4-seat) | 95 | false |
  | 1–4 | SUV (upgrade) | 100 | true |
  | 5–6 | 6-seater car | 110 | false |
  | 7–14 | Van (14-seat) | 150 | false |
  | 15–22 | Coach (22-seat) | 250 | false |

  Party > 22 → no tier → "contact us". Planner shows "from €95" until party chosen; exact at quote.
- **Place-count rule:** **soft warning** when a 6th place is added ("more than 5 places is extremely hard and you won't have time to explore each site well"); adding still allowed.
- **Design source:** `C:\Users\sheik\Downloads\Untitled-handoff\untitled\project\Mauritius AI Road Trip Planner.dc.html` (Claude Design prototype) — recreate its visual output; do not copy its placeholder distance-based pricing.

---

## Shared contracts (the spine — referenced by every milestone)

### TypeScript types — `src/lib/planner/types.ts`

```typescript
export interface PlannerPlace {
  id: string;          // stable slug, e.g. 'le-morne'
  name: string;
  category: string;    // 'Beach' | 'Waterfall' | 'Viewpoint' | 'Nature' | 'Culture' | 'Garden' | 'Island' | 'Food'
  region: string;      // 'North' | 'South' | 'East' | 'West' | 'Central'
  lat: number;
  lng: number;
  durationMin: number; // ideal time spent on site
  closesAt: string | null; // 'HH:MM' local, or null
  blurb: string;
  imageUrl: string | null;
}

export interface PlannerPickup { id: string; name: string; lat: number; lng: number; }

export interface VehicleTier {
  id: string;
  label: string;       // 'Standard car'
  vehicleName: string; // 'Toyota 4-seater'
  minParty: number;
  maxParty: number;
  priceEur: number;    // whole euros for display; stored as price_minor
  isSuv: boolean;
  position: number;
}

export interface RouteLeg { fromId: string; toId: string; km: number; minutes: number; }
export interface PlannedRoute {
  legs: RouteLeg[];
  totalKm: number;
  totalMinutes: number;
  estimate: boolean;   // true when Distance Matrix unavailable and haversine fallback used
}

export interface TaxiQuoteItinerary {
  pickupId: string;
  stopIds: string[];          // ordered
  date: string;               // ISO date
  time: string;               // 'HH:MM'
  party: number;
  vehicleTierId: string | null;
}
```

### Database objects (new)

- Table `vehicle_pricing`: `id uuid pk`, `label text not null`, `vehicle_name text not null`, `min_party int not null`, `max_party int not null`, `price_minor int not null`, `is_suv boolean not null default false`, `position int not null default 0`, `created_at timestamptz`. **Public read, staff write.**
- Table `planner_places`: `id text pk` (slug), `name text not null`, `category text not null`, `region text not null`, `lat numeric not null`, `lng numeric not null`, `duration_min int not null`, `closes_at time`, `blurb text`, `image_url text`, `position int not null default 0`, `created_at timestamptz`. **Public read, staff write.** Seeded.
- `leads` additions: `lead_type text not null default 'standard'`, `metadata jsonb not null default '{}'::jsonb`.
- Trigger `leads_enqueue_notification` AFTER INSERT → `notification_outbox` (template `lead_captured`, idempotency `lead_captured:<id>`).

### `api_*` functions (new — SECURITY DEFINER, single `p jsonb` arg, return jsonb)

- `api_planner_places(p jsonb)` → `[{id,name,category,region,lat,lng,durationMin,closesAt,blurb,imageUrl}]` (public).
- `api_vehicle_pricing(p jsonb)` → `[{id,label,vehicleName,minParty,maxParty,priceEur,isSuv,position}]` (public).
- `api_capture_taxi_quote(p jsonb)` → inserts a lead with `source='ai_road_trip_planner'`, `lead_type='taxi_quote'`, server-recomputed price into `metadata`; returns `{id,status,vehicle,priceEur}`. Granted to anon/authenticated/service_role. Re-derives vehicle+price from `vehicle_pricing` (never trusts client price).

> **pgliteRpc allowlist** (`tests/db/rpc.ts`) must add: `api_planner_places`, `api_vehicle_pricing`, `api_capture_taxi_quote`.

### Naming used across milestones (keep identical)

- Service fns: `listPlannerPlaces(ctx)`, `listVehiclePricing(ctx)`, `captureTaxiQuote(ctx, input)`, `planRoute(ctx, input)`, `runPlannerTurn(ctx, input)`.
- Pure fns: `selectVehicleTier(tiers, party, preferSuv)`, `placeCountWarning(stopCount)`.
- Distance client: `getDistanceMatrix(legs, apiKey)` in `src/lib/maps/distance.ts`; `haversineLeg(a, b)` in `src/lib/maps/haversine.ts`.

---

## File structure (whole feature)

```
supabase/migrations/
  20260617180000_vehicle_pricing.sql        # M1: table + RLS + seed + api_vehicle_pricing
  20260617180100_planner_places.sql         # M1: table + RLS + seed + api_planner_places
  20260617180200_taxi_quote.sql             # M1: leads cols + api_capture_taxi_quote + trigger
supabase/catch-up.sql                        # M1: append all three (idempotent)

src/lib/planner/
  types.ts                                   # M1: shared types (above)
  pricing.ts                                 # M1: selectVehicleTier, placeCountWarning (pure)
src/lib/services/
  planner.ts                                 # M1: listPlannerPlaces, listVehiclePricing, captureTaxiQuote
  agent.ts                                   # M3: implement runPlannerTurn (replaces NotImplemented stub usage)
src/lib/maps/
  haversine.ts                               # M2: fallback leg estimate
  distance.ts                                # M2: Google Distance Matrix client
src/lib/services/route-planning.ts           # M2: planRoute (Distance Matrix + fallback + cache)
src/lib/ai/
  planner-agent.ts                           # M3: Gemini streamText + tool definitions
  planner-tools.ts                           # M3: tool handlers (call service fns only)
src/lib/admin/
  vehicle-pricing.ts                         # M4: load/create/update/move/delete (browser client)
src/lib/validation/
  planner.ts                                 # M1/M3: zod schemas (taxi quote input, chat input)

app/api/v1/taxi-quotes/route.ts              # M1: POST → captureTaxiQuote
app/api/ai/trip-planner/route.ts             # M3: POST streaming chat
app/admin/vehicle-pricing/page.tsx           # M4: admin editor page
app/ai-road-trip-planner/page.tsx            # M5: public planner page (server shell)

src/components/admin/AdminVehiclePricing.tsx # M4
src/components/planner/
  PlannerShell.tsx                           # M5: 'use client' root, owns state
  ItineraryPanel.tsx                         # M5
  ChatCopilot.tsx                            # M5
  PlacesDrawer.tsx                           # M5
  MapView.tsx                                # M5 (Google Maps via useGoogleMaps, RouteMap-style)
  QuoteModal.tsx                             # M5
  usePlannerData.ts                          # M5: read places + vehicle tiers (browser client)

tests/
  unit/planner-pricing.test.ts              # M1
  integration/planner-data.test.ts          # M1
  integration/taxi-quote.test.ts            # M1
  unit/maps-distance.test.ts                # M2
  integration/route-planning.test.ts        # M2
  integration/planner-agent.test.ts         # M3
  integration/admin-vehicle-pricing.test.ts # M4 (uses tests/db/supabase-pglite.ts shim)
```

---

## Milestone roadmap

Each milestone ends green (typecheck + lint + test + build) and is independently shippable.

1. **Data foundation & pricing logic** — migrations (vehicle_pricing, planner_places + seed, leads taxi-quote), pure pricing/warning logic, read + capture service fns, `POST /api/v1/taxi-quotes`. *No UI.* **(Fully detailed below.)**
2. **Drive-time service** — Distance Matrix client + haversine fallback + `planRoute` with caching. *(Scoped below.)*
3. **AI co-pilot** — Gemini tool-calling agent + chat persistence + streaming `POST /api/ai/trip-planner`. *(Scoped below.)*
4. **Admin vehicle-pricing editor** — table-driven editor mirroring `AdminCategories`. *(Scoped below.)*
5. **Planner UI** — the page + components recreating the design, wired to M1–M3. *(Scoped below.)*

Dependency order: M1 → (M2, M4 in parallel) → M3 (needs M1+M2) → M5 (needs M1+M2+M3).

---

## Cross-cutting prerequisites

- **Google Cloud:** enable **Distance Matrix API** on the project that owns the Maps key. Add server env `GOOGLE_MAPS_API_KEY` (server-only) to `ServerEnvSchema` in `src/lib/config/env.ts` as `z.string().min(1).optional()`, falling back to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. (M2.)
- **Gemini:** `GOOGLE_GENERATIVE_AI_API_KEY` already in env schema; `AI_PROVIDER=google` default. No new key needed. (M3.)
- **`.env.example`:** document `GOOGLE_MAPS_API_KEY`. (M2.)
- **Worktree:** start a fresh branch off `main` via the using-git-worktrees skill before executing (this feature is independent of the open `activity-write` PR).
- **Every new migration is appended verbatim (BEGIN/COMMIT, idempotent) to `supabase/catch-up.sql`** — the live-DB deploy artifact.

---

## Milestone 1: Data foundation & pricing logic

**Outcome:** seeded `planner_places` + admin-editable `vehicle_pricing`, a pure vehicle-pricing/warning module, read + capture service functions, and a public `POST /api/v1/taxi-quotes` endpoint that records a grounded taxi-quote lead with a server-recomputed price. Fully tested; no UI.

### Task 1.1: Shared planner types

**Files:**
- Create: `src/lib/planner/types.ts`

- [ ] **Step 1: Create the types file** with the exact contents from **Shared contracts → TypeScript types** above (`PlannerPlace`, `PlannerPickup`, `VehicleTier`, `RouteLeg`, `PlannedRoute`, `TaxiQuoteItinerary`).

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/planner/types.ts
git commit -m "feat(planner): shared types for places, vehicle tiers, routes"
```

### Task 1.2: Pure pricing + warning logic (TDD)

**Files:**
- Create: `src/lib/planner/pricing.ts`
- Test: `tests/unit/planner-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { selectVehicleTier, placeCountWarning } from '@/lib/planner/pricing';
import type { VehicleTier } from '@/lib/planner/types';

const TIERS: VehicleTier[] = [
  { id: 'std', label: 'Standard car', vehicleName: '4-seater', minParty: 1, maxParty: 4, priceEur: 95, isSuv: false, position: 0 },
  { id: 'suv', label: 'SUV', vehicleName: 'SUV', minParty: 1, maxParty: 4, priceEur: 100, isSuv: true, position: 1 },
  { id: 'six', label: '6-seater', vehicleName: '6-seater', minParty: 5, maxParty: 6, priceEur: 110, isSuv: false, position: 2 },
  { id: 'van', label: 'Van', vehicleName: '14-seat van', minParty: 7, maxParty: 14, priceEur: 150, isSuv: false, position: 3 },
  { id: 'coach', label: 'Coach', vehicleName: '22-seat coach', minParty: 15, maxParty: 22, priceEur: 250, isSuv: false, position: 4 },
];

describe('selectVehicleTier', () => {
  it('picks the standard 4-seater for a small group by default', () => {
    expect(selectVehicleTier(TIERS, 3, false)?.id).toBe('std');
  });
  it('picks the SUV for a small group when preferred', () => {
    expect(selectVehicleTier(TIERS, 4, true)?.id).toBe('suv');
  });
  it('ignores the SUV preference above 4 people', () => {
    expect(selectVehicleTier(TIERS, 6, true)?.id).toBe('six');
  });
  it('picks the van for 10 and the coach for 20', () => {
    expect(selectVehicleTier(TIERS, 10, false)?.id).toBe('van');
    expect(selectVehicleTier(TIERS, 20, false)?.id).toBe('coach');
  });
  it('returns null above the largest tier (contact us)', () => {
    expect(selectVehicleTier(TIERS, 30, false)).toBeNull();
  });
});

describe('placeCountWarning', () => {
  it('is null for five or fewer stops', () => {
    expect(placeCountWarning(5)).toBeNull();
  });
  it('warns at six or more stops', () => {
    expect(placeCountWarning(6)).toMatch(/more than 5 places/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/planner-pricing.test.ts`
Expected: FAIL — "Cannot find module '@/lib/planner/pricing'".

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { VehicleTier } from './types';

/**
 * Pick the cheapest matching vehicle tier for a party size. For small groups (a tier with
 * minParty<=party<=maxParty), an SUV preference selects the is_suv tier of the same band.
 * Returns null when the party exceeds every tier (caller shows "contact us").
 */
export function selectVehicleTier(
  tiers: VehicleTier[],
  party: number,
  preferSuv: boolean,
): VehicleTier | null {
  const band = tiers
    .filter((t) => party >= t.minParty && party <= t.maxParty)
    .sort((a, b) => a.priceEur - b.priceEur);
  if (band.length === 0) return null;
  if (preferSuv) {
    const suv = band.find((t) => t.isSuv);
    if (suv) return suv;
  }
  const nonSuv = band.find((t) => !t.isSuv);
  return nonSuv ?? band[0]!;
}

const MAX_COMFORTABLE_STOPS = 5;

/** Soft warning copy when a day has too many stops; null when within limits. */
export function placeCountWarning(stopCount: number): string | null {
  if (stopCount <= MAX_COMFORTABLE_STOPS) return null;
  return "More than 5 places in one day is extremely hard — you won't have time to explore each site well.";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/planner-pricing.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/pricing.ts tests/unit/planner-pricing.test.ts
git commit -m "feat(planner): vehicle-tier selection + place-count warning (pure, TDD)"
```

### Task 1.3: Migration — `vehicle_pricing` table + seed + read RPC

**Files:**
- Create: `supabase/migrations/20260617180000_vehicle_pricing.sql`
- Modify: `supabase/catch-up.sql` (append the same block)

- [ ] **Step 1: Write the migration** (idempotent; mirrors the `categories` table + RLS pattern, public read since the planner shows prices)

```sql
begin;

create table if not exists vehicle_pricing (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  vehicle_name text not null,
  min_party int not null check (min_party >= 1),
  max_party int not null check (max_party >= min_party),
  price_minor int not null check (price_minor >= 0),
  is_suv boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists vehicle_pricing_position_idx on vehicle_pricing (position);

alter table vehicle_pricing enable row level security;
grant select on vehicle_pricing to anon, authenticated;
grant insert, update, delete on vehicle_pricing to authenticated;

drop policy if exists vehicle_pricing_read on vehicle_pricing;
create policy vehicle_pricing_read on vehicle_pricing for select using (true);
drop policy if exists vehicle_pricing_staff on vehicle_pricing;
create policy vehicle_pricing_staff on vehicle_pricing for all using (is_staff()) with check (is_staff());

-- Seed the default tiers (only when empty, so re-running never duplicates).
insert into vehicle_pricing (label, vehicle_name, min_party, max_party, price_minor, is_suv, position)
select * from (values
  ('Standard car', 'Comfort 4-seater', 1, 4, 9500, false, 0),
  ('SUV', 'SUV (4 seats)', 1, 4, 10000, true, 1),
  ('6-seater car', '6-seater', 5, 6, 11000, false, 2),
  ('Van', '14-seat van', 7, 14, 15000, false, 3),
  ('Coach', '22-seat coach', 15, 22, 25000, false, 4)
) as v(label, vehicle_name, min_party, max_party, price_minor, is_suv, position)
where not exists (select 1 from vehicle_pricing);

create or replace function api_vehicle_pricing(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'label', label, 'vehicleName', vehicle_name,
    'minParty', min_party, 'maxParty', max_party,
    'priceEur', price_minor / 100.0, 'isSuv', is_suv, 'position', position
  ) order by position), '[]'::jsonb)
  from vehicle_pricing;
$$;
grant execute on function api_vehicle_pricing(jsonb) to anon, authenticated, service_role;

commit;
```

- [ ] **Step 2: Append the identical block to `supabase/catch-up.sql`** (end of file, before/after existing blocks, preserving idempotency).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617180000_vehicle_pricing.sql supabase/catch-up.sql
git commit -m "feat(db): vehicle_pricing table + seed + api_vehicle_pricing"
```

### Task 1.4: Migration — `planner_places` table + seed + read RPC

**Files:**
- Create: `supabase/migrations/20260617180100_planner_places.sql`
- Modify: `supabase/catch-up.sql`

- [ ] **Step 1: Write the migration.** Table + RLS (public read, staff write) + `api_planner_places` returning the camelCase DTO. Seed with the curated list transcribed from the design prototype's `PLACES` map (id slug, name, category, region, lat, lng, durationMin, closesAt, blurb). Seed at least these 13 (extendable later by staff): `le-morne, chamarel-waterfall, seven-coloured-earths, gris-gris, grand-bassin, trou-aux-cerfs, black-river-gorges, ile-aux-cerfs, belle-mare-beach, cap-malheureux, grand-baie, pamplemousses-garden, chamarel-lunch`. Use `closes_at` for Chamarel waterfall/earths (`17:00`) and Pamplemousses (`17:30`); null elsewhere. Guard the seed with `where not exists (select 1 from planner_places)`.

```sql
-- shape (full coordinates/blurbs transcribed from the design PLACES map):
create table if not exists planner_places (
  id text primary key,
  name text not null,
  category text not null,
  region text not null,
  lat numeric(9,6) not null,
  lng numeric(9,6) not null,
  duration_min int not null check (duration_min > 0),
  closes_at time,
  blurb text,
  image_url text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
-- + indexes (region, category, position), RLS (planner_places_read using(true); planner_places_staff is_staff()),
-- grants (select anon/authenticated; insert/update/delete authenticated),
-- seed INSERT ... where not exists, and api_planner_places(p jsonb) returning the camelCase array.
```

- [ ] **Step 2: Append to `supabase/catch-up.sql`.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617180100_planner_places.sql supabase/catch-up.sql
git commit -m "feat(db): planner_places curated seed + api_planner_places"
```

### Task 1.5: Migration — taxi-quote leads (cols + capture RPC + notify trigger)

**Files:**
- Create: `supabase/migrations/20260617180200_taxi_quote.sql`
- Modify: `supabase/catch-up.sql`

- [ ] **Step 1: Write the migration.**

```sql
begin;

alter table leads add column if not exists lead_type text not null default 'standard';
alter table leads add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Capture a taxi-quote lead. Server RE-DERIVES the vehicle + price from vehicle_pricing
-- (never trusts a client price). Stores the full itinerary in metadata.
create or replace function api_capture_taxi_quote(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party int := greatest(1, coalesce((p ->> 'party')::int, 1));
  v_prefer_suv boolean := coalesce((p ->> 'preferSuv')::boolean, false);
  v_tier vehicle_pricing;
  v_lead leads;
begin
  select * into v_tier from vehicle_pricing
   where v_party between min_party and max_party
   order by (is_suv = v_prefer_suv) desc, price_minor asc
   limit 1;

  insert into leads (name, contact, source, lead_type, metadata)
  values (
    coalesce(nullif(btrim(p ->> 'name'), ''), 'Road-trip enquiry'),
    coalesce(nullif(btrim(p ->> 'contact'), ''), ''),
    'ai_road_trip_planner', 'taxi_quote',
    jsonb_build_object(
      'pickupId', p ->> 'pickupId',
      'stopIds', coalesce(p -> 'stopIds', '[]'::jsonb),
      'date', p ->> 'date', 'time', p ->> 'time',
      'party', v_party, 'preferSuv', v_prefer_suv,
      'vehicleLabel', v_tier.label, 'vehicleName', v_tier.vehicle_name,
      'priceMinor', v_tier.price_minor,
      'routeMinutes', (p ->> 'routeMinutes')::int, 'routeKm', (p ->> 'routeKm')::int
    )
  )
  returning * into v_lead;

  return jsonb_build_object(
    'id', v_lead.id, 'status', v_lead.status,
    'vehicleLabel', v_tier.label,
    'priceEur', case when v_tier.id is null then null else v_tier.price_minor / 100.0 end
  );
end;
$$;
grant execute on function api_capture_taxi_quote(jsonb) to anon, authenticated, service_role;

-- Notify staff on every new lead (idempotent).
create or replace function enqueue_lead_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_outbox (channel, recipient, template, payload, idempotency_key)
  values ('email', new.contact, 'lead_captured',
    jsonb_build_object('leadId', new.id, 'leadType', new.lead_type, 'name', new.name, 'metadata', new.metadata),
    'lead_captured:' || new.id)
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;
drop trigger if exists leads_enqueue_notification on leads;
create trigger leads_enqueue_notification after insert on leads
  for each row execute function enqueue_lead_notification();

commit;
```

> Note: confirm `notification_outbox` columns/`idempotency_key` unique constraint match (research shows the booking trigger uses the same shape). If `recipient` must be a staff address rather than the customer contact, adjust `recipient` accordingly during implementation.

- [ ] **Step 2: Append to `supabase/catch-up.sql`.**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617180200_taxi_quote.sql supabase/catch-up.sql
git commit -m "feat(db): taxi-quote lead capture (server-priced) + lead notify trigger"
```

### Task 1.6: Extend the test RPC allowlist

**Files:**
- Modify: `tests/db/rpc.ts`

- [ ] **Step 1: Add the three new function names** to the `ALLOWED` set: `api_planner_places`, `api_vehicle_pricing`, `api_capture_taxi_quote`.

- [ ] **Step 2: Commit**

```bash
git add tests/db/rpc.ts
git commit -m "test(db): allow planner api_* functions in pglite rpc adapter"
```

### Task 1.7: Data-layer integration test (places + vehicle pricing seeded)

**Files:**
- Test: `tests/integration/planner-data.test.ts`

- [ ] **Step 1: Write the failing test** — create a PGlite db, read both seeds via the RPCs, assert.

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

async function rpc<T>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [JSON.stringify(params)]);
  return rows[0]!.data;
}

describe('planner data layer', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); await db.as(null); });
  afterAll(async () => { await db.close(); });

  it('seeds vehicle pricing with the five default tiers', async () => {
    const tiers = await rpc<Array<{ label: string; priceEur: number; isSuv: boolean }>>(db, 'api_vehicle_pricing', {});
    expect(tiers.length).toBe(5);
    expect(tiers.find((t) => t.isSuv)?.priceEur).toBe(100);
    expect(tiers.find((t) => t.label === 'Coach')?.priceEur).toBe(250);
  });

  it('seeds curated planner places with coordinates', async () => {
    const places = await rpc<Array<{ id: string; lat: number; lng: number; closesAt: string | null }>>(db, 'api_planner_places', {});
    expect(places.length).toBeGreaterThanOrEqual(13);
    const cham = places.find((p) => p.id === 'chamarel-waterfall');
    expect(cham?.closesAt).toBe('17:00:00');
    expect(typeof cham?.lat).toBe('number');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/planner-data.test.ts` → expect PASS (migrations auto-apply). If FAIL, fix the migration (not the test).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/planner-data.test.ts
git commit -m "test(planner): vehicle pricing + curated places seed integration"
```

### Task 1.8: Taxi-quote capture integration test (server pricing authority)

**Files:**
- Test: `tests/integration/taxi-quote.test.ts`

- [ ] **Step 1: Write the failing test** — call `api_capture_taxi_quote` as anon with a party size and a deliberately-wrong client price; assert the returned price comes from the seeded tiers, a lead row exists with `lead_type='taxi_quote'` and the itinerary in `metadata`, and a `lead_captured` row landed in `notification_outbox`.

```typescript
// key assertions:
// - party 6 -> vehicleLabel '6-seater', priceEur 110 (ignores any client-sent price)
// - party 2 + preferSuv true -> priceEur 100
// - leads row: lead_type='taxi_quote', source='ai_road_trip_planner', metadata.stopIds length matches
// - notification_outbox has one row template='lead_captured'
// (read back via db.asOwner() raw SQL)
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/taxi-quote.test.ts` → PASS (RPC already exists from Task 1.5). If the trigger/notification assertion fails, fix the migration.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/taxi-quote.test.ts
git commit -m "test(planner): taxi-quote capture is server-priced + notifies"
```

### Task 1.9: Service functions + validation + route

**Files:**
- Create: `src/lib/validation/planner.ts` (zod `taxiQuoteInputSchema`)
- Create: `src/lib/services/planner.ts` (`listPlannerPlaces`, `listVehiclePricing`, `captureTaxiQuote`)
- Create: `app/api/v1/taxi-quotes/route.ts` (edge, `apiHandler`, `authenticateOptional`, `buildServiceContext`, `captureTaxiQuote`, `jsonOk(..., {status:201})`)
- Test: extend `tests/integration/services.test.ts` or add `tests/integration/planner-service.test.ts`

- [ ] **Step 1: Write a failing service test** — build a `ServiceContext` with `pgliteRpc(db.pg)` + stubs; call `listVehiclePricing(ctx)` (expect 5), `listPlannerPlaces(ctx)` (>=13), `captureTaxiQuote(ctx, {party:8,...})` (vehicleLabel 'Van', priceEur 150).
- [ ] **Step 2: Run → fail** (services don't exist).
- [ ] **Step 3: Implement** the three service fns (each `callRpc(ctx, 'api_*', params)` + zod parse), the zod input schema, and the route handler (mirror `app/api/v1/leads/route.ts`, honeypot optional, IP passthrough).
- [ ] **Step 4: Run → pass.** Then `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/planner.ts src/lib/services/planner.ts app/api/v1/taxi-quotes/route.ts tests/integration/planner-service.test.ts
git commit -m "feat(planner): read services + taxi-quote capture service + route"
```

### Task 1.10: Milestone 1 green gate

- [ ] **Step 1:** Run `npm run typecheck && npm run lint && npm run test && npm run build`. Expected: all pass (note: wipe `.next` and rebuild if `next build` throws the one-off Windows `_not-found` ENOENT).
- [ ] **Step 2: Commit** any lint/format fixups.

---

## Milestone 2: Drive-time service *(scope — expand to bite-sized tasks at execution)*

**Outcome:** `planRoute(ctx, { pickup, stops })` returns `PlannedRoute` (per-leg + total km/minutes) from Google Distance Matrix, with a haversine fallback (`estimate:true`) and a 24h in-memory cache keyed by `lat,lng->lat,lng`.

- **`src/lib/maps/haversine.ts`** — `haversineLeg(a:{lat,lng}, b:{lat,lng}): RouteLeg`-shaped `{km, minutes}` using great-circle × 1.32 road factor and ~38 km/h (mirrors the design's `legKm`/`legMin`). Unit-tested for a known Mauritius pair.
- **`src/lib/maps/distance.ts`** — `getDistanceMatrix(legs, apiKey)` via native `fetch` to the Distance Matrix endpoint; zod-parse the response; throw `ProviderError` on non-`OK` element status; **check `element.status`, not just top-level**. Unit-tested with mocked `fetch` (OK, ZERO_RESULTS, quota error → ProviderError, missing key → ConfigError).
- **`src/lib/services/route-planning.ts`** — `planRoute`: build legs `pickup → s1 → … → sn → pickup`; call `getDistanceMatrix`; on any failure log + fall back to `haversineLeg` per leg and set `estimate:true`; cache results. Add `GOOGLE_MAPS_API_KEY` to `env.ts` + `.env.example`.
- **Tests:** `tests/unit/maps-distance.test.ts` (mock fetch), `tests/integration/route-planning.test.ts` (inject a fake distance client / stubbed fetch; assert totals sum and fallback path).
- **Acceptance:** totals equal the sum of legs; fallback flagged; no real network in tests; green gate.

## Milestone 3: AI co-pilot *(scope)*

**Outcome:** a grounded streaming co-pilot. `POST /api/ai/trip-planner` accepts `{ sessionId?, messages }`, runs a Gemini tool-calling loop, persists the turn to `chat_sessions`/`chat_messages`, and streams the reply.

- **`src/lib/ai/planner-tools.ts`** — tool definitions whose handlers call **service functions only** (never invent facts): `search_places` (→ `listPlannerPlaces` filtered), `plan_route` (→ `planRoute`), `vehicle_price` (→ `listVehiclePricing` + `selectVehicleTier`), `place_count_warning` (→ `placeCountWarning`). Each returns structured JSON.
- **`src/lib/ai/planner-agent.ts`** — wraps `@ai-sdk/google` `streamText({ model, system, messages, tools })`. System prompt enforces: Mauritius only; **never state a place/closing time/drive time not returned by a tool**; produce an itinerary object; warn at 6+ stops via the tool. Model `gemini-1.5-flash`. Behind the provider seam so tests stub it.
- **`src/lib/services/agent.ts`** — implement `runPlannerTurn(ctx, input)` (replaces the throwing stub usage): load prior `chat_messages`, append user msg, run the agent, persist assistant + tool messages. Add `api_*` chat helpers if direct table writes aren't preferred (e.g. `api_planner_chat_append`); otherwise use a server supabase client.
- **`app/api/ai/trip-planner/route.ts`** — edge, `apiHandler` + `authenticateOptional` + `buildServiceContext`; return a streamed `Response` (text/event-stream), NOT `jsonOk`. Browser calls it cookie-authed (no Bearer).
- **Tests:** `tests/integration/planner-agent.test.ts` with a **stub AI provider** that emits a deterministic tool-call script; assert tools fetch real seeded data, the itinerary is grounded, chat rows persist, and a 6-stop plan surfaces the warning. (Real Gemini is not exercised in CI — mirror the existing stub-AI convention.)
- **Acceptance:** grounded replies; persisted chat; warning at 6+; green gate.

## Milestone 4: Admin vehicle-pricing editor *(scope)*

**Outcome:** staff can edit tiers; planner reflects changes immediately.

- **`src/lib/admin/vehicle-pricing.ts`** — `VehiclePricingRow`/`VehiclePricingInput` + `loadVehiclePricing`, `createVehiclePricing`, `updateVehiclePricing`, `moveVehiclePricing`, `deleteVehiclePricing` — mirror `src/lib/admin/categories.ts` exactly (browser client, position-based ordering, `price_minor` ↔ euros conversion).
- **`src/components/admin/AdminVehiclePricing.tsx`** — mirror `AdminCategories.tsx` (rows/error/busy/editing/form + `run()` wrapper). Form fields: label, vehicleName, minParty, maxParty, priceEur, isSuv.
- **`app/admin/vehicle-pricing/page.tsx`** + nav link in `app/admin/layout.tsx`.
- **Tests:** `tests/integration/admin-vehicle-pricing.test.ts` using the existing **`tests/db/supabase-pglite.ts` shim** (built for the activity-write fix) to drive the write helpers against PGlite under staff RLS; assert create/update/move/delete + that a customer role is denied by RLS.
- **Acceptance:** CRUD works under staff RLS; non-staff denied; green gate.

## Milestone 5: Planner UI *(scope)*

**Outcome:** the public page at `/ai-road-trip-planner` recreating the design, wired end-to-end.

- **`app/ai-road-trip-planner/page.tsx`** — async server component: `GygHeader` + `<PlannerShell/>` + `SiteFooter`; reads initial places/tiers server-side (or lets the client hook fetch).
- **`src/components/planner/usePlannerData.ts`** — fetch `planner_places` + `vehicle_pricing` via the browser client (like `useCategories`).
- **`PlannerShell.tsx`** (`'use client'`) owns state `{ pickup, stops, party, preferSuv, chat, route, drawerOpen, quoteOpen, banner, isMobile, mobileTab }`; computes `route` via `/api/ai/trip-planner` tool results or a `/api/v1/route` preview; computes price via `selectVehicleTier`; shows `placeCountWarning` when stops≥6.
- **`ItineraryPanel.tsx`, `ChatCopilot.tsx`, `PlacesDrawer.tsx`, `MapView.tsx`, `QuoteModal.tsx`** — recreate the design components. `MapView` uses `useGoogleMaps` + the `RouteMap` pattern (real Google Maps; fallback to the design's SVG or `MapLinkCard`). `QuoteModal` party stepper ranges 1–22, SUV toggle when party≤4, live vehicle + price, submit → `POST /api/v1/taxi-quotes` → success state (+ WhatsApp deep link).
- **Deep-link prefill:** read `?stops=a,b,c&tour=Name` on mount → preload stops + "Customizing X" banner (the tour→planner mechanic). **Shareable URL:** reflect current stop ids into the query string.
- **Brand:** Tailwind tokens, Fraunces/Plus Jakarta, modal pattern from `LangCurrencyModal`, toasts via `useToast`. Mobile tab switcher + pinned summary bar (from the design).
- **Tests:** component unit tests for `selectVehicleTier` wiring + warning display; the heavy interaction is validated via the preview workflow. **Verify in the browser preview** (this milestone IS browser-observable) per the verification workflow.
- **Acceptance:** plan a day → see route + price → request quote → lead recorded; deep-link prefill works; responsive; green gate + preview proof.

---

## Self-review notes

- **Spec coverage:** chat co-pilot (M3), map + drive times (M2/M5), grounded curated places (M1/M3), vehicle pricing by party + admin-editable (M1/M4), >5 warning (M1 logic, M5 surface), taxi-quote conversion (M1 + M5), deep-link prefill + shareable URL (M5), brand/responsive (M5). ✅
- **Server price authority:** `api_capture_taxi_quote` recomputes price from `vehicle_pricing` — client never sets the price. ✅
- **Grounding rule:** agent facts come only from tool→service→DB/Google. ✅
- **Naming consistency:** `selectVehicleTier`, `placeCountWarning`, `planRoute`, `listPlannerPlaces`, `listVehiclePricing`, `captureTaxiQuote`, `runPlannerTurn`, `getDistanceMatrix`, `haversineLeg` used identically across milestones. ✅
- **Open confirmations for execution time:** exact `notification_outbox` column/recipient shape (Task 1.5 note); whether to expose chat persistence via `api_*` vs a server supabase client (M3); final curated place list size (seed ≥13, expandable by admin).
