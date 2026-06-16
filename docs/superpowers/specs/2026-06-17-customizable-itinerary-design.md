# Customizable Itinerary + Vehicle Option Card

Date: 2026-06-17
Status: approved (design); ready for implementation plan

## Summary

Two additions to the activity detail page, requested together:

1. **Vehicle option card** — a GetYourGuide-style "option available" card in the page body that
   surfaces the vehicle ladder (Sedan/SUV/Minibus/Coaster + prices) and scrolls to the booking widget.
   Presentational only; reads the existing catalogue config.
2. **Customer-customizable itinerary** — the visitor edits the route inline (remove / add / reorder
   stops from an admin-curated pool), the Google map updates live, and the chosen route is **saved on
   the booking** so the driver follows it. Swaps are **free** (price stays the vehicle price).

Built primarily for Sightseeing (vehicle-priced) tours, but the itinerary builder works for any tour
that has optional stops configured.

## Part 1 — Vehicle option card

`src/components/gyg/detail/VehicleOptionCard.tsx` (new), rendered in the left content column of
`app/activities/[slug]/page.tsx` (above `QuickFacts`), only when `pricingMode === 'vehicle'`.

- Header: tour title as the option, "From €{perBlockEur} per vehicle".
- A small table/ladder of vehicles from `vehiclePricing` + fixed bands: **Sedan €70 (up to 4) · SUV
  €85 (up to 4) · Minibus from €140 (up to 14) · Coaster from €280 (up to 25)**. The "from" price of a
  band is computed (not hardcoded) as `perBlockEur × ceil(bandMin / blockSize)` — Sedan band min 1 →
  €70, Minibus band min 7 → €140, Coaster band min 15 → €280; SUV is its flat `suvFlatEur` €85.
- Facts row: duration, pickup (or meeting point), guide languages.
- A **"Choose vehicle & date"** button that scrolls to the booking widget (`#book`) and is keyboard
  focusable.
- Static — no shared state with the widget. (Live-mirroring the selected vehicle is a deferred
  follow-up; ladder is the v1.)

The booking widget root in `page.tsx` gets `id="book"` so the button can scroll to it.

## Part 2 — Customizable itinerary

### Data model

- **Optional stops + max live in the activity `extra` JSON** (no new table):
  - `activityExtraSchema` gains `optionalStops: z.array(itineraryStopSchema).optional()` and
    `maxStops: z.number().int().positive().optional()` (default 8 when absent).
  - The existing `extra.itinerary` is the **default route** (all stops removable). `extra.optionalStops`
    is the **pool the customer can add** (Fort Adelaide, Apravasi Ghat, …).
- **Chosen route saves to the booking:**
  - New migration: `alter table bookings add column if not exists custom_itinerary jsonb;`
  - `api_book` writes it **after** `create_booking` returns (one `update bookings set custom_itinerary
    = p->'itinerary' where id = v_booking.id` — runs in the SECURITY DEFINER frame, so **no change to
    `create_booking`'s signature**).
  - `booking_json` exposes `customItinerary`.
  - Validation: `createBookingInputSchema` gains `itinerary` — a bounded array
    (`z.array(z.object({ title, area?, lat?, lng? })).max(20).optional()`). It's free + informational,
    so light bounds suffice (no strict allow-listing, no price exposure).

### DTO

`activityExtraSchema` already flows through `api_get_activity` (`extra` is passed verbatim) — only the
Zod schema needs the two new optional fields; no SQL change to the catalogue functions.

### Client — inline builder

- **`src/components/gyg/detail/ItineraryBuilder.tsx`** (new, client) replaces the static `Itinerary`
  section when the tour has `optionalStops` (else the read-only `Itinerary` renders as today):
  - Starts from `extra.itinerary` (defaults selected). Each selected stop shows a **remove (×)** and
    **move up/down** (no drag-and-drop). An **"Add a stop"** picker lists `optionalStops` not already
    chosen; adding appends to the route. Enforces `maxStops`.
  - Renders the existing **`RouteMap`** with the live chosen stops (it already re-renders on `stops`
    change) + an **"Open in Google Maps"** link built from `mapsDirectionsUrl(stops.map(s => s.title))`
    (helper already exists).
  - Persists the chosen route to a **client store keyed by slug** (sessionStorage `gytm:itinerary:<slug>`,
    mirroring the cart's localStorage pattern) so the booking widget — a sibling client component —
    can read it without prop-drilling through the server component page.
- **`BookingWidget`**: on "Book now" it leaves the route in sessionStorage for checkout; on "Add to
  cart" it stores the route on the `CartItem` (`itinerary?: ItineraryStop[]`).
- **`Checkout.tsx`**: reads `gytm:itinerary:<slug>` (or the cart item's route) and includes
  `itinerary` in the `POST /api/v1/bookings` body.
- **`src/lib/services/bookings.ts`**: forwards `input.itinerary` to the `api_book` payload (like `suv`).

### Operator visibility

- **Voucher** (`BookingConfirmation`) and **admin booking detail** (`AdminBookings` / `src/lib/admin/
  bookings.ts`) render `customItinerary` as a numbered list when present ("Your route:" / "Customer
  route:"), falling back to the standard itinerary text when null.

### Admin — curate the pool

- **`ActivityForm.tsx`**: an "Optional stops" editor mirroring the existing itinerary editor (title,
  area, description, tags — reuse the stop row), plus a "Max stops" number input.
- **`src/lib/admin/activity-write.ts`**: `buildExtra` writes `optionalStops` + `maxStops`;
  `ActivityFormValues` + `loadActivityForEdit` carry them; `EMPTY_ACTIVITY` defaults them.

## Tests

- **Unit:** an itinerary-builder reducer (add / remove / move / max-cap) as a pure function so the UI
  logic is tested without the DOM; `mapsDirectionsUrl` already covered.
- **Integration (PGlite):** `api_book` with an `itinerary` array stores `custom_itinerary` and
  `booking_json` returns it; absent → null. A vehicle booking still prices correctly with a route
  attached (no price impact).
- **DTO:** `activityExtraSchema` parses `optionalStops` + `maxStops`; older `extra` without them still
  parses.

## Migration + catch-up

One small migration `20260617140000_booking_custom_itinerary.sql`: the `custom_itinerary` column +
rewritten `api_book` (post-create update) + `booking_json` (expose). Append an idempotent
`catch-up-2026-06-17-custom-itinerary.sql`; the owner runs it on live. See [[gytm-db-sync]].

## Out of scope (YAGNI)

- Drag-and-drop reorder (up/down buttons instead).
- Free-text / geocoded customer places (admin-curated pool only).
- Strict server-side allow-listing of stops (route is free + informational; bounded lengths suffice).
- Live-mirroring the selected vehicle in the option card (ladder v1; easy follow-up).
- Per-stop pricing / paid add-ons.

## Verification

- Green gate: `npm run typecheck && npm run lint && npm run test && npm run build`.
- Preview: on a vehicle tour with optional stops configured, remove a default stop, add Fort Adelaide,
  reorder, watch the map update + the "Open in Google Maps" link; book and confirm the voucher shows
  the chosen route; check it appears in admin. Confirm the vehicle option card renders and its button
  scrolls to the booking widget.
- Owner runs `catch-up-2026-06-17-custom-itinerary.sql` on live.
