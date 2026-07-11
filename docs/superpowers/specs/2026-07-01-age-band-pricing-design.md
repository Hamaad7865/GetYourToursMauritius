# Age-band pricing for activities — design spec (2026-07-01)

## Context

Activities are priced per-tier already (`activity_option_prices`: `label` + absolute `amount_minor` + `max_guests`),
and the server (`create_booking`) already prices a **multi-tier party** zero-trust (count × each tier's DB price,
one `booking_items` row per tier). But the customer booking widget (`BookingWidget`/`BookingProvider`) collapses
everything to a single `participants` count priced at the option's **cheapest** tier. We want a GetYourGuide-style
**age-band selector** — Adult full price, Child half price, Infant free — with the bands + ages + prices **admin-managed
per activity**, flowing through the existing zero-trust money path.

## Owner decisions (locked)

- **Admin-defined per activity** — admin adds any bands (label + age range + price) per activity; seed defaults
  Adult (11+, full) / Child (3–10, half) / Infant (0–3, free), editable.
- **Absolute prices + quick presets** — prices stay absolute `amount_minor` (free = 0). Admin gets one-tap
  **Full / Half / Free** buttons that fill the € figure from the adult/base tier. NO percentage rule engine, NO
  money-path change.
- **Everyone takes a seat** — infants included count toward capacity/hold quantity. NO capacity-logic change.

## Architecture (by layer)

### Layer 1 — Schema (small, additive)

- `alter table activity_option_prices add column if not exists min_age int`, `max_age int` (both nullable — existing
  non-age tiers unaffected).
- **Re-apply `api_get_activity` byte-identically** from the winning body ([catch-up.sql](../../../supabase/catch-up.sql) ~line 6907)
  - add `'minAge', pr.min_age, 'maxAge', pr.max_age` to the `options[].prices[]` jsonb projection ([[gytm-migration-revert-drift]]).
- New migration `2026XXXX_price_age_bands.sql` = the `alter` + the re-applied `api_get_activity`; append **both** byte-identically
  to catch-up.sql. `types.ts`: add `min_age`/`max_age` to `ActivityOptionPricesRow`/`Insert`.

### Layer 2 — DTO + shared pricing

- [tours.ts](../../../src/lib/validation/tours.ts) `tourPriceSchema`: add `minAge: z.number().int().nullable()`, `maxAge` (same),
  `.nullish().catch(null)` so an old-shaped payload still parses.
- [pricing.ts](../../../src/lib/services/pricing.ts): `quoteTotal(tiers, party)` already sums a multi-tier party — reuse as-is.
  Add a pure `ageBandLabel(minAge, maxAge)` → `"Age 3–10"` / `"Age 11+"` / `"Age 0–3"` helper (+ unit test).
- A tier is an "age band" when `minAge != null || maxAge != null`. An option is **multi-band** when it has ≥2 priced tiers.

### Layer 3 — Booking widget (the core work)

- [BookingProvider.tsx](../../../src/components/gyg/detail/BookingProvider.tsx): when the selected option is multi-band, hold a
  per-tier count map `party: Record<label, number>` instead of a single `participants`. Derived `totalGuests = sum(party)`,
  `baseTotal = quoteTotal(option.prices, party)`. Single-tier options keep the existing `participants` path unchanged
  (compute an equivalent one-key party at checkout). At least one non-free/"adult" guest required to proceed.
- [BookingWidget.tsx](../../../src/components/gyg/detail/BookingWidget.tsx): render the per-band stepper (label + `ageBandLabel`
  - € + running total) in the participants popover for multi-band options; keep the single stepper otherwise. Respect per-band
    `maxGuests` and the overall party cap.

### Layer 4 — Checkout / cart threading

- Encode the full party map through the flow. `continueToCheckout` (BookingProvider) + add-to-cart currently push a single
  `label`+`qty`; widen to a compact `party` param (e.g. `party=Adult:2~Child:1~Infant:1`, url-safe) alongside the existing
  `qty`/`label` (kept for single-tier back-compat). [Checkout.tsx](../../../src/components/checkout/Checkout.tsx) parses the
  `party` param into the `party` object it already sends to `api_book`; cart line stores the party map (fallback to
  `{[priceLabel]: guests}` when absent). Server unchanged.

### Layer 5 — Admin

- [ActivityForm.tsx](../../../src/components/admin/ActivityForm.tsx) OptionsEditor: per price-tier row add optional **Age from /
  Age to** inputs + **Full / Half / Free** quick-price buttons (compute from the highest-priced tier in the option). An
  **"Add age band"** action appends the Adult/Child/Infant default triplet.
- [activity-write.ts](../../../src/lib/admin/activity-write.ts): `PriceInput` + `replacePrices` carry `minAge`/`maxAge`
  (`Math.round` or null). No new validation beyond a soft overlap hint.

### Cross-cutting

- **EUR integer cents**; prices absolute; server re-derives every total (zero-trust) — client party is advisory.
- **Back-compat**: options without age bands render + book exactly as today. `min_age`/`max_age` null = non-age tier.
- **Revert-drift**: `api_get_activity` re-applied byte-identically into migration + catch-up; parity test guards it.

## Verification

1. Unit: `ageBandLabel` cases; `quoteTotal` multi-band incl. a €0 infant band.
2. Integration (PGlite): `api_get_activity` returns `minAge`/`maxAge`; `api_book` books `{Adult:2,Child:1,Infant:1}`,
   prices each band (incl. €0), hold quantity = 4 seats; single-tier booking still works.
3. Catch-up parity green (api_get_activity migration == catch-up).
4. E2E preview (best-effort): multi-band activity → per-band steppers → correct total → checkout total matches → book.
5. typecheck + lint + full suite green.

## Owner action to go live

Re-run `supabase/catch-up.sql` (adds `min_age`/`max_age` + re-applies `api_get_activity`), then set age bands + prices
per activity in `/admin` (the Age from/to + Full/Half/Free controls).

## Out of scope (YAGNI)

Percentage/multiplier pricing rules; infant seat-exclusion; hard age-overlap validation; age bands on non-`per_person`
products (vehicle/transfer); per-band availability.
