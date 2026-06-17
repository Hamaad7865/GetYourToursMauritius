# Per-stop Itinerary Options + GetYourGuide Booking Flow

Date: 2026-06-17
Status: approved (design); ready for implementation plan

Supersedes the flat "optional stops" itinerary model shipped in PR #2; reworks the booking widget into
a GetYourGuide-style two-step flow for **all** tours.

## Feature 1 — Per-stop itinerary alternatives (replaces the flat optional-stops pool)

The customer doesn't add/remove/reorder stops. Instead, **each stop can offer alternatives, and the
customer picks exactly one** ("instead of Pamplemousses, choose Fort Adelaide"). Stops and their order
are fixed by the admin.

### Data model
- `itineraryStopSchema` (in `src/lib/validation/tours.ts`) gains **`options?: AltStop[]`**, where
  `AltStop = { title, area?, lat?, lng? }` (no nested options — one level). The stop's own
  title/area is the **primary/default**; `options` are the alternatives the customer can swap to.
- **Remove** `extra.optionalStops` and `extra.maxStops` (the flat pool) — and everything built for
  them (the route reducer `src/lib/itinerary/route.ts`, the admin "Optional stops" section, the
  add/remove/reorder builder UI).

### Admin (`ActivityForm` `ItineraryEditor`)
Each stop row gets an **"Alternatives (customer picks one instead)"** mini-list: rows of
`title` + `area` the staff can add/remove. `ItineraryStopInput` gains `options: { title; area }[]`;
`buildExtra` writes them (trimmed, empty dropped); `loadActivityForEdit` reads them.

### Customer (`ItineraryBuilder` rewrite)
- A fixed timeline of the admin's stops. For any stop with `options.length > 0`, render the **primary
  + alternatives as selectable chips** (primary selected by default); the customer taps one. No
  remove/reorder/add controls.
- State = `selectedByStop: Record<stopIndex, placeIndex>` (0 = primary, 1.. = `options[n-1]`).
- The **chosen route** = `stops.map((s, i) => placeFor(i))` → `[{ title, area, lat, lng }]`.
- Keeps: the **pickup origin** input (preview-only) and the live **RouteMap** (driving route + car).
- Stashes the chosen route to `sessionStorage['gytm:itinerary:<slug>']` **only when it diverges from
  all-primaries** (so an untouched route saves no `customItinerary`). Same divergence rule as today.

### Booking — unchanged from PR #2
The chosen route still saves to `bookings.custom_itinerary` via `api_book` and shows on the
voucher + admin. No migration change.

## Feature 2 — GetYourGuide booking flow (all tours)

Today the sidebar widget books directly (Book now / Add to cart). New flow, matching the reference
screenshot:

1. **Sidebar widget** keeps Participants / Date / Language and a single **"Check availability"** button.
2. Pressing it **validates the chosen date** (it must have seats/vehicles). On success the button is
   replaced and a **booking option card** is revealed in the left content column showing: tour title,
   **Starting time** (the chosen date), Duration, Guide, pickup line, the **price for that exact
   selection**, and — for vehicle tours with ≤ 4 pax — the **Sedan / SUV** choice. The card has
   **Continue** and **Add to cart**.
3. **Continue → checkout** and **holds the spot** (see below). **Add to cart** drops the configured
   selection into the planning basket (no hold), as today.

### Shared state (the key architectural change)
The sidebar widget and the left-column card must share one selection. Introduce a client
**`BookingProvider`** (React context) wrapping the detail page's booking region, holding:
`participants`, `selectedOccurrence` (date), `lang`, `suv`, `availabilityByDay`, and a `checked` flag.
- The provider owns the availability fetch (moved out of the widget).
- `BookingWidget` (sidebar) consumes it: renders the controls + "Check availability" → `check()`.
- `BookingOptionCard` (left column, generalises the current `VehicleOptionCard`) consumes it: hidden
  until `checked`, then renders the summary/price/SUV + Continue/Add-to-cart. Price is computed per
  `pricingMode` (per_person `×qty`, per_group `×ceil(qty/size)`, vehicle via `sightseeingQuote`).
- The detail page wraps the content + aside in `<BookingProvider activity={...}>` so both columns see
  the same state (props are serializable; the provider is `'use client'`).

### Hold on Continue (move the hold earlier; keep the 30-min timer honest)
- **Recommendation (approved):** do **not** hold at "Add to cart" (abandoned carts would starve a
  small operator's daily capacity). Hold when the customer commits — on **Continue**.
- **Why a booking can't be created yet:** `api_book` needs a customer email, which we don't have
  before sign-in. So Continue creates a **hold only**, not a booking.
- Implementation:
  - New endpoint **`POST /api/v1/holds`** → calls `create_hold(occ, qty, key)` (anon-friendly, no
    email needed) and returns `{ holdId, expiresAt }`. For vehicle mode `qty = 1` (one vehicle); else
    `qty = participants`. Bounded + validated like the booking route.
  - **Continue** calls it, stashes `{ holdId, expiresAt }` (sessionStorage, occurrence-keyed), and
    routes to checkout. The checkout's countdown is driven by the real `expiresAt`.
  - `api_book` gains an optional **`holdId`**: when present (and the hold is active + matches the
    occurrence + qty), it **reuses** that hold instead of creating a new one; otherwise it creates one
    as today. So the Pay step settles the same hold the customer has been holding since Continue.
  - If the hold has expired by Pay, `api_book` falls back to creating a fresh hold (or returns a clean
    "your hold expired, pick a date again" error if the date is now full).
- Abandoned Continues leave an **expiring hold** (no orphaned booking) — so the hold-expiry sweep
  (`run_booking_maintenance`, already built) must be **enabled** to reclaim capacity. Flag to the owner.
- "Add to cart" stays a no-hold basket; checking out a cart line creates its hold via the same path.

### Add to cart placement
The **option card** (step 2, after Check availability) carries both **Continue** and **Add to cart**,
so add-to-cart is only available once participants + date are chosen — as requested.

## Out of scope (YAGNI)
- Real-time per-option availability (each itinerary alternative assumed always available).
- Holding inventory at add-to-cart (explicitly rejected — capacity risk).
- A separate "create hold" endpoint — Continue reuses the existing `api_book` (create_hold + booking).
- Multi-select per stop (one pick per stop, confirmed).

## Tests
- **DTO:** `itineraryStopSchema` parses `options`; older stops without it still parse.
- **Admin round-trip:** `buildExtra`/`loadActivityForEdit` preserve per-stop `options`.
- **Pure:** a small `chosenRoute(stops, selectedByStop)` helper (replaces the route reducer) — picks
  primary/alternative per stop; unit-tested incl. the divergence check.
- **Booking (PGlite):** unchanged `custom_itinerary` persistence still green; a Continue→hold path
  test that a `payment_pending` booking + active hold is created.
- Green gate + an adversarial review pass.

## Verification
- Preview (real browser — the headless preview can't render Google Maps): step a per-group and a
  vehicle tour through Check availability → option card (price + SUV-at-4) → Continue (spot held,
  timer running) → checkout; pick an alternative stop and confirm the voucher route + the map update.
- Owner: enable the hold-expiry sweep; (still) enable the Directions API for the road route.
