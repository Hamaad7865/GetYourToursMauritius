# Car & Scooter Rental — design spec (2026-06-30, rev. 2)

## Context

`/rent` is a static SEO/info page ending in a WhatsApp "enquire" CTA. The owner runs a real 6-vehicle
rental fleet (carrentmauritius.com). We make `/rent` a **fleet picker with a transparent price that hands
off to WhatsApp** — and give the owner an **admin screen to manage the fleet + rates** themselves.

**Owner decisions (final):**
- **No online payment, no checkout, no booking engine.** Rental is enquiry/booking **via WhatsApp only**.
- **Admin-managed fleet** — vehicles, rates, photos live in the DB and are edited in `/admin` (no deploy).
- Fleet + rates: the 6 real vehicles, **scooters €20/day, cars €36/day**.

This is therefore a **frontend + a small CRUD table** — NOT the transfer-style bookable product. No
`api_book` change, no holds/availability, no `/checkout`, no payment provider, no migration to api_book.

| Vehicle | Category | Seats | Daily rate |
|---|---|---|---|
| Haojue VX | scooter | 2 | €20 |
| SYM Crox | scooter | 2 | €20 |
| Suzuki AN (Address) | scooter | 2 | €20 |
| Nissan March | economy | 5 | €36 |
| Nissan Note | economy | 5 | €36 |
| Suzuki Ertiga | family (7-seater) | 7 | €36 |

## Behaviour
- `/rent` keeps ALL its SEO content. A **fleet section** lists active vehicles (photo, name, category, seats, per-day price).
- A **booking widget**: pick a vehicle → pickup + return dates + delivery location (free-text or Google Places) + optional extras (baby seat, extra driver) → it computes **`days × daily_rate`** (`days = max(1, returnDate − pickupDate)`) and shows the total + the deposit note → **"Book on WhatsApp"** opens `wa.me` with a pre-filled message:
  > `Hi Belle Mare Tours! I'd like to rent the {vehicle} from {pickup} to {return} ({days} days, ~€{total}). Deliver to: {location}. {extras}. My details: …`
- Deposit is shown for transparency (collected at handover; per-vehicle, admin-set, default 0). Delivery free on the east coast.

## Reusable building blocks
- Admin single-table grid + browser-client writes under staff RLS: [vehicle-pricing.ts](src/lib/admin/vehicle-pricing.ts) + [AdminVehiclePricing.tsx](src/components/admin/AdminVehiclePricing.tsx) (`loadTransportBands`/`updateTransportBand`). The admin shell + nav: [AdminShell.tsx](src/components/admin/AdminShell.tsx).
- Public read of a DB list via a `security definer` RPC, parsed with a zod schema in a service: `api_search_transfer_hotels` + [transfers.ts](src/lib/services/transfers.ts) / [transfers.ts](src/lib/validation/transfers.ts).
- WhatsApp deep link: `whatsappUrl(message)` in [site.ts](src/lib/seo/site.ts). Mauritius Google Places autocomplete for the delivery field: the `PlacesField` in [HotelToHotelQuote.tsx](src/components/transfers/HotelToHotelQuote.tsx) (reuse pattern; free-text fallback when Maps isn't ready). Price in cents helpers: [pricing.ts](src/lib/services/pricing.ts).
- RLS template (public read + staff write): `hotel_transfer_fare` policies in [catch-up.sql](supabase/catch-up.sql).

## Implementation plan (by layer)

### Layer 1 — DB migration `2026XXXX_rental_fleet.sql` (+ append byte-identically to catch-up.sql)
1. `rental_vehicles` table: `slug text pk`, `name text`, `category text` (scooter|economy|family), `seats int`, `transmission text null` (auto|manual), `air_con boolean default true`, `image_url text null`, `daily_rate_minor int not null`, `deposit_minor int not null default 0`, `sort int not null default 0`, `active boolean not null default true`, `updated_at timestamptz default now()`. RLS copied **verbatim** from `hotel_transfer_fare`: public read, staff write. Grants accordingly.
2. Seed the **6 vehicles** above (scooters `daily_rate_minor=2000`, cars `3600`, deposit `0`), idempotent `on conflict (slug) do nothing`, with category/seats and the real photo URLs (or null until uploaded).
3. `api_list_rental_vehicles()` `security definer` → returns the **active** vehicles ordered by `sort, name` as JSON (the public `/rent` read). Grant execute to anon/authenticated/service_role.
4. Append the table DDL + seed + function byte-identically to catch-up.sql ([[gytm-migration-revert-drift]] — additive; does NOT touch api_book, so far lower risk than the transfer work). **No api_book / booking / availability changes.**

### Layer 2 — Validation + service
- New `src/lib/validation/rental.ts`: `rentalVehicleSchema` ({ slug, name, category, seats, transmission, airCon, imageUrl, dailyRateEur, depositEur, sort, active }) + `rentalVehicleUpdateSchema` for admin writes.
- New `src/lib/services/rental.ts`: `listRentalVehicles(ctx)` → `callRpc(ctx, 'api_list_rental_vehicles', {})` parsed with the schema. (Admin CRUD uses the browser client directly under RLS — Layer 4.)
- `src/lib/services/pricing.ts`: `rentalDays(pickup, ret)` + `rentalTotalEur(dailyEur, days)` pure helpers (and a unit test) so the widget and any future use price identically.

### Layer 3 — `/rent` fleet picker + WhatsApp handoff
- New `src/components/rental/RentalWidget.tsx` (client): receives the vehicle list (fetched server-side and passed in, or fetched client-side); renders vehicle cards (photo, category, seats, €/day); on select, shows the date range (pickup/return inputs, `min` today) + delivery location (Places autocomplete w/ free-text fallback) + optional extras; computes `days × rate`; the CTA is a `whatsappUrl(...)` link with the full pre-filled message. Graceful: invalid/short dates disable the CTA with a hint.
- [rent/page.tsx](app/(site)/rent/page.tsx): server component fetches `listRentalVehicles(publicServiceContext())`, renders the existing SEO sections PLUS the fleet + `<RentalWidget vehicles={…} />` near the top. Keep the bottom WhatsApp `EnquireRow` as the catch-all. (No JSON-LD change required; optionally add `Vehicle`/`Offer` items later.)

### Layer 4 — Admin "Rental fleet"
- New `src/lib/admin/rental.ts`: `loadRentalFleet()` / `upsertRentalVehicle(v)` / `setRentalVehicleActive(slug, active)` via the browser Supabase client (staff RLS), mirroring `loadTransportBands`/`updateTransportBand`.
- New `src/components/admin/AdminRentalFleet.tsx`: a grid to add/edit vehicles (name, slug, category, seats, transmission, A/C, daily rate, deposit, image URL, sort, active). Wire a route + nav entry into the admin shell.

## Cross-cutting rules
- **EUR integer cents** in the DB (`*_minor`); the widget prices from the daily rate × days (no server re-derivation needed — there's no charge).
- **Admin writes via staff RLS** (browser client), public reads via the `security definer` list RPC — same split as the rest of the catalogue/admin.
- **Migration revert-drift:** the new DDL + RPC appended byte-identically to catch-up.sql; owner re-runs catch-up.sql. (Additive only.)
- **No PII / no payment** flows through us — the WhatsApp message is composed client-side and the user sends it themselves.

## Verification
1. **Unit** ([pricing.test.ts](tests/unit/pricing.test.ts)): `rentalDays` (same-day=1, 1-night=1, Mon→Wed=2) + `rentalTotalEur` (3 days × €36 = €108; 1 day × €20 = €20).
2. **Integration / RLS** (PGlite): `api_list_rental_vehicles` returns only `active` vehicles in `sort` order; an anonymous client can READ active vehicles but CANNOT write; a staff client can upsert; the 6 seeds exist with the right rates.
3. **Migration:** catch-up parity green (the new objects match the migration); api_book + every booking path UNCHANGED.
4. **E2E (preview):** `/rent` lists the fleet; pick Nissan March + 3 days + a delivery location → shows €108 → the WhatsApp link contains the vehicle, dates, days, total and delivery; `/admin` Rental fleet edits a rate and it reflects on `/rent`.
5. typecheck + lint + full suite green.

## Out of scope (YAGNI)
Online payment / checkout / booking records; availability or inventory; cash/card flows; per-unit reservations; weekly-rate tiers (flat €/day only); licence-image upload; multi-currency.

## Owner actions to go live
Re-run `supabase/catch-up.sql` (creates `rental_vehicles` + the list RPC + seeds the 6 vehicles); then manage the fleet (rates, deposits, photos, add/remove vehicles) in `/admin` → Rental fleet.
