# Sightseeing Tours — Vehicle Pricing (global rule)

Date: 2026-06-17
Status: approved (design); ready for implementation plan

## Summary

Every **Sightseeing tour** (the dynamic category "Sightseeing tours") is priced by **one global
rule**, not by per-tour price rows. The whole group pays **€70 per block of 4 people**, with one
upgrade choice at the entry tier (an **SUV** for a flat **€85**). The vehicle shown to the customer
is a function of party size. Party is capped at **25**; above that, the page shows a "contact us"
link instead of a price.

This **replaces** the earlier flat-bracket "vehicle" mode (€75/€85/€125/€240, "smallest vehicle that
fits"), which was never used in production. It supersedes the plan file
`content-import-seed-data-reactive-dragonfly.md`.

## The rule

```
price(people, suv):
  if 1 <= people <= 4 and suv:  suv_flat_eur            # €85, flat
  else if 1 <= people <= 25:    per_block_eur * ceil(people / 4)   # €70 per 4
  else:                         reject (exceeds_vehicle_capacity)
```

`per_block_eur` and `suv_flat_eur` are the only tunable numbers (see config below). Block size (4),
the vehicle bands, and the cap (25) are fixed constants.

### Vehicle bands (fixed; affect the displayed name + the SUV option, NOT the price)

| People | Vehicle name | Notes |
|--------|--------------|-------|
| 1–4    | `Sedan` (or `SUV` if upgraded) | only tier with a choice; SUV = flat €85 |
| 5–6    | `Family car` | one option |
| 7–14   | `Minibus`    | one option |
| 15–25  | `Coaster`    | one option |
| 26+    | —            | "Contact us to arrange more than 25" |

Resulting prices: 1–4 €70 (SUV €85) · 5–8 €140 · 9–12 €210 · 13–16 €280 · 17–20 €350 · 21–24 €420 · 25 €490.
(Family car caps at 6 and minibus at 14, so e.g. 7–8 = €140 in a minibus, not a family car.)

## Data model

### `sightseeing_pricing` — one-row global config (approach A)

```sql
create table if not exists sightseeing_pricing (
  id            boolean primary key default true check (id),  -- single-row guard
  per_block_minor int not null default 7000,                  -- €70 per block of 4
  suv_flat_minor  int not null default 8500,                  -- €85 SUV, flat, ≤4 people
  updated_at    timestamptz not null default now()
);
insert into sightseeing_pricing (id) values (true) on conflict (id) do nothing;
alter table sightseeing_pricing enable row level security;  -- no policies: PostgREST can't touch it
```

Amounts are integer **minor units** (cents) to match `activity_option_prices.amount_minor`. Changing
the price for all sightseeing tours = `update sightseeing_pricing set per_block_minor = 8000;` — one
line, no redeploy. RLS is on with **no policies**, so the only readers are the `SECURITY DEFINER`
RPCs (`create_booking`, `api_get_activity`, `api_search_activities`) which bypass RLS; the owner
edits the row from the SQL editor (service role). `create_booking` reads this row (authoritative);
the catalogue API returns it (as EUR) so the widget mirrors the exact same numbers.

### `pricing_mode` and price rows

- `activities.pricing_mode='vehicle'` is the trigger for this rule. Its old flat-bracket meaning is
  removed. (`per_person` and `per_group` are unchanged.)
- Sightseeing tours need **no `activity_option_prices` rows**. They keep **one option** (so
  occurrences/availability have something to attach to). The price comes entirely from the rule + the
  party size + the SUV flag.
- `booking_items.pax` (already added) records people on board; `quantity = 1` so the day's
  `daily_capacity` counts **vehicles**, not heads. (Unchanged from the prior migration.)

## Server changes (authoritative)

All in a **new migration** (`create or replace`), and appended idempotently to `supabase/catch-up.sql`.

1. **`create_booking`** vehicle branch — recompute against the rule:
   - read `per_block_minor`, `suv_flat_minor` from `sightseeing_pricing`;
   - `P = v_qty_total`; reject `P < 1` or `P > 25` (`exceeds_vehicle_capacity`, detail = P);
   - `v_unit := (P <= 4 and p_suv) ? suv_flat_minor : per_block_minor * ceil(P/4.0)`;
   - vehicle name via a `CASE` on P (`Sedan`/`SUV`/`Family car`/`Minibus`/`Coaster`);
   - write ONE `booking_items` row: `quantity=1`, `pax=P`, `unit_amount_minor=subtotal_minor=v_unit`,
     `price_label=` vehicle name. (No `activity_option_prices` lookup.)
   - keep the existing "hold reserves ONE vehicle" guard (`v_hold.quantity = 1`).
2. **`api_book`** — gains a `p_suv boolean default false` parameter; in vehicle mode it still calls
   `create_hold(occ, 1, key)` (one vehicle) and passes `p_suv` to `create_booking`. One transaction,
   so an over-25 reject rolls back the hold (no orphan). **Adding the param changes the signature**,
   so the migration must `drop function if exists api_book(<existing arg list>)` before the
   `create or replace` (otherwise Postgres keeps both as overloads → ambiguous-call errors). The
   DbRpc transport (supabaseRpc + pgliteRpc) call sites must pass `p_suv`; the pgliteRpc ALLOWED set
   already lists `api_book` (name unchanged).
3. **`api_get_activity` / `api_search_activities`** — for `pricing_mode='vehicle'`:
   - return `pricingMode='vehicle'`,
   - `fromPriceEur = per_block_minor/100` (€70),
   - include the config block: `vehiclePricing: { perBlockEur, suvFlatEur, blockSize: 4, maxParty: 25 }`.
   - (Non-vehicle modes unchanged.)

## Client changes (mirror only; never trust the client price)

- **`src/lib/services/pricing.ts`** — replace `pickVehicleBracket`/`maxVehicleCapacity` with a pure
  `sightseeingQuote(people, suv, cfg)` returning `{ vehicle, totalEur }`, plus shared band constants
  `VEHICLE_BANDS = [{max:4,name:'Sedan'},{max:6,name:'Family car'},{max:14,name:'Minibus'},{max:25,name:'Coaster'}]`
  and `SIGHTSEEING_MAX_PARTY = 25`. A unit test asserts the boundary prices above and that bands match
  the SQL `CASE` (guard against client/server drift).
- **`src/lib/validation/tours.ts`** — add the optional `vehiclePricing` config to the tour DTO;
  `pricingMode` enum stays `'per_person'|'per_group'|'vehicle'`.
- **`src/components/gyg/detail/BookingWidget.tsx`** — vehicle mode:
  - participant stepper `1..25`;
  - live vehicle name + total from `sightseeingQuote`;
  - at `people ≤ 4`, a **Sedan / SUV** toggle (SUV shows €85); cleared/ignored above 4;
  - the "Contact us to arrange more than 25" link (→ `/contact`) shown at the cap;
  - carry `suv` (0/1) + `qty` to checkout (server re-resolves regardless).
- **`src/lib/cart/useCart.ts`** — `CartItem` already has `pricingMode`; vehicle `itemTotal` = flat rule
  price; store the resolved `unitEur` + a `suv` flag.
- **`src/components/checkout/Checkout.tsx`** — forward the `suv` flag to `api_book` (new param).
- **`src/components/gyg/PlaceCard.tsx`** — vehicle mode unit label "per vehicle"; "From €70" via
  `fromPriceEur`.

## Admin

- **`src/components/admin/ActivityForm.tsx`** — keep the 3-way pricing-mode select; for `vehicle` mode
  hide the per-tour price-rows editor and show help text: "Sightseeing vehicle pricing (€70 per 4 +
  SUV) is set globally and applies to every sightseeing tour." Optionally surface the two global
  numbers read-only.
- **`src/lib/admin/activity-write.ts`** — vehicle mode saves no price rows.
- Voucher / admin bookings already use `coalesce(pax, quantity)`, so a 12-person booking reads
  "12 passengers" in a Minibus. Verify the vehicle name (`price_label`) is shown.

## Tests

- **`tests/integration/security-fixes.test.ts`** (PGlite, against real `create_booking`):
  party 1→€70, 4→€70, 4+SUV→€85, 5→€140, 6→€140, 7→€140, 12→€210, 14→€280, 15→€280, 25→€490,
  **26→`exceeds_vehicle_capacity`**; assert `quantity=1`, `pax=P`, `price_label` = expected vehicle.
- **Capacity-as-vehicles**: `daily_capacity=2`, two vehicle bookings succeed, a third rejected
  (proves holds count vehicles, not people) — keep/adapt the existing case.
- **`tests/unit/pricing.test.ts`** — `sightseeingQuote` boundary cases incl. the over-25 throw and the
  SUV branch.
- Grep + fix any remaining flat-bracket assumptions and `group_pricing`/`groupPricing` references.

## `supabase/catch-up.sql`

Append, idempotently and after the existing blocks: the `sightseeing_pricing` table + seed row, and
the rewritten `create_booking` / `api_book` / `api_get_activity` / `api_search_activities`. The owner
re-runs `catch-up.sql` on the live DB to pick this up. See [[gytm-db-sync]].

## Verification

- Green gate: `npm run typecheck && npm run lint && npm run test && npm run build`.
- Preview: set a sightseeing tour to `vehicle` mode + bookable, step the party 1→25 and confirm the
  vehicle + price at each boundary, the Sedan/SUV toggle ≤4, and the "contact us" link at the cap;
  book a 12-person group and confirm the voucher reads "12 passengers · Minibus" and the day's
  remaining count drops by exactly **one vehicle**.

## Risks / edge cases

- **SUV only ≤4**: above 4 the toggle is hidden and `p_suv` is ignored server-side.
- **Band ≠ price**: 7–8 people = €140 but ride a Minibus (family car caps at 6). The vehicle name and
  the price are computed independently; tests pin both.
- **No price rows**: the catalogue/`fromPriceEur` path must not assume a price row exists for vehicle
  mode (use the config's `per_block`).
- **Client/server drift**: bands + cap are duplicated (TS constant + SQL `CASE`); a test asserts they
  agree.
