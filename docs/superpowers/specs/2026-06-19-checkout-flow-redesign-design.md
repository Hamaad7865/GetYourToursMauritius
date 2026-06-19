# Single-Tour Checkout Flow Redesign — Design

> Brainstormed 2026-06-19. **Effort 2 of the checkout overhaul** (effort 1 = the cart & hold
> lifecycle, already shipped). This effort covers the **single-tour** checkout. The **multi-item
> "order"** (one payment grouping several tours, per-item pickup/drop-off UI) is a deliberate
> **fast-follow** with its own spec — out of scope here.

**Goal:** Turn the checkout into a clean three-step flow — ① trip & pickup (with a real route map),
② personal details (GetYourGuide-style), ③ pay — that adapts to whether the booking needs a pickup,
captures pickup and drop-off as distinct data, shows the customer their actual driving route, and
surfaces pickup / drop-off / itinerary to admin. Fluent and bug-free.

**Build on, don't rebuild:** the region-based **transport add-on already exists** (commit `e716ebb`:
`PickupMap`, resolved pickup coordinates → a distance/region transport fee the server enforces). This
effort *uses* it — the "want pickup?" → pickup path feeds that existing fee. Do not re-implement
transport pricing. Likewise the **Peach embedded payment** (step ③) is already built — reuse it.

## Locked decisions

1. **Single tour now; multi-item order is a separate fast-follow** (Q1 → A).
2. **Step ① is adaptive; every booking is asked "do you want pickup?"** (Q2 → A + prompt). Yes → the
   pickup flow (+ the existing transport fee); No → "Meet at [activity location]", no fee, no route.
3. **Read-only route confirmation; "I don't know yet" bypasses the gate** (Q3). The route map is a
   confirmation, not an editor (stop selection already happens in the itinerary builder / planner).
4. **Phone required when there's a pickup**, optional otherwise (Q4). Skip the "notes" box and the
   "save to profile" toggle for now (YAGNI).
5. **TBD pickup → no transport fee at checkout.** A pickup with no address has no coordinates, so no
   distance fee can be computed; the booking is flagged "pickup to be arranged" and the team confirms
   the pickup (and any fee) afterward.

## 1. The three-step flow (enhances the existing `Checkout.tsx`)

The current checkout is already `Transport → Contact → Payment` with the region transport fee. We
reshape it to:

- **Step ① "Trip & pickup"** — shown for every booking, adaptive:
  - A prompt: **"Do you want pickup?"** → *Yes, pick me up* / *No, I'll make my own way*. Default
    sensibly per the activity (a pickup-capable day tour defaults Yes; a fixed-location activity
    defaults No), but always toggleable.
  - **Yes** → the existing pickup type-to-search + map pin (coordinates → the transport fee) → a
    **drop-off** input → a **read-only route map** of the real driving route (pickup → the tour's
    stops, if any → drop-off). A transfer with no stops is simply pickup → drop-off. Plus an **"I
    don't know yet"** option: proceed with pickup flagged TBD, no route, no fee.
  - **No** → no pickup, no fee; show "Meet at [activity location]."
  - **Gate:** cannot advance when *Yes* is selected and the pickup address is empty **and** "I don't
    know yet" is not chosen.
- **Step ② "Your details"** — the GetYourGuide layout from the provided screenshot: pre-filled name +
  email (from the signed-in account), a country selector, a mobile-phone field (**required when the
  booking has a pickup**, optional otherwise), a "Go to payment" button, and the "Pay nothing today /
  Free cancellation" reassurance row.
- **Step ③ "Payment"** — the existing Peach embedded widget. Unchanged.

## 2. Data model

- Add **`bookings.dropoffLocation`** (text, nullable). Today drop-off is concatenated into
  `pickupLocation` as `"… → drop-off: X"`; split it so admin and the route use pickup and drop-off
  distinctly. Keep `pickupLocation` for the pickup address.
- Pickup mode: derive from data — `pickupLocation` present ⇒ pickup; a sentinel/flag distinguishes
  **"pickup to be arranged" (TBD)** from "no pickup" so admin can tell them apart (e.g. a nullable
  `pickupStatus` or a reserved `pickupLocation` value — decide at plan time, prefer an explicit
  column).
- Phone persists on the existing booking customer record (already captured today).
- Itinerary already persists (`customItinerary`). No change.
- One small migration, mirrored into `supabase/catch-up.sql` (owner re-runs on the live DB).

## 3. The route map (and the dotted-line removal)

A single **read-only route component** that draws the **real driving route** via Google Directions/
Routes (pickup → itinerary stops → drop-off). This **replaces the dotted red straight-line** wherever
it currently renders (checkout, planner, activity detail — locate every occurrence). When Directions
is unavailable (no key / API error), fall back to plain numbered markers + a "View on Google Maps"
link — **never** the dotted line. The route is display-only; the booking stores pickup, drop-off, and
itinerary, and the route is recomputed from those for display.

## 4. Admin visibility

The admin booking detail shows **pickup, drop-off, and itinerary** as distinct fields (pickup +
itinerary already appear; add drop-off, and show the "pickup to be arranged" state clearly).

## 5. Validation & edge cases

- Step ① gate as above; phone required at step ② when there's a pickup.
- "I don't know yet" → booking flagged TBD, no fee, no route; proceeds.
- Directions failure → marker fallback (no dotted line).
- A booking that already carried a pickup/route from an earlier entry point (the widget/planner
  hand-off, or a cart line) pre-fills step ① — preserve those existing hand-offs.

## 6. Out of scope (the fast-follow)

- **Multi-item "order":** one checkout/one payment grouping several tours, with per-activity pickup/
  drop-off ("same for all" / "same drop-off?" controls) — its own spec next.
- Re-implementing transport pricing (exists, `e716ebb`) or the Peach widget (exists).

## 7. Testing

- Unit: step-① gating logic (want-pickup × empty-address × "I don't know yet"); the pickup-mode/TBD
  derivation; phone-required-on-pickup validation. Route-input → route-shape mapping (pickup → stops
  → drop-off, including the no-stops transfer case).
- Integration (PGlite): a booking persists `dropoffLocation` distinctly; the TBD flag round-trips and
  shows in the admin DTO.
- Manual: the three steps, the adaptive pickup prompt, the read-only route render + Directions
  fallback, no dotted line anywhere, admin shows pickup/drop-off/itinerary.

## Likely files (verify at plan time)

- `src/components/checkout/Checkout.tsx` (the step machine), `PickupMap` + the pickup search,
  `RouteMap`/the route component (find the dotted line here), the planner + activity-detail maps.
- `src/lib/validation/booking.ts` (+ `dropoffLocation`, pickup-status), the booking service +
  `api_book`/booking DTO, a migration + `supabase/catch-up.sql`.
- The admin booking detail (`src/lib/admin/bookings.ts` + the admin component).
