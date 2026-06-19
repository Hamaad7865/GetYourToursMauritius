# Multi-Option Selector — Design

> Brainstormed 2026-06-20. Lets a customer choose between an activity's options (e.g. Deep Sea Fishing
> "Half-Day Boat Trip" €180 / "Full Day Boat Trip" €360) on the activity page, with the chosen option
> driving price, availability, and the booking. First of three follow-ups (then single-map drop-off,
> then editable highlights).

**Problem:** The data model, admin save, and `api_get_activity` already carry ALL of an activity's
options correctly. The break is in the booking widget: `BookingProvider` auto-picks ONE option
(globally cheapest tier for per_person/per_group; `options[0]` for vehicle) and there is no UI to
choose. `BookingOptionCard` even hardcodes "1 option available". So a second option is silently
dropped. This is a widget-layer change only — no DB/API/admin change.

## Locked decisions
1. **Option picker = selectable cards** (GetYourGuide style), shown at the top of the booking widget
   (choose *what*, then *how many* / *when*).
2. **Only render the picker when `activity.options.length > 1`.** Single-option activities are
   unchanged (no visual change for the common case).
3. **Default selection = the current auto-pick** (globally cheapest tier's option for per_person/
   per_group; `options[0]` for vehicle) — so nothing regresses; the customer can switch.
4. **Pick one option per booking** (like GYG). Mixing options in one booking is out of scope.

## Behaviour
- A new `selectedOptionId` in `BookingProvider`, initialised to the default auto-pick. `setSelectedOption`
  updates it, resets the chosen `date` to `''` (occurrences differ per option), and calls `touch()`.
- **Pricing follows the selected option, not the global cheapest.** Today `cheapest` scans every option's
  tiers; we replace its pricing role with the cheapest tier *within the selected option* (`selectedTier`).
  `baseTotal`, `unitPriceEur`, `priceLabel`, `groupSize`, and the per-person `tierCap` all read from
  `selectedTier`. (For vehicle mode the selected option's `vehiclePricing` already applies; selection just
  changes which option's id is booked.)
- **Availability follows the selected option.** `bookingOptionId` becomes `selectedOptionId`; the
  availability effect already filters occurrences by it (`s.activityOptionId !== bookingOptionId`), so
  switching re-fetches/re-filters to that option's dates.
- **Checkout threading is unchanged** — `continueToCheckout` already posts `bookingOptionId` / `priceLabel`
  / `total`; they now reflect the selection.
- **Card content** (per option): option name, its **from-price** (cheapest tier, formatted by pricing mode
  — "€X per person" / "from €X" / "€X per group up to N" / vehicle "from €X"), an optional short
  `description`, and capacity ("fits up to N") when the tier has `maxGuests`. The selected card uses the
  existing teal selected-state border. Cards are keyboard-operable (radio semantics).

## Pure helpers (unit-tested) — `src/lib/catalogue/options.ts`
- `cheapestTier(option)` → the option's lowest-priced tier `{ label, amountEur, maxGuests }` (or null if no
  tiers).
- `defaultOptionId(options, isVehicle)` → `options[0].id` for vehicle, else the id of the option holding the
  globally cheapest tier (preserves today's default).
- `optionCardSummary(option, pricingMode, type)` → `{ name, fromPriceEur, maxGuests, unitNote }` for the card
  (no React; pure, so it's testable and shared by the card + any mirror).

## Files (verify at plan time)
- `src/lib/catalogue/options.ts` (new, pure helpers) + `tests/unit/options.test.ts`.
- `src/components/gyg/detail/BookingProvider.tsx` — add `selectedOptionId`/`setSelectedOption`; selected-
  option-driven pricing + availability; expose in context.
- `src/components/gyg/detail/OptionSelector.tsx` (new) — the selectable-card list.
- `src/components/gyg/detail/BookingOptionCard.tsx` / `BookingWidget.tsx` — render `OptionSelector` when
  2+ options; replace the hardcoded "1 option available".
- `src/lib/i18n/messages.ts` — any new labels (French).

## Testing
- Unit: `cheapestTier`, `defaultOptionId`, `optionCardSummary` (per_person / per_group / vehicle; no-tier
  edge). The existing pricing tests must stay green (selected = default reproduces today's numbers).
- Manual: a 2-option per-person activity (Deep Sea Fishing) shows two cards; selecting Full Day changes the
  price to €360 × party and re-loads that option's dates; a 1-option activity shows no picker.

## Out of scope
- Multiple options in one booking; admin option CRUD (already exists); any DB/API change.
