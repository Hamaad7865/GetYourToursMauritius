# Per-line transport add-on (quotes)

**Date:** 2026-08-12
**Status:** approved (design)

## Problem

A round-trip transfer is quoted as its **own separate `custom` line** (`transportLineDraft` in
`src/components/admin/quotes/state.ts`, added from `PickupTransportDrawer.tsx`). It is not linked to the
tour it serves, and the pickup lives only inside the line's description text. Consequences:

- The quote reads as two lines — the tour, then a "Round-trip transfer · … · from <hotel>" line beneath.
- On the operations calendar the transfer is a **standalone card** and its pickup/drop-off does not
  travel with the activity, so the day sheet can't show "this excursion, collected from that hotel".

The operator wants a transfer to be an **add-on attached to each tour/custom line** — one line, with a
nested transport add-on that carries its own pickup/drop-off and its own price.

## Decision

- **Representation:** nested add-on with its **own price**, stored as **structured fields on the line**
  (not a separate line, not a linked child row).
- **Existing data:** new model for new/edited quotes only. Existing separate transfer lines are left
  as-is; the one live booking (Christophe / `BMTDB3C935BB085C`, quote `Q44B907083033`) is folded into
  add-ons by hand-authored SQL.

## Design

### 1. Data model

Each priced line may carry an optional transport add-on as three nullable columns (all null ⇒ no
transfer). Added to every table a line lives in so the add-on survives conversion and reaches the
calendar + receipt:

- `quote_items`
- `booking_items` (catalogue tour lines)
- `booking_custom_items` (custom lines)

Columns:

- `transport_pickup_label text` — the guest's hotel/address, shown to guest + driver.
- `transport_dropoff_label text` — defaults to the pickup (round-trip); may differ.
- `transport_fare_minor bigint check (transport_fare_minor is null or transport_fare_minor >= 0)`.

The line's own `subtotal_minor` stays the tour/custom price. The transport fare is a **separate amount on
the same row**. **Total = Σ line subtotals + Σ transport fares** everywhere the total is computed.

Rentals do **not** get a transport add-on (a car is the transport).

### 2. Money path

- `src/lib/quotes/totals.ts`: `PricedLine` gains an optional `transportFareMinor`; `quoteTotalMinor`
  adds it (same safe-integer guards). `lineSubtotalMinor` is unchanged (line price only).
- `api_convert_quote`: copies the three columns from `quote_items` onto the minted `booking_items` /
  `booking_custom_items`, and its `quote_total_mismatch` check includes the transport fares.
- `app/api/v1/quotes/[ref]/pay/route.ts` (`assertQuotedPricesStillStand`): the expected total adds the
  stored transport fares. They are operator-set and trusted exactly like a custom line's amount — never
  re-derived from the catalogue — so an attached transfer never makes a quote unpayable.

### 3. Quote editor

- `QuoteLineDraft` gains `transport: { pickupLabel; dropoffLabel; fareText } | null` (fare held as TEXT
  like every other money field, parsed once in `quoteInputFromForm`).
- Each **tour/custom** line (not rental) gets a **+ Add transport** control in `LinesPane`. It opens the
  existing pickup picker (guest hotel set once, remembered on the quote), auto-prices the round-trip fare
  from that pickup to _that line's_ activity region via `transportFareMinor`, and shows a nested sub-row:
  _"Round-trip transfer · from <hotel> — €60"_ with an editable fare and a × to detach.
- The standalone-line path (`transportLineDraft`) and the "adds separate lines" behaviour of
  `PickupTransportDrawer` are retired; the drawer becomes "set the guest pickup" only (or is folded into
  the per-line control).

### 4. Calendar

`src/lib/admin/calendar.ts`: `DayDeparture` (occurrence) and `DayCustomLine` carry the line's own
`transportPickup` / `transportDropoff`. The day-sheet card and `AdminCalendar` render a "round-trip
transfer" badge + the pickup/drop-off on the activity itself, so the transfer no longer needs a separate
card. (The `booking_custom_items`-only "custom line" cards for real standalone customs are unchanged.)

### 5. Receipt / email / quote page

- `src/lib/services/receipt.ts` + `src/lib/invoice/model.ts`: a receipt item with a transport add-on
  emits **two invoice lines** — the tour line, then a nested transport line (its own gross, marked so the
  renderer indents it under its parent). The per-line VAT split already nets each line, so this is
  consistent by construction.
- `src/lib/invoice/pdf.ts` + `booking-confirmation.ts` render the transport line indented under its
  parent with "from <hotel>".
- The guest quote page / email (`src/lib/email/quote.ts`, `app/(site)/quotes/[ref]/page.tsx`) render the
  add-on nested under its line.

### 6. Out of scope

- The public single-activity booking flow (already has one per-booking transport add-on).
- Auto-migration of existing separate transfer lines.

## Testing

- `totals.ts`: transport fare included in `quoteTotalMinor`; guards hold.
- Conversion: `api_convert_quote` copies the columns and the total check includes fares (integration).
- Pay route: a quote with an attached transfer reconciles and stays payable; tampering with the fare is
  refused.
- Editor (`state.ts`): `quoteInputFromForm` parses the transport fare; round-trips through
  `formFromQuote`; a rental never carries transport.
- Calendar: the pure mappers surface the line's pickup/drop-off.
- Receipt: an item with a transport add-on renders a nested second line that reconciles to the total.
- Schema/parity: `resolved-function-bodies`, `catch-up-parity`, `setup-sql-parity`, migration ledger.
- Full `vitest run` green.
