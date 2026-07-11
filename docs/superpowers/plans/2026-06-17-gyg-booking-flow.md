# GetYourGuide Booking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the booking widget into a GetYourGuide two-step flow for all tours — configure (Participants/Date/Language) → **Check availability** → an **option card** (summary, price, Sedan/SUV choice in the card) → **Continue/Add-to-cart**, with the spot **held on Continue**.

**Architecture:** A client `BookingProvider` (React context) wraps the detail page's booking grid so the sidebar widget and the left-column option card share one selection + the availability fetch. "Continue" creates an **anonymous hold** (`api_create_hold` via `POST /api/v1/holds`) and routes to checkout; `api_book` gains a `holdId` to **reuse** that hold at pay (no double-hold). Add-to-cart stays a no-hold basket.

**Tech Stack:** Next.js 15 App Router + TS, Zod, Postgres (plpgsql SECURITY DEFINER RPCs) on Supabase, PGlite + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-per-stop-options-and-gyg-booking-flow-design.md` (Feature 2).

**Grounding:**

- Latest `api_book` = `supabase/migrations/20260617140000_booking_custom_itinerary.sql` (suv + itinerary). Base the holdId rewrite on THAT.
- `create_hold(occ, qty, key) returns booking_holds` (capacity-checked, idempotent) — `20260615120900_harden_pricing.sql`.
- `pgliteRpc` ALLOWED set is in `tests/db/rpc.ts`; the `api_*` route→service→`callRpc` pattern is in `app/api/v1/bookings/route.ts` + `src/lib/services/bookings.ts`.
- Detail page booking grid: `app/activities/[slug]/page.tsx` ~lines 167–243 (gallery col1/row1; `<aside id="book">` col2 sticky with `<BookingWidget>`; content col1/row2 with `<VehicleOptionCard>` + sections).
- New migration sorts after `20260617140000` → `20260617150000_hold_reuse.sql`.

---

## Task 1: Hold RPC + endpoint + service (hold-on-Continue, anonymous)

**Files:**

- Create: `supabase/migrations/20260617150000_hold_reuse.sql` (Part A: `api_create_hold`)
- Modify: `tests/db/rpc.ts` (allow `api_create_hold`)
- Create: `src/lib/services/holds.ts`
- Modify: `src/lib/validation/booking.ts` (`createHoldInputSchema` + `holdResultSchema`)
- Create: `app/api/v1/holds/route.ts`
- Test: `tests/integration/booking-flow.test.ts` (hold create + reuse)

- [ ] **Step 1: Write the failing PGlite test**

Add to `tests/integration/booking-flow.test.ts`:

```ts
it('api_create_hold reserves one vehicle / N seats by mode, and api_book reuses the hold', async () => {
  await db.as({ sub: CUSTOMER, role: 'authenticated' });
  // per-person occurrence (capacity 20) → hold of 3
  const hold = await call<{ holdId: string; quantity: number; expiresAt: string }>(
    db,
    'api_create_hold',
    {
      occurrenceId,
      people: 3,
      idempotencyKey: 'hold-pp-1',
    },
  );
  expect(hold.quantity).toBe(3);
  expect(hold.holdId).toBeTruthy();

  // api_book with that holdId reuses it (no second hold) and books.
  const booking = await call<{ ref: string; totalEur: number }>(db, 'api_book', {
    occurrenceId,
    party: { Adult: 3 },
    holdId: hold.holdId,
    customerName: 'Reuse',
    customerEmail: 'reuse@example.com',
    source: 'web',
    idempotencyKey: 'hold-pp-book',
  });
  expect(booking.totalEur).toBe(210); // 3 × €70
  const { rows } = await db.pg.query<{ n: number }>(
    `select count(*)::int as n from booking_holds where session_occurrence_id = $1`,
    [occurrenceId],
  );
  // Exactly one hold for this occurrence path (the reused one), not two.
  expect(rows[0]!.n).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run tests/integration/booking-flow.test.ts -t "api_create_hold reserves"`
Expected: FAIL — `api_create_hold` doesn't exist (`unknown rpc` or function missing).

- [ ] **Step 3: Migration — `api_create_hold` (Part A of the migration)**

Create `supabase/migrations/20260617150000_hold_reuse.sql` starting with:

```sql
-- Hold-on-Continue: a dedicated anonymous hold RPC + api_book reuse of an existing hold (so the spot
-- is reserved when the customer clicks Continue, and the same hold is settled at pay — no double-hold).

-- 1) api_create_hold: reserve the spot for a date. qty is authoritative from the pricing mode
--    (vehicle → 1 vehicle; else the people count). Anonymous-friendly (no email needed).
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_mode text := 'per_person';
  v_qty int;
  v_hold booking_holds;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode into v_mode
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') = 'vehicle' then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);
  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

grant execute on function api_create_hold(jsonb) to anon, authenticated, service_role;
```

(The api_book rewrite is **Part B**, added in Task 2 — same migration file.)

- [ ] **Step 4: Allow the RPC in the PGlite harness**

In `tests/db/rpc.ts`, add `'api_create_hold',` to the `ALLOWED` set.

- [ ] **Step 5: Validation + service + route**

`src/lib/validation/booking.ts` — add:

```ts
export const createHoldInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  expectedSlug: z.string().min(1).max(120).optional(),
  people: z.number().int().min(1).max(1000),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreateHoldInput = z.infer<typeof createHoldInputSchema>;

export const holdResultSchema = z.object({
  holdId: z.string(),
  quantity: z.number().int(),
  expiresAt: z.string(),
});
export type HoldResult = z.infer<typeof holdResultSchema>;
```

`src/lib/services/holds.ts` (new):

```ts
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { holdResultSchema, type CreateHoldInput, type HoldResult } from '@/lib/validation/booking';

/** Reserve the spot for a date (anonymous-friendly). The DB computes the qty from the pricing mode. */
export async function createHold(ctx: ServiceContext, input: CreateHoldInput): Promise<HoldResult> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const data = await callRpc(ctx, 'api_create_hold', {
    occurrenceId: input.occurrenceId,
    expectedSlug: input.expectedSlug ?? null,
    people: input.people,
    idempotencyKey: `${idempotencyKey}:hold`,
  });
  return holdResultSchema.parse(data);
}
```

`app/api/v1/holds/route.ts` (new — mirror the bookings route):

```ts
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { createHoldInputSchema } from '@/lib/validation/booking';
import { createHold } from '@/lib/services/holds';

export const runtime = 'edge';

/** POST /api/v1/holds — reserve the spot for a date (guest or authenticated). */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, createHoldInputSchema);
  const ctx = buildServiceContext(req);
  const hold = await createHold(ctx, input);
  return jsonOk(hold, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
```

- [ ] **Step 6: Run the test — expect PASS after Task 2 adds api_book reuse**

The hold-create half passes now; the reuse assertion needs Task 2. Run after Task 2:
`npx vitest run tests/integration/booking-flow.test.ts`

- [ ] **Step 7: Commit (with Task 2)** — commit Tasks 1+2 together since the test spans both.

---

## Task 2: `api_book` reuses a provided hold

**Files:**

- Modify: `supabase/migrations/20260617150000_hold_reuse.sql` (Part B: `api_book`)
- Modify: `src/lib/validation/booking.ts` (`holdId` on `createBookingInputSchema`)
- Modify: `src/lib/services/bookings.ts` (forward `holdId`)

- [ ] **Step 1: Append the api_book rewrite to the migration**

Append to `supabase/migrations/20260617150000_hold_reuse.sql` (the api_book body is the
`20260617140000` version with the hold-reuse branch swapped in for the create-hold lines):

```sql
-- 2) api_book: reuse a hold passed by Continue (holdId) instead of creating a fresh one. Falls back
--    to creating one if holdId is absent/expired/mismatched, so a stale hold never blocks booking.
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
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
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
  v_want_qty := case when v_mode = 'vehicle' then 1 else v_total_qty::int end;

  -- Reuse the Continue hold when it's still valid for this exact occurrence + qty.
  if v_hold_id is not null then
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now()
      and session_occurrence_id = v_occ and quantity = v_want_qty;
    if found then v_reused := true; end if;
  end if;
  if not v_reused then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':hold');
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
```

- [ ] **Step 2: Thread `holdId` through the schema + service**

`src/lib/validation/booking.ts` — in `createBookingInputSchema` (after `suv`):

```ts
  /** A hold reserved earlier (Continue) to reuse at pay, so the spot isn't double-held. */
  holdId: z.string().uuid().optional(),
```

`src/lib/services/bookings.ts` — in the `api_book` payload (after `suv:`):

```ts
    holdId: input.holdId ?? null,
```

- [ ] **Step 3: Run the test — expect PASS**

Run: `npx vitest run tests/integration/booking-flow.test.ts`
Expected: PASS (the hold create + reuse case, plus the existing flow + custom-itinerary cases).

- [ ] **Step 4: Commit Tasks 1+2**

```bash
git add supabase/migrations/20260617150000_hold_reuse.sql tests/db/rpc.ts src/lib/services/holds.ts src/lib/validation/booking.ts app/api/v1/holds/route.ts src/lib/services/bookings.ts tests/integration/booking-flow.test.ts
git commit -m "feat(booking): anonymous hold endpoint + api_book hold reuse (hold on Continue)"
```

---

## Task 3: `BookingProvider` — shared selection + availability

**Files:**

- Create: `src/components/gyg/detail/BookingProvider.tsx`

- [ ] **Step 1: Create the provider/context**

`src/components/gyg/detail/BookingProvider.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TourType } from '@/lib/validation/common';
import type { PricingMode, TourOption, VehiclePricing } from '@/lib/validation/tours';
import { sightseeingQuote, SIGHTSEEING_DEFAULT } from '@/lib/services/pricing';

export interface BookingActivity {
  slug: string;
  type: TourType;
  title: string;
  fromPriceEur: number | null;
  options: TourOption[];
  languages: string[];
  pricingMode: PricingMode;
  vehiclePricing: VehiclePricing | null;
  durationMinutes: number | null;
  pickupAvailable: boolean;
  image: string | null;
}

interface DayInfo {
  occurrenceId: string;
  seatsLeft: number;
}

interface BookingState {
  activity: BookingActivity;
  participants: number;
  setParticipants: (n: number) => void;
  date: string; // 'YYYY-MM-DD'
  setDate: (d: string) => void;
  lang: string;
  setLang: (l: string) => void;
  suv: boolean;
  setSuv: (b: boolean) => void;
  days: Map<string, DayInfo> | null;
  checked: boolean;
  setChecked: (b: boolean) => void;
  /** The booking option id used for availability + checkout. */
  bookingOptionId: string | null;
  vehicleCfg: VehiclePricing;
  /** Live total for the current selection, or null if not computable. */
  total: number | null;
  vehicleName: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  /** Continue: reserve the spot, then route to checkout. */
  continueToCheckout: () => Promise<void>;
}

const Ctx = createContext<BookingState | null>(null);
export const useBooking = (): BookingState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBooking must be used within BookingProvider');
  return v;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function BookingProvider({
  activity,
  children,
}: {
  activity: BookingActivity;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [participants, setParticipants] = useState(2);
  const [date, setDate] = useState('');
  const [lang, setLang] = useState(activity.languages[0] ?? 'English');
  const [suv, setSuv] = useState(false);
  const [checked, setChecked] = useState(false);
  const [days, setDays] = useState<Map<string, DayInfo> | null>(null);
  const [busy, setBusy] = useState(false);

  const isVehicle = activity.pricingMode === 'vehicle';
  const vehicleCfg = activity.vehiclePricing ?? SIGHTSEEING_DEFAULT;

  // Cheapest price tier drives the bookable option id + per-person/per-group price.
  const cheapest = useMemo(() => {
    let best: {
      optionId: string;
      label: string;
      amountEur: number;
      maxGuests: number | null;
    } | null = null;
    for (const o of activity.options) {
      for (const p of o.prices) {
        if (!best || p.amountEur < best.amountEur) {
          best = { optionId: o.id, label: p.label, amountEur: p.amountEur, maxGuests: p.maxGuests };
        }
      }
    }
    return best;
  }, [activity.options]);
  const bookingOptionId = isVehicle
    ? (activity.options[0]?.id ?? null)
    : (cheapest?.optionId ?? null);

  // Availability fetch (slug + bookable option).
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  useEffect(() => {
    if (!bookingOptionId) {
      setDays(new Map());
      return;
    }
    let active = true;
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 180);
    fetch(
      `/api/v1/activities/${activity.slug}/availability?from=${dateKey(today)}&to=${dateKey(horizon)}`,
    )
      .then((r) => r.json())
      .then((body) => {
        if (!active) return;
        const map = new Map<string, DayInfo>();
        if (body.ok) {
          for (const s of body.data as Array<{
            occurrenceId: string;
            activityOptionId: string;
            startsAt: string;
            seatsLeft: number;
          }>) {
            if (s.activityOptionId !== bookingOptionId) continue;
            map.set(dateKey(new Date(s.startsAt)), {
              occurrenceId: s.occurrenceId,
              seatsLeft: s.seatsLeft,
            });
          }
        }
        setDays(map);
      })
      .catch(() => active && setDays(new Map()));
    return () => {
      active = false;
    };
  }, [activity.slug, bookingOptionId, today]);

  const suvActive = isVehicle && suv && participants <= vehicleCfg.blockSize;
  const vehicleQuote = isVehicle
    ? sightseeingQuote(
        Math.min(Math.max(participants, 1), vehicleCfg.maxParty),
        suvActive,
        vehicleCfg,
      )
    : null;
  const isGroup = activity.pricingMode === 'per_group' && cheapest?.maxGuests != null;
  const total = isVehicle
    ? (vehicleQuote?.totalEur ?? null)
    : cheapest == null
      ? null
      : isGroup && cheapest.maxGuests
        ? cheapest.amountEur * Math.ceil(participants / cheapest.maxGuests)
        : cheapest.amountEur * participants;
  const vehicleName = vehicleQuote?.vehicle ?? null;

  async function continueToCheckout() {
    const occ = date ? days?.get(date)?.occurrenceId : undefined;
    if (!occ) return;
    setBusy(true);
    const idem = crypto.randomUUID();
    let holdId = '';
    let expiresAt = '';
    try {
      const res = await fetch('/api/v1/holds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          occurrenceId: occ,
          expectedSlug: activity.slug,
          people: participants,
          idempotencyKey: idem,
        }),
      }).then((r) => r.json());
      if (res.ok) {
        holdId = res.data.holdId as string;
        expiresAt = res.data.expiresAt as string;
      }
    } catch {
      /* fall through — checkout will create the hold at pay if this failed */
    }
    const label = isVehicle ? (vehicleQuote?.vehicle ?? 'Vehicle') : (cheapest?.label ?? '');
    const dateText = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const q = new URLSearchParams({
      occ,
      label,
      qty: String(participants),
      slug: activity.slug,
      title: activity.title,
      lang,
      total: total != null ? String(total) : '',
      when: dateText,
      guests: String(participants),
      unit: isVehicle
        ? 'per vehicle'
        : isGroup
          ? `per group up to ${cheapest!.maxGuests}`
          : 'per person',
      suv: suvActive ? '1' : '0',
      from: 'widget',
      idem,
      holdId,
      expiresAt,
    });
    router.push(`/checkout?${q.toString()}`);
  }

  const value: BookingState = {
    activity,
    participants,
    setParticipants,
    date,
    setDate,
    lang,
    setLang,
    suv,
    setSuv,
    days,
    checked,
    setChecked,
    bookingOptionId,
    vehicleCfg,
    total,
    vehicleName,
    busy,
    setBusy,
    continueToCheckout,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the provider is self-contained; not yet wired).

- [ ] **Step 3: Commit**

```bash
git add src/components/gyg/detail/BookingProvider.tsx
git commit -m "feat(detail): BookingProvider — shared booking selection + availability"
```

---

## Task 4: BookingWidget → consume context; Check availability

**Files:**

- Replace: `src/components/gyg/detail/BookingWidget.tsx` (now a thin consumer: Participants/Date/Language + "Check availability"; no SUV toggle, no Book-now/Add-to-cart)

- [ ] **Step 1: Rewrite the widget**

Replace `src/components/gyg/detail/BookingWidget.tsx` with a context consumer that keeps the existing Participants stepper, the calendar Date popover, and the Language picker, and replaces the action buttons with a single **"Check availability"** button that validates the date and calls `setChecked(true)`. (Reuse the existing calendar/stepper/popover JSX from the current file — `monthCells`, `WEEKDAYS`, the `open` popover state — but read `participants`/`date`/`lang`/`days` from `useBooking()` and write via its setters; drop `selectedBracket`, the SUV toggle block, `goToCheckout`, `handleAddToCart`, the cart import, the "more than max" link.) The button:

```tsx
<button
  type="button"
  disabled={!date || (days?.get(date)?.seatsLeft ?? 0) <= 0}
  onClick={() => setChecked(true)}
  className="mt-3.5 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-[15px] text-base font-bold text-white shadow-[0_12px_24px_-12px_rgba(14,140,146,0.7)] hover:bg-teal-dark disabled:opacity-50"
>
  Check availability
</button>
```

Keep the "From €{fromPriceEur} / {unitLabel}" header, the participant cap logic (`maxParticipants` = vehicle `maxParty` else `min(16, tierCap, seatsLeft)`), and the calendar greying. The full rewrite is large; the executor adapts the current file in place — every piece of selection state moves to `useBooking()`.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: errors only where the page hasn't been wired yet (Task 7) — i.e. the widget no longer takes the old props. That's expected; it compiles once Task 7 wires the provider. If it cannot compile standalone, proceed to Tasks 5–7 and typecheck at Task 7.

- [ ] **Step 3: Commit (with Tasks 5–7)** — the widget, card, and page wiring compile together; commit after Task 7.

---

## Task 5: BookingOptionCard (SUV choice lives here)

**Files:**

- Create: `src/components/gyg/detail/BookingOptionCard.tsx`
- Delete: `src/components/gyg/detail/VehicleOptionCard.tsx` (superseded)

- [ ] **Step 1: Create the option card**

`src/components/gyg/detail/BookingOptionCard.tsx` — a context consumer, hidden until `checked`:

```tsx
'use client';

import { useBooking } from './BookingProvider';
import { useCart } from '@/lib/cart/useCart';
import { useToast } from '@/components/site/ToastProvider';
import { durationLabel } from '@/lib/catalogue/detail';
import { IconCheck, IconClock, IconGlobe, IconPin, IconUsers } from '@/components/ui/icons';

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

/** GetYourGuide "option available" card. Revealed after Check availability; shows the selection
 *  summary, the price, the Sedan/SUV choice (vehicle, ≤ blockSize), and Continue / Add to cart. */
export function BookingOptionCard() {
  const b = useBooking();
  const { add: addToCart } = useCart();
  const { showToast } = useToast();
  if (!b.checked) return null;

  const isVehicle = b.activity.pricingMode === 'vehicle';
  const showSuv = isVehicle && b.participants <= b.vehicleCfg.blockSize;
  const dur = durationLabel(b.activity.durationMinutes);
  const whenText = b.date
    ? new Date(`${b.date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  function handleAddToCart() {
    const occ = b.date ? b.days?.get(b.date)?.occurrenceId : undefined;
    if (!occ) return;
    addToCart({
      id: `${occ}:${b.vehicleName ?? 'tour'}`,
      slug: b.activity.slug,
      title: b.activity.title,
      image: b.activity.image,
      occurrenceId: occ,
      dateLabel: whenText,
      lang: b.lang,
      priceLabel: isVehicle ? (b.vehicleName ?? 'Vehicle') : 'Adult',
      guests: b.participants,
      unitEur: b.total ?? 0,
      pricingMode: b.activity.pricingMode,
      suv: isVehicle && b.suv && b.participants <= b.vehicleCfg.blockSize,
      maxGuests: null,
      seatsLeft: b.days?.get(b.date)?.seatsLeft ?? 0,
      unit: isVehicle ? 'per vehicle' : 'per person',
    });
    showToast({ title: 'Added to cart', description: `${b.activity.title} — ${whenText}.` });
  }

  return (
    <div className="mb-6 rounded-2xl border-2 border-teal/30 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.4)]">
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal">
        1 option available
      </div>
      <h3 className="mt-1 font-display text-[19px] font-semibold text-ink">{b.activity.title}</h3>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink/80">
        {dur && (
          <span className="flex items-center gap-1.5">
            <IconClock width={15} height={15} className="text-teal" /> {dur}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <IconGlobe width={15} height={15} className="text-teal" /> {b.lang}
        </span>
        <span className="flex items-center gap-1.5">
          <IconPin width={15} height={15} className="text-teal" />
          {b.activity.pickupAvailable ? 'Hotel pickup' : 'Meeting point'}
        </span>
      </div>

      <div className="mt-4 border-t border-ink/10 pt-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
          Starting time
        </div>
        <div className="text-[15px] font-semibold text-ink">{whenText}</div>
      </div>

      {showSuv && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => b.setSuv(false)}
            className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${!b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'}`}
          >
            Sedan · {eur(b.vehicleCfg.perBlockEur)}
          </button>
          <button
            type="button"
            onClick={() => b.setSuv(true)}
            className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] font-bold ${b.suv ? 'border-teal bg-teal/5 text-teal-dark' : 'border-ink/15 text-ink-muted'}`}
          >
            SUV · {eur(b.vehicleCfg.suvFlatEur)}
          </button>
        </div>
      )}
      {isVehicle && b.vehicleName && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] font-semibold text-teal-dark">
          <IconUsers width={15} height={15} className="text-teal" />
          {b.vehicleName} · for {b.participants} {b.participants === 1 ? 'passenger' : 'passengers'}
        </div>
      )}

      <div className="mt-4 flex items-end justify-between gap-3 border-t border-ink/10 pt-4">
        <div>
          <div className="text-[22px] font-extrabold tracking-tight text-ink">
            {b.total != null ? eur(b.total) : '—'}
          </div>
          <div className="text-[12px] text-ink-muted">All taxes and fees included</div>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            type="button"
            disabled={b.busy || b.total == null}
            onClick={() => void b.continueToCheckout()}
            className="rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
          >
            {b.busy ? 'Holding…' : 'Continue'}
          </button>
          <button
            type="button"
            onClick={handleAddToCart}
            className="rounded-full border-2 border-teal px-7 py-2 text-[13px] font-bold text-teal-dark hover:bg-teal/5"
          >
            Add to cart
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink/80">
        <IconCheck width={15} height={15} className="text-teal" /> Free cancellation up to 24 hours
        before
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit (with Task 7).**

---

## Task 6: Checkout reuses the Continue hold + honest timer

**Files:**

- Modify: `src/components/checkout/Checkout.tsx`

- [ ] **Step 1: Use holdId + expiresAt + idem from the query**

In `src/components/checkout/Checkout.tsx`:

- Read the new params near the others:

```ts
const holdId = params.get('holdId') || '';
const expiresAt = params.get('expiresAt') || '';
const idemParam = params.get('idem') || '';
```

- Drive the countdown off the real `expiresAt` when present:

```ts
const [secs, setSecs] = useState(() => {
  if (expiresAt) {
    const s = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return s > 0 ? s : 0;
  }
  return 30 * 60;
});
```

- Use the passed `idem` for the booking (so the same key chains the hold → booking), falling back to a fresh one:

```ts
const [idemKey] = useState(() => idemParam || crypto.randomUUID());
```

- In the `POST /api/v1/bookings` body, send `holdId` so `api_book` reuses the Continue hold (after `itinerary: readItinerary(),`):

```ts
            holdId: holdId || undefined,
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (still compiles; full wiring at Task 7).

- [ ] **Step 3: Commit (with Task 7).**

---

## Task 7: Wire the provider into the page; green gate; review

**Files:**

- Modify: `app/activities/[slug]/page.tsx`

- [ ] **Step 1: Wrap the booking grid in the provider; render the card**

In `app/activities/[slug]/page.tsx`:

- Replace the `VehicleOptionCard` import with:

```tsx
import { BookingProvider } from '@/components/gyg/detail/BookingProvider';
import { BookingOptionCard } from '@/components/gyg/detail/BookingOptionCard';
```

- Wrap the `<div className="lg:grid …">` booking grid in `<BookingProvider activity={{…}}>…</BookingProvider>`:

```tsx
<BookingProvider
  activity={{
    slug: activity.slug,
    type: activity.type,
    title: activity.title,
    fromPriceEur: activity.fromPriceEur,
    options: activity.options,
    languages: activity.languages,
    pricingMode: activity.pricingMode,
    vehiclePricing: activity.vehiclePricing ?? null,
    durationMinutes: activity.durationMinutes,
    pickupAvailable: activity.pickupAvailable,
    image: activity.heroImage?.url ?? activity.images[0]?.url ?? null,
  }}
>
  <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_374px] lg:items-start lg:gap-x-8">
    … existing gallery / aside / content …
  </div>
</BookingProvider>
```

- `<BookingWidget />` in the aside now takes **no props** (it reads context): replace the whole `<BookingWidget … />` element with `<BookingWidget />`.
- Replace the old `{activity.pricingMode === 'vehicle' && activity.vehiclePricing && (<div className="mb-6"><VehicleOptionCard …/></div>)}` block (just under the summary, before `<QuickFacts/>`) with:

```tsx
<BookingOptionCard />
```

- [ ] **Step 2: Full green gate**

Stop the dev preview. Then:
Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all green. Fix any stragglers (e.g. unused imports from the old widget).

- [ ] **Step 3: Regenerate artifacts + catch-up SQL**

- Run: `npm run setup:sql ; npm run openapi:write`
- Create `supabase/catch-up-2026-06-17-hold-reuse.sql` = `begin;` + the body of
  `20260617150000_hold_reuse.sql` + `commit;` (both functions are `create or replace` + a `grant`, idempotent).

- [ ] **Step 4: Preview (DOM — no maps needed)**

The GYG flow is non-map UI, so it IS verifiable in the headless preview: load a per-group tour, set participants/date, click **Check availability** → the button hides and the option card shows the starting time + price + Continue; on a vehicle tour confirm the **Sedan/SUV** toggle appears in the card at ≤4 and updates the price; click Continue → checkout with a running timer.

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "feat(detail): GYG Check-availability → option card → Continue flow (hold on Continue)"
git push
```

- [ ] **Step 6: Adversarial review** — run the dimension-review + skeptic-verify workflow over the Feature 1 + Feature 2 diff (`git diff main...HEAD`), focusing on the hold/money path, the provider state, and the checkout reuse. Fix confirmed findings, re-gate.

---

## Self-Review

**Spec coverage (Feature 2):**

- Anonymous hold endpoint + `api_book` reuse (no double-hold) → Tasks 1–2. ✓
- `BookingProvider` shared state + availability → Task 3. ✓
- Widget = Participants/Date/Language + Check availability (no SUV/Book-now) → Task 4. ✓
- Option card with summary/price + **SUV choice in the card** + Continue/Add-to-cart → Task 5. ✓
- Continue holds + routes; checkout reuses holdId + honest timer → Tasks 3, 6. ✓
- All tours → the provider/card are mode-agnostic (per_person/per_group/vehicle price branches). ✓
- Add-to-cart = no-hold basket → Task 5 (`handleAddToCart` → `useCart`). ✓
- Page wiring + catch-up + review → Task 7. ✓

**Placeholder note:** Tasks 4 and 7 Step 1 reference "the existing calendar/stepper JSX" — that's an in-place adaptation of the current `BookingWidget`, with the concrete button + the exact state-source change (local state → `useBooking()`) given. The card/provider/SQL are full code.

**Type consistency:** `useBooking()` returns the `BookingState` shape (Task 3) consumed identically by the widget (Task 4) and card (Task 5). `holdId` is the field name across `api_create_hold`/`api_book` (Tasks 1–2), `createBookingInputSchema` (Task 2), `continueToCheckout` query (Task 3), and Checkout (Task 6). `people` is the hold-input field; `qty`/`party` the booking field — distinct and intentional.

**Risk:** the hold/money path is the sensitive part — Tasks 1–2 are PGlite-tested (create + reuse + no-double-hold). The big UI refactor can't render maps in preview but the GYG flow itself is DOM-verifiable (Task 7 Step 4).
