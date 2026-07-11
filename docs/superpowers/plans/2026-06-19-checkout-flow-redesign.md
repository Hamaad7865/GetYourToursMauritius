# Single-Tour Checkout Flow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the single-tour checkout into ① Trip & pickup (adaptive "want pickup?" + real driving-route confirmation, no dotted line) → ② personal details (GetYourGuide-style form) → ③ pay; capture pickup and drop-off as **distinct** data; surface pickup/drop-off/itinerary to admin.

**Architecture:** Enhance the existing `src/components/checkout/Checkout.tsx` (already `Transport → Contact → Payment` with the region transport fee from `e716ebb`). Reuse `PickupMap`, the transport-fee server path, `RouteMap`'s real-Directions renderer, and the Peach widget — do not rebuild them. Add a `dropoff_location` column + a `pickup_pending` flag to bookings; thread them through `api_book` → DTO → admin. Strip the dashed/coral route polylines wherever they render.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase Postgres RPCs, Zod, Vitest (+ PGlite), Tailwind, Google Maps (Directions + Places).

**Spec:** `docs/superpowers/specs/2026-06-19-checkout-flow-redesign-design.md`. The **multi-item "order"** (one payment grouping several tours) is a SEPARATE fast-follow — out of scope.

---

## File structure

**Create:**

- `supabase/migrations/20260721000000_booking_dropoff.sql` — `dropoff_location` + `pickup_pending` columns; re-define `api_book` (verbatim + the two new fields) and `booking_json`.
- `src/lib/checkout/pickup.ts` — pure helpers for step-① state (`pickupMode`, `canAdvanceStep1`).
- Tests: `tests/unit/checkout-pickup.test.ts`, `tests/integration/booking-dropoff.test.ts`.

**Modify:**

- `src/lib/validation/booking.ts` (`createBookingInputSchema` + `bookingSchema`), `src/lib/services/bookings.ts`, `src/lib/supabase/types.ts`, `supabase/catch-up.sql`.
- `src/components/checkout/Checkout.tsx` (steps ① and ②, the booking body).
- `src/components/maps/RouteMap.tsx`, `src/components/maps/ItineraryMap.tsx` (remove dashed/coral lines).
- `src/lib/admin/bookings.ts` + `src/components/admin/AdminBookings.tsx` (admin display).

---

## Task 1: Booking data model — distinct drop-off + pickup-pending

**Files:**

- Create: `supabase/migrations/20260721000000_booking_dropoff.sql`, `tests/integration/booking-dropoff.test.ts`
- Modify: `supabase/catch-up.sql`, `src/lib/validation/booking.ts`, `src/lib/services/bookings.ts`, `src/lib/supabase/types.ts`

Drop-off is concatenated into `pickup_location` today (`"addr → drop-off: X"`). Split it into its own column, and add `pickup_pending` so admin can tell "pickup to be arranged" (TBD) from "no pickup".

- [ ] **Step 1: Failing integration test** — `tests/integration/booking-dropoff.test.ts`. First READ `tests/integration/booking-flow.test.ts` + `tests/db/pglite.ts` + `tests/db/seed.ts` to match the harness (`createTestDb`, `db.as`, `seedOccurrence`, and how a booking is created in tests — likely `api_book(jsonb)`; confirm the exact arg shape from `src/lib/services/bookings.ts` `createBooking`). Then write a test that books with a pickup + a distinct drop-off + `pickupPending:false`, reads it back via `booking_json` (or the booking the RPC returns), and asserts `dropoffLocation` and `pickupPending` round-trip distinctly from `pickupLocation`; plus a second case with `pickupPending:true` and no pickup address.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/integration/booking-dropoff.test.ts`.

- [ ] **Step 3: Migration** — `supabase/migrations/20260721000000_booking_dropoff.sql`:

```sql
-- Distinct drop-off + a "pickup to be arranged" flag (the cart/checkout redesign records pickup and
-- drop-off separately instead of concatenating them into pickup_location).
alter table bookings add column if not exists dropoff_location text;
alter table bookings add column if not exists pickup_pending boolean not null default false;
```

Then re-define `api_book` and `booking_json`. **CRITICAL (migration-revert-drift):** the LATEST `api_book` is NOT the original — it was re-defined by the transport-pricing migration (`20260720000000…`, commit `e716ebb`) and earlier by the audit (`20260719120000_audit_fixes.sql`, the F23 guard). Find the winning `api_book` (grep `function api_book` across `supabase/migrations/*.sql` + `supabase/catch-up.sql`; highest-numbered migration wins) and copy its body **VERBATIM**, adding ONLY: (a) read `p ->> 'dropoffLocation'` and `(p ->> 'pickupPending')::boolean` from the input jsonb, and (b) include `dropoff_location` + `pickup_pending` in the booking `update`/`insert`. Do not re-derive the transport-fee / capacity / F23 logic from memory — copy it. Likewise re-define `booking_json` (winning def) verbatim + add `'dropoffLocation', b.dropoff_location` and `'pickupPending', b.pickup_pending` to the returned object.

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Schema + service + types**
  - `src/lib/validation/booking.ts`: add to `createBookingInputSchema`: `dropoffLocation: z.string().trim().max(200).nullish()` and `pickupPending: z.boolean().optional()`. Add to `bookingSchema`: `dropoffLocation: z.string().nullish()` and `pickupPending: z.boolean().nullish()`.
  - `src/lib/services/bookings.ts`: in `createBooking`'s `api_book` params add `dropoffLocation: input.dropoffLocation ?? null,` and `pickupPending: input.pickupPending ?? false,`.
  - `src/lib/supabase/types.ts`: add `dropoff_location: string | null` and `pickup_pending: boolean` to the `bookings` Row + Insert types (hand-authored; keep in sync, as the prior tasks did for `created_by`).

- [ ] **Step 6: Mirror into `supabase/catch-up.sql`** — append the two `alter table … if not exists`, and the re-defined `api_book` + `booking_json` (same bodies) before the final `commit;`. Run `npx vitest run tests/integration/catch-up-parity.test.ts` → PASS.

- [ ] **Step 7: Regression gate** — `npx vitest run tests/integration/booking-flow.test.ts tests/integration/booking-core.test.ts tests/integration/security-fixes.test.ts tests/integration/audit-fixes.test.ts` (proves the F23/transport/oversell logic wasn't reverted) + `npm run typecheck`. All green.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260721000000_booking_dropoff.sql supabase/catch-up.sql src/lib/validation/booking.ts src/lib/services/bookings.ts src/lib/supabase/types.ts tests/integration/booking-dropoff.test.ts
git commit -m "feat(booking): distinct dropoff_location + pickup_pending"
```

---

## Task 2: Remove the dotted/coral route lines (real route + marker fallback)

**Files:**

- Modify: `src/components/maps/RouteMap.tsx`, `src/components/maps/ItineraryMap.tsx` (+ any other dashed-line site you find)

The real driving route (solid teal `DirectionsRenderer`) stays. Remove the dashed coral **return-to-start** leg and the dashed straight-line **fallback**; when Directions fails, show numbered markers + a "View on Google Maps" link instead — never a dashed line.

- [ ] **Step 1: Locate every dashed line** — grep the repo: `strokeDasharray`, `border-dashed`, `repeat: '12px'`, `'M 0,-1 0,1'`, `#F76C5E` (coral), and `Return route`. Confirmed sites to fix: `RouteMap.tsx` ~L212 (dashed fallback polyline) and ~L230–244 (dashed coral return leg), and `ItineraryMap.tsx` ~L31 (the "Return route" dashed legend item). Check the planner + activity-detail map usages of `RouteMap`/`ItineraryMap` for any other dashed legend.

- [ ] **Step 2: RouteMap.tsx** — remove the coral return-leg `Polyline` block entirely (and the `loop`-driven return rendering). For the **fallback** path (Directions unavailable), replace the dashed straight-line `Polyline` with: keep the numbered markers (already drawn) and DO NOT draw any polyline; ensure the existing "View on Google Maps" link is shown in that state. Keep the real `DirectionsRenderer` (solid teal) untouched. If `RouteMap` accepts a `loop` prop that now does nothing, leave the prop but make it a no-op (don't break callers) or remove it and update callers — pick whichever is smaller after reading the call sites.

- [ ] **Step 3: ItineraryMap.tsx** — remove the "Return route" dashed legend item (~L31) and its `stops.length > 1` block. Keep the rest of the legend.

- [ ] **Step 4: Verify** — `npm run typecheck` + `npm run lint` clean. Manually (or by reading) confirm no `border-dashed` coral / dashed route `Polyline` remains in the map components. `npx vitest run` (no test should break; if a snapshot/test references the return leg, update it).

- [ ] **Step 5: Commit**

```bash
git add src/components/maps/RouteMap.tsx src/components/maps/ItineraryMap.tsx
git commit -m "feat(maps): drop the dashed route lines — real route + marker fallback only"
```

---

## Task 3: Step ① — "want pickup?" prompt + drop-off + read-only route + gating

**Files:**

- Create: `src/lib/checkout/pickup.ts`, `tests/unit/checkout-pickup.test.ts`
- Modify: `src/components/checkout/Checkout.tsx`

- [ ] **Step 1: Failing unit test** — `tests/unit/checkout-pickup.test.ts` for the pure gating helper:

```typescript
import { describe, expect, it } from 'vitest';
import { canAdvanceStep1 } from '@/lib/checkout/pickup';

describe('canAdvanceStep1', () => {
  it('blocks when pickup is wanted but the address is empty and not TBD', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: '', tbd: false })).toBe(false);
  });
  it('allows when pickup is wanted and an address is set', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: 'Hotel X', tbd: false })).toBe(true);
  });
  it('allows when pickup is wanted but TBD ("I don\\'t know yet")', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: '', tbd: true })).toBe(true);
  });
  it('allows when no pickup is wanted', () => {
    expect(canAdvanceStep1({ wantsPickup: false, address: '', tbd: false })).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/lib/checkout/pickup.ts`**:

```typescript
export interface Step1State {
  wantsPickup: boolean;
  address: string;
  tbd: boolean;
}

/** Step ① can advance unless pickup is wanted with no address and not flagged "I don't know yet". */
export function canAdvanceStep1(s: Step1State): boolean {
  if (!s.wantsPickup) return true;
  if (s.tbd) return true;
  return s.address.trim().length > 0;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Rework Checkout.tsx step ①.** READ the current `Checkout.tsx` first. Replace the current transport step (the `pickup: 'known'|'unknown'` radio) with:
  - A **"Do you want pickup?"** choice → `wantsPickup: boolean`. Default it from the activity: if a transport fee/region applies (the order summary's `transportHint > 0`, or a passed flag) default `true`, else `false`. (Read the activity's pickup capability from the existing params; if none, default `false`.)
  - **wantsPickup === true:** render the existing `<PickupMap value={pickupLoc} onChange={setPickupLoc} onCoords={setPickupCoords} />`, plus a **visible drop-off text input** bound to `dropoffText`, plus a **"I don't know yet"** checkbox bound to `tbd`. When an address + (optional) drop-off + coords exist, render a **read-only route** using `RouteMap`/`ItineraryMap` with the pickup as the first point, the tour's `readItinerary()` stops in the middle, and the drop-off as the last point (build the points array; reuse the existing route component — no dashed line per Task 2). When `tbd` is checked, hide the map and the address requirement.
  - **wantsPickup === false:** show "Meet at [activity location]" (use the activity title/location available in params) — no map, no fee.
  - Gate the "Continue" button with `canAdvanceStep1({ wantsPickup, address: pickupLoc, tbd })`; when blocked, disable + show a hint ("Add your pickup address, or choose 'I don't know yet'.").
  - The `'unknown'` legacy state maps to `wantsPickup:false`; the planner pre-fill (`pickupParam`) sets `wantsPickup:true` + address.

- [ ] **Step 6: Update the booking body** (in `pay()`): send **distinct** fields instead of the concatenated string:

```typescript
pickupLocation: wantsPickup && !tbd && pickupLoc.trim() ? pickupLoc.trim().slice(0, 200) : null,
dropoffLocation: wantsPickup && !tbd && dropoffText.trim() ? dropoffText.trim().slice(0, 200) : null,
pickupPending: wantsPickup && tbd,
pickupLat: wantsPickup && !tbd && pickupCoords ? pickupCoords.lat : null,
pickupLng: wantsPickup && !tbd && pickupCoords ? pickupCoords.lng : null,
```

(So a TBD pickup sends no coords → the server computes no transport fee, per the spec.)

- [ ] **Step 7: i18n** — add French keys for the new strings ("Do you want pickup?", "Yes, pick me up", "No, I'll make my own way", "Drop-off location", "I don't know yet", "Meet at {location}", the gate hint) to `src/lib/i18n/messages.ts`.

- [ ] **Step 8: Verify** — `npm run typecheck && npm run lint && npx vitest run tests/unit/checkout-pickup.test.ts` green. Manually reason through: pickup-capable activity → step ① defaults to the pickup form with a route preview; fixed activity → "Meet at…"; "I don't know yet" lets you continue with no map.

- [ ] **Step 9: Commit**

```bash
git add src/lib/checkout/pickup.ts tests/unit/checkout-pickup.test.ts src/components/checkout/Checkout.tsx src/lib/i18n/messages.ts
git commit -m "feat(checkout): step 1 — want-pickup prompt, drop-off, read-only route, gating"
```

---

## Task 4: Step ② — personal-details form (GetYourGuide-style)

**Files:**

- Modify: `src/components/checkout/Checkout.tsx`, `src/lib/i18n/messages.ts`

Today step ② is sign-in only. After sign-in, show a details form matching the screenshot.

- [ ] **Step 1: Build the form.** In step ②, once `session` exists, render a form (not auto-advance): **Full name** (prefilled `profile?.fullName`), **Email** (prefilled `user?.email`, read-only), a **Country** selector (reuse any existing country/phone-code list in the repo; if none, a simple `<select>` of common countries — grep for an existing list first), **Mobile phone** (bound to a `phone` state, prefilled `profile?.phone`), a **"Go to payment"** button, and the "Pay nothing today / Free cancellation" reassurance row (mirror the screenshot; reuse the existing reassurance copy in `Checkout.tsx`). If `session` is absent, keep the current sign-in prompt. Remove the auto-advance `useEffect` (step 2 → 3) so the customer fills the form and clicks **Go to payment** to advance.
  - **Phone required when there's a pickup:** if `wantsPickup` (from step ①, incl. TBD) and `phone` is empty, disable "Go to payment" + show "Add a phone number so your driver can reach you." Otherwise phone is optional.

- [ ] **Step 2: Thread the phone into the booking.** In `pay()`, send `customer.phone` from the step-② `phone` state (falling back to `profile?.phone`). Name/email stay as today.

- [ ] **Step 3: i18n** — add French keys for the new labels ("Full name", "Email address", "Country", "Mobile phone number", "Go to payment", "Add a phone number so your driver can reach you", the reassurance lines if new).

- [ ] **Step 4: Verify** — `npm run typecheck && npm run lint && npx vitest run` green. Reason through: signed-in user reaches step ② → sees prefilled details → must add phone when there's a pickup → "Go to payment" → step ③.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/Checkout.tsx src/lib/i18n/messages.ts
git commit -m "feat(checkout): step 2 — GYG personal-details form, phone required on pickup"
```

---

## Task 5: Admin — show pickup, drop-off, itinerary

**Files:**

- Modify: `src/lib/admin/bookings.ts`, `src/components/admin/AdminBookings.tsx`

- [ ] **Step 1: DTO.** In `src/lib/admin/bookings.ts`: add `dropoffLocation: string | null` and `pickupPending: boolean` to `BookingRow`; add `dropoff_location, pickup_pending` to `BOOKING_SELECT`; map them in the row mapper (find where `pickupLocation`/`pickup_location` is mapped and mirror it).

- [ ] **Step 2: Drawer.** In `AdminBookings.tsx`, in the booking detail drawer, add a "Pickup & drop-off" block: show **Pickup** (`pickupLocation` or, when `pickupPending`, the badge **"Pickup to be arranged"**, or "No pickup" when neither), **Drop-off** (`dropoffLocation` or "—"), and the **itinerary** (`customItinerary` titles — if it's already rendered, leave it; else add a compact list). Read the drawer's existing field layout and match its style.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run lint && npx vitest run` green. (If there's an admin-bookings test, ensure the new fields don't break it; add a small assertion that the DTO carries `dropoffLocation`/`pickupPending` if a test harness exists.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/bookings.ts src/components/admin/AdminBookings.tsx
git commit -m "feat(admin): show pickup, drop-off, itinerary on a booking"
```

---

## Task 6: Green gate + review

- [ ] **Step 1:** `npm run typecheck && npm run lint && npx vitest run` — all green.
- [ ] **Step 2:** Re-read the spec; confirm each decision (1–5) maps to a task. Owner action: **re-run `supabase/catch-up.sql`** on the live DB (the `dropoff_location` + `pickup_pending` columns and the re-defined `api_book`/`booking_json`).
- [ ] **Step 3:** Request a code review (superpowers:requesting-code-review) focused on: the `api_book` re-definition not reverting transport/F23/oversell logic; the dotted line being gone everywhere; the step-① gate; and pickup/drop-off persisting distinctly.
- [ ] **Step 4:** Commit any review fixes.

---

## Self-review (author)

**Spec coverage:** 3-step flow (Tasks 3–4 + existing step ③) ✓; "want pickup?" prompt + adaptivity (Task 3) ✓; read-only real route, no dotted line (Tasks 2–3) ✓; "I don't know yet" bypasses gate + no fee (Task 3 gate + booking body) ✓; phone required on pickup (Task 4) ✓; distinct `dropoffLocation` + TBD flag (Task 1) ✓; admin visibility (Task 5) ✓; builds on transport add-on + Peach (reused, not rebuilt) ✓.

**Type/name consistency:** `dropoffLocation`/`pickupPending` (camel DTO) ↔ `dropoff_location`/`pickup_pending` (snake DB); `wantsPickup`/`tbd`/`canAdvanceStep1`/`Step1State`; `PickupMap` props `value`/`onChange`/`onCoords` (existing) — consistent across tasks.

**Verify-at-execution-time flags:** the winning `api_book` source migration (Task 1, Step 3 — must copy verbatim); the exact dashed-line line numbers (Task 2 — grep, don't trust line numbers); whether an existing country/phone-code list exists to reuse (Task 4). Resolve by reading the real files, not by guessing.
