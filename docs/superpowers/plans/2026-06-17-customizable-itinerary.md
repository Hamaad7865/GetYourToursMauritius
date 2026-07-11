# Customizable Itinerary + Vehicle Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers build their own route on the tour page (remove/add/reorder admin-curated stops, pickup as the origin, animated driving map) and save it on the booking for the driver — plus a GYG-style vehicle option card.

**Architecture:** Optional stops + max live in the activity `extra` JSON (no new table). A new client `ItineraryBuilder` edits the route via a pure reducer, writes it to `sessionStorage` keyed by slug, and renders an upgraded `RouteMap` (Google Directions road route + a rAF-animated car). Checkout sends the route in the booking POST; `api_book` saves it to a new `bookings.custom_itinerary` column (post-create UPDATE — no change to `create_booking`); voucher + admin render it. The vehicle card is a static presentational component reading the catalogue config.

**Tech Stack:** Next.js 15 App Router + TypeScript, Zod DTOs, Google Maps JS (Directions/Geocoding), Postgres (plpgsql RPCs) on Supabase, PGlite + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-customizable-itinerary-design.md`

**Grounding facts:**

- Latest `api_book` = `supabase/migrations/20260617130000_sightseeing_vehicle_pricing.sql` (vehicle branch + `suv`). Base the new `api_book` on THAT.
- Latest `booking_json` = `20260616190000_vehicle_pricing.sql` (has `pax`). Base on THAT.
- `RouteMap` (`src/components/maps/RouteMap.tsx`) already re-renders on `stops` change and falls back to `MapLinkCard`. `mapsDirectionsUrl(titles[])` already exists. `geocode(title)` exists (`@/lib/maps/geocode`).
- `ItineraryEditor` (admin) lives in `ActivityForm.tsx` and is reusable for the optional-stops pool.
- Voucher `BookingConfirmation.tsx` fetches `/api/v1/bookings/{ref}` → `booking_json`. Admin `src/lib/admin/bookings.ts` reads bookings via a PostgREST `select` (BOOKING_SELECT).
- New migration must sort after `20260617130000` → `20260617140000_booking_custom_itinerary.sql`.

---

## Task 1: Vehicle option card

**Files:**

- Create: `src/components/gyg/detail/VehicleOptionCard.tsx`
- Modify: `app/activities/[slug]/page.tsx` (render it; add `id="book"` to the widget aside)

- [ ] **Step 1: Create the card**

`src/components/gyg/detail/VehicleOptionCard.tsx`:

```tsx
import Link from 'next/link';
import type { VehiclePricing } from '@/lib/validation/tours';
import { VEHICLE_BANDS } from '@/lib/services/pricing';
import { IconClock, IconGlobe, IconPin, IconUsers } from '@/components/ui/icons';

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

/** GetYourGuide-style "option available" card for vehicle-priced (sightseeing) tours: surfaces the
 *  vehicle ladder + facts in the page body and scrolls to the booking widget. Static — reads the
 *  catalogue config only. */
export function VehicleOptionCard({
  title,
  cfg,
  durationLabel,
  pickupAvailable,
  languages,
}: {
  title: string;
  cfg: VehiclePricing;
  durationLabel: string | null;
  pickupAvailable: boolean;
  languages: string[];
}) {
  // "From" price of a band = perBlockEur × ceil(bandMin / blockSize); SUV is its flat price.
  const bandMin = (i: number) => (i === 0 ? 1 : VEHICLE_BANDS[i - 1]!.max + 1);
  const rows = [
    { name: 'Sedan', price: cfg.perBlockEur, cap: 4 },
    { name: 'SUV', price: cfg.suvFlatEur, cap: 4 },
    ...VEHICLE_BANDS.slice(1).map((b, i) => ({
      name: b.name,
      price: cfg.perBlockEur * Math.ceil(bandMin(i + 1) / cfg.blockSize),
      cap: b.max,
    })),
  ];

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.4)]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[17px] font-extrabold tracking-tight text-ink">{title}</h3>
        <span className="shrink-0 text-[13px] text-ink-muted">
          From <b className="text-[17px] text-ink">{eur(cfg.perBlockEur)}</b> / vehicle
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink/80">
        {durationLabel && (
          <span className="flex items-center gap-1.5">
            <IconClock width={15} height={15} className="text-teal" /> {durationLabel}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <IconPin width={15} height={15} className="text-teal" />
          {pickupAvailable ? 'Hotel pickup' : 'Meeting point'}
        </span>
        {languages.length > 0 && (
          <span className="flex items-center gap-1.5">
            <IconGlobe width={15} height={15} className="text-teal" /> {languages.join(', ')}
          </span>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <IconUsers width={15} height={15} className="text-teal" /> {r.name}
              <span className="text-ink-muted">· up to {r.cap}</span>
            </span>
            <span className="text-[13px] font-bold text-ink">{eur(r.price)}</span>
          </li>
        ))}
      </ul>

      <Link
        href="#book"
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-3 text-[15px] font-bold text-white hover:bg-teal-dark"
      >
        Choose vehicle &amp; date
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the detail page + anchor the widget**

In `app/activities/[slug]/page.tsx`:

- Add the import near the other detail imports:

```tsx
import { VehicleOptionCard } from '@/components/gyg/detail/VehicleOptionCard';
```

- Add `id="book"` to the `<aside>` wrapping `<BookingWidget>` (the `<aside className="mb-8 lg:col-start-2 …">`): change to `<aside id="book" className="mb-8 lg:col-start-2 …">`.
- Just below the `activity.summary` paragraph block (inside the left column, before `<QuickFacts …/>`'s section), render the card for vehicle tours:

```tsx
{
  activity.pricingMode === 'vehicle' && activity.vehiclePricing && (
    <div className="mb-6">
      <VehicleOptionCard
        title={activity.title}
        cfg={activity.vehiclePricing}
        durationLabel={durationLabel(activity.durationMinutes)}
        pickupAvailable={activity.pickupAvailable}
        languages={activity.languages}
      />
    </div>
  );
}
```

- Ensure `durationLabel` is imported at the top of `page.tsx`:

```tsx
import { durationLabel } from '@/lib/catalogue/detail';
```

(If it's already imported, skip.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/gyg/detail/VehicleOptionCard.tsx "app/activities/[slug]/page.tsx"
git commit -m "feat(detail): GYG-style vehicle option card for sightseeing tours"
```

---

## Task 2: DTO — optional stops + max in `extra`

**Files:**

- Modify: `src/lib/validation/tours.ts` (extend `activityExtraSchema`)
- Test: `tests/unit/catalogue.test.ts` (or wherever extra is parsed — add a focused case)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/catalogue.test.ts` (import `activityExtraSchema` from `@/lib/validation/tours` at the top if not present):

```ts
import { activityExtraSchema } from '@/lib/validation/tours';

describe('activityExtraSchema — optional stops', () => {
  it('parses optionalStops + maxStops and tolerates their absence', () => {
    const full = activityExtraSchema.parse({
      itinerary: [{ title: 'Port Louis' }],
      optionalStops: [{ title: 'Fort Adelaide', area: 'Port Louis', lat: -20.16, lng: 57.5 }],
      maxStops: 6,
    });
    expect(full.optionalStops).toHaveLength(1);
    expect(full.maxStops).toBe(6);
    const bare = activityExtraSchema.parse({ itinerary: [{ title: 'X' }] });
    expect(bare.optionalStops).toBeUndefined();
    expect(bare.maxStops).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/unit/catalogue.test.ts -t "optional stops"`
Expected: FAIL — `optionalStops` is stripped (unknown key) so the assertion `toHaveLength(1)` throws.

- [ ] **Step 3: Extend the schema**

In `src/lib/validation/tours.ts`, in `activityExtraSchema` (after `returnWindow`):

```ts
  /** Customer-customizable itinerary: extra stops the visitor can add to the route (no price impact). */
  optionalStops: z.array(itineraryStopSchema).optional(),
  /** Cap on how many stops a customer's route may have (default 8 when absent). */
  maxStops: z.number().int().positive().optional(),
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/unit/catalogue.test.ts -t "optional stops"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/tours.ts tests/unit/catalogue.test.ts
git commit -m "feat(dto): optionalStops + maxStops on the activity extra schema"
```

---

## Task 3: Migration — `custom_itinerary` column + `api_book` persist + `booking_json` expose

**Files:**

- Create: `supabase/migrations/20260617140000_booking_custom_itinerary.sql`
- Test: `tests/integration/booking-flow.test.ts` (add a custom-itinerary case)

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/booking-flow.test.ts` (it already has `call`, `db`, `occurrenceId`, `CUSTOMER`):

```ts
it('saves and returns a custom itinerary on the booking', async () => {
  await db.as({ sub: CUSTOMER, role: 'authenticated' });
  const route = [
    { title: 'Port Louis', area: 'Capital', lat: -20.16, lng: 57.5 },
    { title: 'Fort Adelaide', area: 'Port Louis' },
  ];
  const booking = await call<{ ref: string }>(db, 'api_book', {
    occurrenceId,
    party: { Adult: 1 },
    itinerary: route,
    customerName: 'Route Tester',
    customerEmail: 'route@example.com',
    source: 'web',
    idempotencyKey: 'flow-route-12345678',
  });
  const got = await call<{ customItinerary: typeof route | null }>(db, 'api_get_booking', {
    ref: booking.ref,
  });
  expect(got.customItinerary).toHaveLength(2);
  expect(got.customItinerary![1]!.title).toBe('Fort Adelaide');

  // A booking with no itinerary returns null.
  const plain = await call<{ ref: string }>(db, 'api_book', {
    occurrenceId,
    party: { Adult: 1 },
    customerName: 'No Route',
    customerEmail: 'noroute@example.com',
    source: 'web',
    idempotencyKey: 'flow-noroute-1234567',
  });
  const got2 = await call<{ customItinerary: unknown }>(db, 'api_get_booking', { ref: plain.ref });
  expect(got2.customItinerary).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/integration/booking-flow.test.ts -t "custom itinerary"`
Expected: FAIL — `customItinerary` is `undefined` (booking_json doesn't return it yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260617140000_booking_custom_itinerary.sql`. (The `api_book` body is the
`20260617130000` version with the itinerary-persist block added before `return`; `booking_json` is the
`20260616190000` version with `customItinerary` added.)

```sql
-- Customer-customizable itinerary: the chosen route is saved on the booking so the driver follows it.
-- It carries no price (informational), so api_book stores it with a post-create UPDATE — create_booking
-- and the pricing path are untouched.

alter table bookings add column if not exists custom_itinerary jsonb;

create or replace function api_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_total_qty bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_mode text := 'per_person';
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');

  if v_mode = 'vehicle' then
    v_hold := create_hold(v_occ, 1, v_key || ':hold');
  else
    v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  -- Save the customer's chosen route (informational; no price impact). Only on a fresh booking
  -- (idempotency replay keeps the original route).
  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;

create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run tests/integration/booking-flow.test.ts`
Expected: PASS (all, including the new custom-itinerary case).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260617140000_booking_custom_itinerary.sql tests/integration/booking-flow.test.ts
git commit -m "feat(db): save a customer custom itinerary on the booking (api_book + booking_json)"
```

---

## Task 4: Booking plumbing — validation + service + checkout

**Files:**

- Modify: `src/lib/validation/booking.ts` (`itinerary` on `createBookingInputSchema` + on `bookingSchema`)
- Modify: `src/lib/services/bookings.ts` (forward `itinerary`)
- Modify: `src/components/checkout/Checkout.tsx` (read route from sessionStorage + send)
- Test: `tests/integration/services.test.ts` (service path saves the route)

- [ ] **Step 1: Write the failing service test**

Add to `tests/integration/services.test.ts` (after the SUV test):

```ts
it('saves a custom itinerary through the service path', async () => {
  await db.as({ sub: USER, role: 'authenticated' });
  const booking = await createBooking(ctx, {
    occurrenceId,
    party: { 'Private group': 1 },
    itinerary: [{ title: 'Port Louis' }, { title: 'Apravasi Ghat', area: 'Port Louis' }],
    customer: { name: 'R', email: 'route-svc@example.com' },
    idempotencyKey: 'svc-route-1',
  });
  const got = await getBookingStatus(ctx, booking.ref);
  expect(got.customItinerary).toHaveLength(2);
  expect(got.customItinerary![1]!.title).toBe('Apravasi Ghat');
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/integration/services.test.ts -t "custom itinerary"`
Expected: FAIL — `itinerary` is stripped by the input schema / `customItinerary` not on `bookingSchema`.

- [ ] **Step 3: Add `itinerary` to the booking schemas**

In `src/lib/validation/booking.ts`:

- A reusable route-stop schema + field on `createBookingInputSchema` (after `suv`):

```ts
  /** The customer's chosen route (sightseeing tours). Free + informational; bounded so a tampered
   *  payload is a clean 400, not a DB blowup. */
  itinerary: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        area: z.string().max(120).nullish(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .max(30)
    .optional(),
```

- And expose it on `bookingSchema` (after `items`):

```ts
  customItinerary: z
    .array(z.object({ title: z.string(), area: z.string().nullish(), lat: z.number().optional(), lng: z.number().optional() }))
    .nullish(),
```

- [ ] **Step 4: Forward it in the service**

In `src/lib/services/bookings.ts`, in the `api_book` payload (after `suv: input.suv ?? false,`):

```ts
    itinerary: input.itinerary ?? null,
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run tests/integration/services.test.ts`
Expected: PASS.

- [ ] **Step 6: Send the route from checkout**

In `src/components/checkout/Checkout.tsx`:

- After `const suv = params.get('suv') === '1';` add a reader that pulls the route the builder stashed:

```ts
// The route builder on the tour page stashes the chosen stops here (too big for the URL).
function readItinerary(): Array<{
  title: string;
  area?: string | null;
  lat?: number;
  lng?: number;
}> | null {
  if (typeof window === 'undefined' || !slug) return null;
  try {
    const raw = window.sessionStorage.getItem(`gytm:itinerary:${slug}`);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch {
    return null;
  }
}
```

- In the `POST /api/v1/bookings` body (after `suv,`):

```ts
            itinerary: readItinerary(),
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation/booking.ts src/lib/services/bookings.ts src/components/checkout/Checkout.tsx tests/integration/services.test.ts
git commit -m "feat(booking): carry the customer custom itinerary through service + checkout"
```

---

## Task 5: Pure route reducer + tests

**Files:**

- Create: `src/lib/itinerary/route.ts`
- Test: `tests/unit/itinerary-route.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/unit/itinerary-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withIds, addStop, removeStop, moveStop, type BuilderStop } from '@/lib/itinerary/route';

const A: BuilderStop = { id: 'def-0', title: 'Port Louis' };
const B: BuilderStop = { id: 'def-1', title: 'Pamplemousses' };
const C: BuilderStop = { id: 'opt-0', title: 'Fort Adelaide' };

describe('itinerary route reducer', () => {
  it('assigns stable prefixed ids', () => {
    const ids = withIds([{ title: 'X' }, { title: 'Y' }], 'def').map((s) => s.id);
    expect(ids).toEqual(['def-0', 'def-1']);
  });

  it('adds a stop at the end, ignoring duplicates and respecting the cap', () => {
    expect(addStop([A], C, 8)).toEqual([A, C]);
    expect(addStop([A, C], C, 8)).toEqual([A, C]); // already present → no-op
    expect(addStop([A, B], C, 2)).toEqual([A, B]); // at cap → no-op
  });

  it('removes by id', () => {
    expect(removeStop([A, B, C], 'def-1')).toEqual([A, C]);
  });

  it('moves a stop up/down within bounds', () => {
    expect(moveStop([A, B, C], 'def-1', -1)).toEqual([B, A, C]);
    expect(moveStop([A, B, C], 'def-1', 1)).toEqual([A, C, B]);
    expect(moveStop([A, B, C], 'def-0', -1)).toEqual([A, B, C]); // first up → no-op
    expect(moveStop([A, B, C], 'opt-0', 1)).toEqual([A, B, C]); // last down → no-op
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/unit/itinerary-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer**

`src/lib/itinerary/route.ts`:

```ts
import type { ItineraryStop } from '@/lib/validation/tours';

/** An itinerary stop carrying a stable client id (for React keys + add/remove/move). */
export type BuilderStop = ItineraryStop & { id: string };

/** Assign stable ids to a list of stops (`def-0`, `opt-1`, …). */
export function withIds(stops: ItineraryStop[], prefix: string): BuilderStop[] {
  return stops.map((s, i) => ({ ...s, id: `${prefix}-${i}` }));
}

/** Append `stop` if it isn't already selected and the route is under `max`. Pure. */
export function addStop(selected: BuilderStop[], stop: BuilderStop, max: number): BuilderStop[] {
  if (selected.some((s) => s.id === stop.id)) return selected;
  if (selected.length >= max) return selected;
  return [...selected, stop];
}

/** Remove the stop with `id`. */
export function removeStop(selected: BuilderStop[], id: string): BuilderStop[] {
  return selected.filter((s) => s.id !== id);
}

/** Move the stop with `id` one position in `dir` (-1 up, 1 down); no-op at the ends. */
export function moveStop(selected: BuilderStop[], id: string, dir: -1 | 1): BuilderStop[] {
  const i = selected.findIndex((s) => s.id === id);
  if (i < 0) return selected;
  const j = i + dir;
  if (j < 0 || j >= selected.length) return selected;
  const next = [...selected];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Strip client ids for persistence (what gets saved on the booking + sent to the map). */
export function toStops(selected: BuilderStop[]): ItineraryStop[] {
  return selected.map(({ id: _id, ...stop }) => stop);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/unit/itinerary-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/itinerary/route.ts tests/unit/itinerary-route.test.ts
git commit -m "feat(itinerary): pure add/remove/move route reducer"
```

---

## Task 6: Driving route map + animated car

**Files:**

- Modify: `src/components/maps/pin.ts` (add `carIcon`)
- Modify: `src/components/maps/RouteMap.tsx` (Directions road route + rAF car + `origin`/`animate` props)

- [ ] **Step 1: Add a car marker icon**

Append to `src/components/maps/pin.ts`:

```ts
/** A small top-down car marker (data-URI SVG) for animating along the route. */
export function carIcon(): google.maps.Icon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">` +
    `<circle cx="17" cy="17" r="16" fill="#fff" stroke="#0E8C92" stroke-width="2"/>` +
    `<path d="M9 19.5c0-.4.1-.8.3-1.1l1.3-2.2c.3-.6.9-.9 1.6-.9h7.6c.7 0 1.3.3 1.6.9l1.3 2.2c.2.3.3.7.3 1.1V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-.5h-9V22a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2.5z" fill="#0E8C92"/>` +
    `<circle cx="12.5" cy="21.5" r="1.4" fill="#0A2E36"/><circle cx="21.5" cy="21.5" r="1.4" fill="#0A2E36"/></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(28, 28),
    anchor: new google.maps.Point(14, 14),
  };
}
```

- [ ] **Step 2: Rewrite `RouteMap.tsx`**

Replace `src/components/maps/RouteMap.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import { useGoogleMaps } from '@/lib/maps/useGoogleMaps';
import { geocode } from '@/lib/maps/geocode';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { MapLinkCard } from './MapLinkCard';
import { carIcon, pinIcon, pinLabel } from './pin';

async function resolveStop(s: ItineraryStop): Promise<google.maps.LatLngLiteral | null> {
  if (typeof s.lat === 'number' && typeof s.lng === 'number') return { lat: s.lat, lng: s.lng };
  return geocode(s.title);
}

/**
 * Itinerary route map. Draws the real DRIVING route along the roads (Google Directions) with numbered
 * brand pins, and — when `animate` — a car marker that drives the route on a loop (rAF, reduced-motion
 * aware). Falls back to a dashed straight-line route, then to a keyless Google Maps link, so it
 * degrades but never breaks. Re-renders when `stops` change.
 */
export function RouteMap({
  stops,
  animate = false,
}: {
  stops: ItineraryStop[];
  animate?: boolean;
}) {
  const status = useGoogleMaps();
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== 'ready' || !elRef.current || stops.length === 0) return;
    let cancelled = false;

    (async () => {
      const points = (await Promise.all(stops.map(resolveStop))).filter(
        (p): p is google.maps.LatLngLiteral => p !== null,
      );
      if (cancelled || !elRef.current) return;
      if (points.length === 0) {
        setFailed(true);
        return;
      }

      const map = new google.maps.Map(elRef.current, {
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });

      const bounds = new google.maps.LatLngBounds();
      points.forEach((pos, i) => {
        new google.maps.Marker({
          map,
          position: pos,
          icon: pinIcon(i === 0 ? '#F76C5E' : '#0A2E36'),
          label: pinLabel(i + 1),
          title: stops[i]?.title,
        });
        bounds.extend(pos);
      });
      if (points.length === 1) {
        map.setCenter(points[0]!);
        map.setZoom(13);
      } else {
        map.fitBounds(bounds, 48);
      }

      // The path the car drives: the real road route if Directions is available, else straight lines.
      let path: google.maps.LatLngLiteral[] = points;
      if (points.length >= 2) {
        try {
          const ds = new google.maps.DirectionsService();
          const res = await ds.route({
            origin: points[0]!,
            destination: points[points.length - 1]!,
            waypoints: points.slice(1, -1).map((location) => ({ location, stopover: true })),
            travelMode: google.maps.TravelMode.DRIVING,
          });
          if (cancelled) return;
          const route = res.routes[0];
          if (route) {
            new google.maps.DirectionsRenderer({
              map,
              directions: res,
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: { strokeColor: '#0E8C92', strokeWeight: 4, strokeOpacity: 0.9 },
            });
            path = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
          } else {
            throw new Error('no route');
          }
        } catch {
          // Directions unavailable → dashed straight-line fallback.
          new google.maps.Polyline({
            map,
            path: points,
            geodesic: true,
            strokeOpacity: 0,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.7, scale: 3, strokeColor: '#0E8C92' },
                offset: '0',
                repeat: '12px',
              },
            ],
          });
          path = points;
        }
      }

      // The car: static at the start, or animated along the path on a loop.
      const car = new google.maps.Marker({
        map,
        position: path[0]!,
        icon: carIcon(),
        zIndex: 1000,
      });
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (animate && !reduce && path.length > 1) {
        const STEP_MS = 90; // advance one path point every ~90ms
        let i = 0;
        let last = 0;
        const tick = (t: number) => {
          if (cancelled) return;
          if (t - last >= STEP_MS) {
            i = (i + 1) % path.length;
            car.setPosition(path[i]!);
            last = t;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [status, stops, animate]);

  if (stops.length === 0) return null;
  if (status === 'error' || failed) {
    return (
      <MapLinkCard href={mapsDirectionsUrl(stops.map((s) => s.title))} label="See the full route" />
    );
  }

  return (
    <div
      ref={elRef}
      className="h-[300px] w-full overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.04] lg:h-[360px]"
    />
  );
}
```

(The existing `Itinerary` in `Sections.tsx` calls `<RouteMap stops={stops} />` — unchanged, `animate` defaults false, so the read-only itinerary keeps a static car + driving route.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. (Animation is verified in the preview at the end — it can't be unit-tested.)

- [ ] **Step 4: Commit**

```bash
git add src/components/maps/pin.ts src/components/maps/RouteMap.tsx
git commit -m "feat(map): real driving route + animated car (fallback to straight line)"
```

---

## Task 7: ItineraryBuilder + page wiring + widget reads the route

**Files:**

- Create: `src/components/gyg/detail/ItineraryBuilder.tsx`
- Modify: `app/activities/[slug]/page.tsx` (render builder when optional stops exist)
- Modify: `src/components/gyg/detail/BookingWidget.tsx` (no change needed — route is read in Checkout via sessionStorage; the builder writes it)

- [ ] **Step 1: Create the builder**

`src/components/gyg/detail/ItineraryBuilder.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ItineraryStop } from '@/lib/validation/tours';
import {
  addStop,
  moveStop,
  removeStop,
  toStops,
  withIds,
  type BuilderStop,
} from '@/lib/itinerary/route';
import { RouteMap } from '@/components/maps/RouteMap';
import { PickupMap } from '@/components/maps/PickupMap';
import { mapsDirectionsUrl } from '@/lib/maps/urls';
import { IconMinus, IconPlus, IconChevron } from '@/components/ui/icons';

/**
 * Customer route builder: start from the default itinerary (all removable), add admin-curated optional
 * stops, reorder with up/down, set a pickup as the route origin (preview-only). The chosen stops are
 * stashed in sessionStorage (`gytm:itinerary:<slug>`) for checkout to save on the booking; the map
 * draws the live driving route with an animated car.
 */
export function ItineraryBuilder({
  slug,
  defaultStops,
  optionalStops,
  maxStops = 8,
  meetingPoint,
}: {
  slug: string;
  defaultStops: ItineraryStop[];
  optionalStops: ItineraryStop[];
  maxStops?: number;
  meetingPoint?: string | null;
}) {
  const initial = useMemo(() => withIds(defaultStops, 'def'), [defaultStops]);
  const pool = useMemo(() => withIds(optionalStops, 'opt'), [optionalStops]);
  const [selected, setSelected] = useState<BuilderStop[]>(initial);
  const [pickup, setPickup] = useState('');
  const [pickAdd, setPickAdd] = useState(false);

  const available = pool.filter((p) => !selected.some((s) => s.id === p.id));

  // Stash the chosen stops for checkout (slug-keyed; cleared if empty).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `gytm:itinerary:${slug}`;
    if (selected.length) window.sessionStorage.setItem(key, JSON.stringify(toStops(selected)));
    else window.sessionStorage.removeItem(key);
  }, [slug, selected]);

  // The map route: pickup (if entered) as place 1, then the chosen stops.
  const mapStops: ItineraryStop[] = useMemo(
    () => [
      ...(pickup.trim() ? [{ title: pickup.trim() } as ItineraryStop] : []),
      ...toStops(selected),
    ],
    [pickup, selected],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        {/* Pickup origin (preview-only) */}
        <div className="mb-4 rounded-xl border border-ink/10 p-3">
          <div className="text-[13px] font-bold text-ink">Your pickup (start of the route)</div>
          <PickupMap
            value={pickup}
            onChange={setPickup}
            placeholder="Hotel, Airbnb or cruise port"
          />
        </div>

        <ol className="relative m-0 list-none p-0">
          {selected.map((stop, i) => (
            <li key={stop.id} className="relative flex items-start gap-3 pb-4">
              <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/10 text-[12px] font-bold text-teal">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-ink">{stop.title}</div>
                {stop.area && <div className="text-[13px] text-ink-muted">{stop.area}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Move ${stop.title} up`}
                  disabled={i === 0}
                  onClick={() => setSelected((s) => moveStop(s, stop.id, -1))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal disabled:opacity-30"
                >
                  <IconChevron width={14} height={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${stop.title} down`}
                  disabled={i === selected.length - 1}
                  onClick={() => setSelected((s) => moveStop(s, stop.id, 1))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink hover:border-teal disabled:opacity-30"
                >
                  <IconChevron width={14} height={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${stop.title}`}
                  onClick={() => setSelected((s) => removeStop(s, stop.id))}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-ink/15 text-ink-muted hover:border-coral hover:text-coral"
                >
                  <IconMinus width={14} height={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>

        {/* Add a stop */}
        {available.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickAdd((o) => !o)}
              disabled={selected.length >= maxStops}
              className="flex items-center gap-2 rounded-full border border-teal/40 px-4 py-2 text-sm font-bold text-teal hover:bg-teal/5 disabled:opacity-40"
            >
              <IconPlus width={15} height={15} /> Add a place
            </button>
            {selected.length >= maxStops && (
              <p className="mt-1.5 text-[12px] text-ink-muted">
                You&apos;ve reached the maximum of {maxStops} stops.
              </p>
            )}
            {pickAdd && selected.length < maxStops && (
              <div className="absolute z-20 mt-2 w-full max-w-sm rounded-xl border border-ink/12 bg-white p-1.5 shadow-[0_24px_50px_-22px_rgba(10,46,54,0.4)]">
                {available.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelected((s) => addStop(s, p, maxStops));
                      setPickAdd(false);
                    }}
                    className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-cream"
                  >
                    <span className="text-sm font-semibold text-ink">{p.title}</span>
                    {p.area && <span className="text-[12px] text-ink-muted">{p.area}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-[12px] text-ink-muted">
          Build your route at no extra cost — your driver follows the order above.
        </p>
      </div>

      <div>
        <RouteMap stops={mapStops} animate />
        <a
          href={mapsDirectionsUrl(mapStops.map((s) => s.title))}
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

(If `IconMinus`/`IconPlus`/`IconChevron` aren't all exported from `@/components/ui/icons`, check the file and use the existing equivalents — the BookingWidget already imports `IconMinus`, `IconPlus`, `IconChevron`.)

- [ ] **Step 2: Render the builder on the detail page**

In `app/activities/[slug]/page.tsx`, add the import:

```tsx
import { ItineraryBuilder } from '@/components/gyg/detail/ItineraryBuilder';
```

Add an `optionalStops` read next to `itinerary` (~line 103):

```tsx
const optionalStops = activity.extra.optionalStops ?? [];
```

Replace the itinerary section (the `{itinerary.length > 0 && ( … <Itinerary …/> … )}` block ~lines 212-216) with:

```tsx
{
  (itinerary.length > 0 || optionalStops.length > 0) && (
    <section className="mt-8">
      <SectionTitle>Itinerary</SectionTitle>
      {optionalStops.length > 0 ? (
        <ItineraryBuilder
          slug={activity.slug}
          defaultStops={itinerary}
          optionalStops={optionalStops}
          maxStops={activity.extra.maxStops}
          meetingPoint={activity.meetingPoint}
        />
      ) : (
        <Itinerary stops={itinerary} meetingPoint={activity.meetingPoint} />
      )}
    </section>
  );
}
```

(Keep whatever `<section>`/className wrapper the original used; only the inner conditional changes.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/gyg/detail/ItineraryBuilder.tsx "app/activities/[slug]/page.tsx"
git commit -m "feat(detail): inline customer itinerary builder with live driving map"
```

---

## Task 8: Admin — optional-stops editor + max stops

**Files:**

- Modify: `src/lib/admin/activity-write.ts` (`ActivityFormValues` + `EMPTY_ACTIVITY` + `buildExtra` + `loadActivityForEdit`)
- Modify: `src/components/admin/ActivityForm.tsx` (reuse `ItineraryEditor` for optional stops + a max-stops input)

- [ ] **Step 1: Carry the fields in the form model**

In `src/lib/admin/activity-write.ts`:

- `ActivityFormValues` — add (after `itinerary: ItineraryStopInput[];`):

```ts
  optionalStops: ItineraryStopInput[];
  maxStops: number | null;
```

- `EMPTY_ACTIVITY` — add:

```ts
  optionalStops: [],
  maxStops: null,
```

- `buildExtra` — extend to write the new fields:

```ts
function buildExtra(v: ActivityFormValues) {
  const map = (list: ItineraryStopInput[]) =>
    list
      .filter((s) => s.title.trim())
      .map((s) => ({
        title: s.title.trim(),
        area: s.area.trim() || null,
        description: s.description.trim() || null,
        tags: s.tags.filter((t) => t.trim()),
      }));
  const itinerary = map(v.itinerary);
  const optionalStops = map(v.optionalStops);
  const extra: Record<string, unknown> = {};
  if (itinerary.length) extra.itinerary = itinerary;
  if (optionalStops.length) extra.optionalStops = optionalStops;
  if (v.maxStops && v.maxStops > 0) extra.maxStops = v.maxStops;
  return extra;
}
```

- `loadActivityForEdit` — read them back. Extend the `ExtraShape` interface:

```ts
interface ExtraShape {
  itinerary?: Array<{
    title?: string;
    area?: string | null;
    description?: string | null;
    tags?: string[];
  }>;
  optionalStops?: Array<{
    title?: string;
    area?: string | null;
    description?: string | null;
    tags?: string[];
  }>;
  maxStops?: number;
}
```

and in the returned object (after the `itinerary:` mapping) add:

```ts
    optionalStops: (extra.optionalStops ?? []).map((s) => ({
      title: s.title ?? '',
      area: s.area ?? '',
      description: s.description ?? '',
      tags: s.tags ?? [],
    })),
    maxStops: extra.maxStops ?? null,
```

- [ ] **Step 2: Add the admin UI**

In `src/components/admin/ActivityForm.tsx`, after the existing Itinerary `<Section>` (the
`<ItineraryEditor stops={v.itinerary} …/>` one), add:

```tsx
<Section
  title="Optional stops (customer-customizable)"
  hint="Places a customer can add to their own route on the tour page (e.g. Fort Adelaide, Apravasi Ghat). Leave empty to keep the itinerary fixed."
>
  <ItineraryEditor stops={v.optionalStops} onChange={(x) => set('optionalStops', x)} />
  <label className="mt-4 block max-w-[200px] text-[13px] font-semibold text-ink">
    Max stops a customer can pick
    <input
      type="number"
      min={1}
      className={`${inputClass} mt-1`}
      value={v.maxStops ?? ''}
      onChange={(e) => set('maxStops', e.target.value ? Number(e.target.value) : null)}
      placeholder="8"
    />
  </label>
</Section>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/activity-write.ts src/components/admin/ActivityForm.tsx
git commit -m "feat(admin): curate optional stops + max-stops per tour"
```

---

## Task 9: Operator visibility — voucher + admin

**Files:**

- Modify: `src/components/gyg/detail/BookingConfirmation.tsx` (voucher shows the chosen route)
- Modify: `src/lib/admin/bookings.ts` (read `custom_itinerary`) + `src/components/admin/AdminBookings.tsx` (render it)

- [ ] **Step 1: Voucher**

In `src/components/gyg/detail/BookingConfirmation.tsx`:

- Extend the `Booking` interface:

```ts
interface Booking {
  ref: string;
  status: string;
  paymentState: string;
  customerName: string;
  totalEur: number;
  currency: string;
  items: BookingItem[];
  customItinerary?: Array<{ title: string; area?: string | null }> | null;
}
```

- After the `</dl>` totals block (before the `{error && …}`), add:

```tsx
{
  booking.customItinerary && booking.customItinerary.length > 0 && (
    <div className="mt-5 border-t border-ink/10 pt-4">
      <div className="text-[13px] font-bold text-ink">Your route</div>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[13px] text-ink/80">
        {booking.customItinerary.map((s, i) => (
          <li key={i}>
            {s.title}
            {s.area ? ` — ${s.area}` : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Admin read**

In `src/lib/admin/bookings.ts`:

- Add `custom_itinerary` to `BOOKING_SELECT` (after `notes, created_at,`):

```ts
  source, currency, total_minor, notes, custom_itinerary, created_at,
```

- Add to `RawBooking`:

```ts
custom_itinerary: Array<{ title: string; area?: string | null }> | null;
```

- Add to `BookingRow`:

```ts
customItinerary: Array<{ title: string; area?: string | null }> | null;
```

- In `mapBooking`'s returned object (after `netPaidEur`):

```ts
    customItinerary: raw.custom_itinerary,
```

- [ ] **Step 3: Admin render**

In `src/components/admin/AdminBookings.tsx`, in the booking detail drawer (find where `booking.notes`
or the items list renders), add a route block:

```tsx
{
  booking.customItinerary && booking.customItinerary.length > 0 && (
    <div className="mt-4">
      <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
        Customer route
      </div>
      <ol className="mt-1 list-decimal pl-5 text-[13px] text-ink/80">
        {booking.customItinerary.map((s, i) => (
          <li key={i}>{s.area ? `${s.title} — ${s.area}` : s.title}</li>
        ))}
      </ol>
    </div>
  );
}
```

(Place it next to the existing notes/items display — read the file to match its detail-drawer markup.)

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/gyg/detail/BookingConfirmation.tsx src/lib/admin/bookings.ts src/components/admin/AdminBookings.tsx
git commit -m "feat(ops): show the customer route on the voucher + in admin"
```

---

## Task 10: Catch-up SQL, artifacts, green gate

**Files:**

- Create: `supabase/catch-up-2026-06-17-custom-itinerary.sql`
- Regenerate: `supabase/setup.sql`, `openapi.json`
- Modify: `memory/gytm-db-sync.md`

- [ ] **Step 1: Write the idempotent catch-up**

Create `supabase/catch-up-2026-06-17-custom-itinerary.sql` = a `begin;`/`commit;` wrapper around the
**identical statements** from `supabase/migrations/20260617140000_booking_custom_itinerary.sql` (the
`alter … add column if not exists` + the two `create or replace function`s are all idempotent). Header:

```sql
-- ============================================================================
-- Belle Mare Tours — custom-itinerary catch-up (2026-06-17)
-- Adds bookings.custom_itinerary + saves the customer's chosen route via api_book.
-- Idempotent — safe to run more than once. Run AFTER the sightseeing-pricing catch-up.
-- ============================================================================
begin;

-- (paste the full body of migrations/20260617140000_booking_custom_itinerary.sql here)

commit;
```

- [ ] **Step 2: Regenerate artifacts**

Run: `npm run setup:sql ; npm run openapi:write`
Then `git status` and review `supabase/setup.sql` + `openapi.json` diffs (new migration + `customItinerary`).

- [ ] **Step 3: Full green gate**

Stop any running dev preview first. Then:
Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 4: Update the DB-sync memory note**

In `memory/gytm-db-sync.md`, add `catch-up-2026-06-17-custom-itinerary.sql` to the list of dated
catch-up files (latest), one line.

- [ ] **Step 5: Commit**

```bash
git add supabase/catch-up-2026-06-17-custom-itinerary.sql supabase/setup.sql openapi.json memory/gytm-db-sync.md
git commit -m "chore(db): catch-up + regenerated artifacts for custom itinerary"
```

---

## Self-Review

**Spec coverage:**

- Vehicle option card (ladder, scroll-to-book) → Task 1. ✓
- Optional stops + maxStops in `extra` → Task 2 (DTO), Task 8 (admin). ✓
- `custom_itinerary` saved via post-create `api_book` UPDATE (no `create_booking` change) → Task 3. ✓
- Booking plumbing (validation + service + checkout sessionStorage) → Task 4. ✓
- Pure reducer (add/remove/move/cap) → Task 5. ✓
- Driving route + animated car + fallback + reduced-motion → Task 6. ✓
- Inline builder (pickup origin preview-only, edit, live map, Open-in-Maps) → Task 7. ✓
- Operator visibility (voucher + admin) → Task 9. ✓
- Catch-up + artifacts → Task 10. ✓

**Placeholder scan:** The one "paste the body" (Task 10) is a deterministic copy of a fully-specified
file. The "read the file to match its detail-drawer markup" notes (Tasks 9) are precise insertion
points with the exact JSX to insert — the surrounding markup is the executor's anchor, not missing
content.

**Type/name consistency:** `BuilderStop`/`withIds`/`addStop`/`removeStop`/`moveStop`/`toStops` are
defined in Task 5 and used identically in Task 7. `customItinerary` is the property name across
`booking_json` (Task 3), `bookingSchema` (Task 4), the voucher (Task 9), and admin (Task 9);
`custom_itinerary` is the column/raw name (SQL + admin select). `itinerary` is the booking-input/POST
field across Tasks 3, 4. `vehiclePricing`/`VehiclePricing`/`VEHICLE_BANDS` (Task 1) match the
already-shipped pricing module.

**Risks during execution:**

- `AdminBookings.tsx` detail-drawer markup must be read to place the route block (Task 9 Step 3) —
  it's the one spot needing the file open first.
- The Directions API may not be enabled on the live Google key → the map shows the straight-line
  fallback (non-blocking); flag this to the owner.
- The cart "Add to cart" path doesn't carry the route yet (Book-now is fully wired); if cart checkout
  must also save the route, that's a small follow-up (store `itinerary` on the `CartItem` and include
  it in the cart's booking POST). Out of scope here — note it, don't silently drop it.
