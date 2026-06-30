# Car & Scooter Rental — design spec (2026-06-30)

## Context

`/rent` is today a static SEO/info page ending in a WhatsApp "enquire" CTA — rental isn't bookable. The owner runs a real rental operation (carrentmauritius.com) with a 6-vehicle fleet. We make rental a **bookable, payable product**, reusing the proven transfer stack (zero-trust fare → availability → hold → `/checkout` → `api_book` with an `is_rental` flag → admin-tunable rates → `catch-up.sql` self-seed).

Rental differs from every other product in one way: it spans a **date range** (pickup → return) priced **per day**, not a single occurrence. We handle this the way airport/hotel transfers handle their return leg — store pickup + return on the booking and price `days × rate` server-side — rather than reserving every day in inventory.

### Locked decisions (from the owner)
1. **Bookable + pay online**, transfers-style (not enquiry-only).
2. **Payment: card OR cash-on-collection.** The cash path confirms the booking with no online charge; the operator collects cash + deposit at handover.
3. **Fleet = the owner's 6 real vehicles** (scraped from carrentmauritius.com), seeded with their real names/categories/photos:
   | Vehicle | Category | Seats | Daily rate |
   |---|---|---|---|
   | Haojue VX | scooter | 2 | €20 |
   | SYM Crox | scooter | 2 | €20 |
   | Suzuki AN (Address) | scooter | 2 | €20 |
   | Nissan March | economy | 5 | €36 |
   | Nissan Note | economy | 5 | €36 |
   | Suzuki Ertiga | family (7-seater) | 7 | €36 |
4. **Pricing:** `price = days × daily_rate`. No weekly discount today (`weekly_discount_pct` field exists, default 0, admin-tunable). **Free east-coast delivery** (a `delivery_fee_minor` field, default 0). **Deposit** is shown for transparency but collected at handover (`deposit_minor` per vehicle, default 0 until the owner sets it).
5. **Fleet is admin-managed** — the owner maintains vehicles + rates + deposits in a new `/admin` "Rental fleet" screen (placeholders seeded; real numbers above).

### Resolved defaults (codebase-consistent; flag at review)
- **Days** = `max(1, returnDate − pickupDate)` in whole calendar days (same-day or 1-night = 1 day; standard rental-day counting).
- **Availability** = the proven rolling `daily_capacity` pattern on a single `car-rental` bookable product: one noon occurrence per day, a high per-day fleet oversell guard. v1 does **not** reserve the whole date range per-vehicle in inventory (same simplification as the transfer return leg); the operator assigns the actual car and can decline the rare clash. **Per-unit, per-date inventory is explicitly out of scope.**
- **Zero-trust price:** `api_book` re-derives `days × daily_rate` from `rental_vehicles` by the vehicle slug — the client never sends a trusted price.
- **Cash booking** → `status = 'confirmed'`, `payment_state = 'pay_on_collection'` (new enum value), `payment_method = 'cash'`; the checkout skips the Peach step entirely. **Card** booking → the existing `payment_pending` → Peach → reconcile → `paid` flow, with `payment_method = 'card'`.
- **Self-drive only.** Capture driver name + age + licence number (informational, bounded) and optional extras (extra driver, baby seat) as flags. No online deposit hold, no insurance up-sell in v1.

## Reusable building blocks (already in the codebase)
- Bookable-product self-seed + rolling availability: the `hotel-transfer` / `airport-transfer` seeds in [catch-up.sql](supabase/catch-up.sql) (activity + `generate_series` occurrences, no publish step); `materialize_availability`, `set_daily_capacity_atomic`.
- Zero-trust fare branch in `api_book` (keyed on `is_airport_transfer` / `is_hotel_transfer`) that OVERRIDES total/payout/line-item from a DB table + stores product-specific fields; `booking_json` exposing them; the migration-revert-drift discipline (full body byte-identical to catch-up + a new migration; parity test).
- Booking rails: `create_hold`/`api_create_hold`, `create_booking`/`api_book`, `Checkout.tsx` (`htransfer`/airport modes, `reconcileOrWarn`), the on-site `availability → hold → /checkout` flow in `HotelToHotelQuote.tsx`.
- Admin single-table grid: `vehicle-pricing.ts` + `AdminVehiclePricing.tsx`; activity CRUD in `activity-write.ts` + `ActivityForm.tsx` / `AdminActivities.tsx`.
- Maps: the Mauritius Google Places autocomplete (`PickupDropoffMap` / `HotelToHotelQuote` `PlacesField`) for the delivery address.
- Payment provider seam (`getPaymentProvider`, `reconcilePaymentEvent`) — the cash path simply does NOT enter it.

## Implementation plan (by layer)

### Layer 1 — DB migration `2026XXXX_car_rental.sql` (+ append byte-identical to catch-up.sql)
1. `rental_vehicles` table: `slug pk`, `name`, `category text` (scooter|economy|family), `seats int`, `transmission text` (auto|manual nullable), `air_con bool`, `image_url text`, `daily_rate_minor int`, `weekly_discount_pct int default 0`, `deposit_minor int default 0`, `sort int`, `active bool default true`, `updated_at`. RLS: public read of `active`, staff write (copy from `hotel_transfer_fare`). Seed the 6 vehicles above (scooters 2000, cars 3600 minor) — idempotent `on conflict (slug) do nothing`.
2. `alter table bookings add column if not exists` (additive): `rental_vehicle_slug text`, `rental_pickup_date date`, `rental_return_date date`, `rental_days int`, `delivery_location text`, `driver_name text`, `driver_age int`, `driver_licence text`, `payment_method text check (payment_method in ('card','cash'))`.
3. `payment_state` enum: add value `'pay_on_collection'` (or, if altering the enum is risky, a check-constrained text — confirm at implementation).
4. `alter table activities add column if not exists is_rental boolean not null default false;`
5. `rental_price_minor(p_slug text, p_days int) returns bigint` — `daily_rate_minor × p_days` with the weekly discount applied when `p_days >= 7`; reads `rental_vehicles`. TS mirror in pricing.ts (parity test).
6. **Re-apply `api_book` VERBATIM** from its current winning body + an `is_rental` branch: derive `days` (clamp ≥1), `price = rental_price_minor(slug, days)`, OVERRIDE total/payout/line-item, store the rental fields + `payment_method`; when `payment_method='cash'` set `status='confirmed'`, `payment_state='pay_on_collection'`. **Re-apply `booking_json` VERBATIM** + expose the rental fields. **Re-apply `api_get_activity` VERBATIM** + return the fleet (`vehicles[]`) when `is_rental`.
7. Self-seed the bookable `car-rental` activity (`type='transport'`, `is_rental=true`, published, `min_advance_days=0`, `daily_capacity` high) + rolling occurrences (mirror the hotel-transfer seed).
8. Append every new body + DDL byte-identically to catch-up.sql (revert-drift guard).

### Layer 2 — Validation + service
- [booking.ts](src/lib/validation/booking.ts): add `rentalVehicleSlug`, `pickupDate`, `returnDate` (ISO, return ≥ pickup), `deliveryLocation`, `driverName/driverAge/driverLicence` (bounded), `paymentMethod` (`z.enum(['card','cash'])`).
- [bookings.ts](src/lib/services/bookings.ts): thread the new fields into the `api_book` payload.
- New `src/lib/validation/rental.ts` + service: `listRentalVehicles()` (public), admin `loadRentalFleet`/`updateRentalVehicle`. TS pricing mirror `rentalPriceMinor` in [pricing.ts](src/lib/services/pricing.ts) + a parity test block.

### Layer 3 — `/rent` booking widget
- New `src/components/rental/RentalBookingWidget.tsx` (client): vehicle cards from `listRentalVehicles()` (photo, category, seats, per-day price), pick one + pickup/return dates + delivery address (Google Places, free) + optional extras → live price `days × rate` → **Book** → fetch the `car-rental` availability for the pickup day → `POST /holds` (`expectedSlug:'car-rental'`) → stash → `/checkout` with `rental=1` + vehicle/dates/delivery params.
- [rent/page.tsx](app/(site)/rent/page.tsx): keep ALL SEO content; insert the widget near the top (replace/augment the `EnquireRow`). The WhatsApp CTA stays as a fallback.

### Layer 4 — Checkout (rental mode + cash)
- [Checkout.tsx](src/components/checkout/Checkout.tsx): `rental=1` mode — step ① = confirm vehicle/dates/delivery + driver name/age/licence + extras; price = `rentalPriceMinor(slug, days)` (advisory, reconciled server-side). Add a **payment-method choice: "Pay now (card)" / "Pay on collection (cash)"**.
  - Card → existing Peach flow.
  - **Cash → on Pay, `api_book` with `paymentMethod:'cash'` returns a confirmed booking; skip `api_create_payment`; route straight to the confirmation page** (which shows "Pay €X cash on collection + €Y deposit").
- Confirmation page / e-voucher / receipt / owner email: show vehicle, pickup→return, days, delivery, driver, payment method, and (cash) the amount + deposit due on collection.

### Layer 5 — Admin
- New `src/components/admin/AdminRentalFleet.tsx` + `src/lib/admin/rental.ts` (`loadRentalFleet`/`updateRentalVehicle`/`createRentalVehicle`): a fleet grid (name, category, seats, daily rate, weekly %, deposit, image, active). Wire into the admin shell nav. Rental bookings appear in the existing bookings admin with the rental fields + payment method.

### Layer 6 — Content / seed
- Seed the 6 vehicles with their real carrentmauritius.com photos (or our own later). Owner re-runs `catch-up.sql`, sets deposits (+ any weekly discount) in admin.

## Cross-cutting rules
- **EUR integer cents** everywhere (`*_minor`); TS price mirror == SQL (parity test).
- **Server-authoritative price**: `api_book` recomputes `days × rate` from the DB; client never sends a price.
- **Migration revert-drift**: every `create or replace` re-applied from the current winning body + appended byte-identically to catch-up.sql; owner re-runs catch-up.sql.
- **Cash never touches the payment provider** — it's a confirmed, unpaid-on-collection booking.

## Verification
1. **Unit** ([pricing.test.ts](tests/unit/pricing.test.ts)): `rentalPriceMinor` — 1 day, multi-day, weekly threshold; TS == SQL for a sample.
2. **Integration**: book a car (3 days) card → `total = 3 × 3600`; book a scooter (1 day) cash → booking `confirmed` + `payment_state='pay_on_collection'`, NO payment row created; zero-trust (a tampered price is ignored); same-day (`min_advance_days=0`); the rental fields persist in `booking_json`.
3. **Migration**: catch-up parity green; `api_book` still prices every other mode correctly (no regression).
4. **E2E (preview):** `/rent` shows the fleet → pick Nissan March, 3 days, delivery address → price €108 → checkout → **cash** → confirmed page shows amount + deposit; and a **card** booking → Peach opens, `reconcileOrWarn` passes.
5. typecheck + lint + full suite green.

## Out of scope (YAGNI)
Per-unit / per-date fleet inventory; online deposit pre-auth/hold; insurance/extra-driver pricing tiers; weekly-rate UI (field only); multi-currency; licence-image upload.

## Owner actions to go live
Re-run `supabase/catch-up.sql` (seeds the product + fleet + the `api_book` rental branch); set real deposits (and any weekly discount) per vehicle in `/admin` → Rental fleet; optionally swap the seeded photos for own photography.
