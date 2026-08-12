# Per-line transport add-on — Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use `- [ ]`. Spec:
> `docs/superpowers/specs/2026-08-12-per-line-transport-addon-design.md`. Commits are OFF this session
> (owner hasn't asked) — each phase gate is "affected suites + typecheck green", not a git commit.

**Goal:** A round-trip transfer becomes a transport add-on attached to a tour/custom quote line (its own
pickup/drop-off + fare, counted in the total), instead of a separate line — so it travels with the
activity on the calendar and reads as one line + add-on on the receipt.

**Architecture:** Three nullable columns (`transport_pickup_label`, `transport_dropoff_label`,
`transport_fare_minor`) on `quote_items` / `booking_items` / `booking_custom_items`. Total = Σ line
subtotals + Σ transport fares, threaded through `quoteTotalMinor`, `api_convert_quote`'s mismatch check,
and the pay-route re-price. Editor attaches it per line; calendar + receipt read it off the line.

**Tech stack:** Next.js/React (edge), Supabase Postgres (SECURITY DEFINER RPCs), pdf-lib, Zod, vitest/PGlite.

---

## Phase 1 — Schema + total (foundation)

**Files:** Create `supabase/migrations/20260924000000_line_transport_addon.sql`; modify
`supabase/catch-up.sql`, `supabase/setup.sql` (regen), `supabase/backfill-migration-ledger.sql`,
`src/lib/quotes/totals.ts`; test `tests/unit/quote-totals.test.ts`, `tests/integration/quotes-schema.test.ts`.

- [ ] Migration adds the 3 nullable columns to `quote_items`, `booking_items`, `booking_custom_items`
      (`transport_fare_minor bigint check (… is null or >= 0)`). Mirror into catch-up.sql; `npm run setup:sql`;
      append `('20260924000000','line_transport_addon')` to the ledger.
- [ ] `totals.ts`: `PricedLine` gains `transportFareMinor?: number`; `quoteTotalMinor` adds it per line with
      the same `Number.isSafeInteger` guard. `lineSubtotalMinor` unchanged.
- [ ] Tests: `quoteTotalMinor` includes the fare; a negative/oversized fare throws.
- [ ] Gate: `quote-totals`, `quotes-schema`, `migration-ledger`, `setup-sql-parity`, `catch-up-parity` green.

## Phase 2 — Conversion + pay-route (money path)

**Files:** modify the `api_convert_quote` body in the new migration (or a paired one) + catch-up/setup;
`src/lib/admin/quotes.ts` (`quoteItemRows` / save), `app/api/v1/quotes/[ref]/pay/route.ts`; tests
`tests/integration/quote-receipt.test.ts` / `quote-pay.test.ts` / `admin-quotes.test.ts`.

- [ ] `saveQuote`/`quoteItemRows`: persist the 3 transport columns on `quote_items` (cleared on rentals).
- [ ] `api_convert_quote`: copy the columns onto `booking_items` + `booking_custom_items`; include Σ
      transport fares in the `quote_total_mismatch` check and in `bookings.total_minor`.
- [ ] Pay route `assertQuotedPricesStillStand`: expected total += stored transport fares (trusted, never
      re-derived from catalogue).
- [ ] Tests: convert a quote whose tour line has a transfer → booking carries the columns, total matches;
      pay reconciles; a fare mutated below the stored value is refused.
- [ ] Gate: quote-receipt, quote-pay, admin-quotes, resolved-function-bodies, parity suites green.

## Phase 3 — Quote editor

**Files:** `src/components/admin/quotes/state.ts`, `src/components/admin/quotes/LinesPane.tsx`,
`src/components/admin/quotes/PickupTransportDrawer.tsx`, `src/lib/admin/quotes.ts` (QuoteItemInput type);
tests `tests/unit/admin-quotes-editor.test.ts`, `tests/unit/quote-transport-line.test.ts`.

- [ ] `QuoteLineDraft.transport: { pickupLabel; dropoffLabel; fareText } | null`; `QuoteItemInput` gains the
      transport triple; `quoteInputFromForm` parses `fareText` → minor (reuse `parseEurosToMinor`), drops it on
      rentals; `formFromQuote` round-trips it. Retire `transportLineDraft` from the standalone path.
- [ ] `LinesPane`: per tour/custom line, a **+ Add transport** control → opens pickup picker (shared quote
      pickup, remembered) → auto-price via `transportFareMinor` → nested sub-row (editable fare + × detach).
- [ ] `PickupTransportDrawer`: reduce to "set the guest pickup" (no more separate-line spawning), or fold its
      map into the per-line control.
- [ ] Tests: `quoteInputFromForm` emits transport on a tour line, null on a rental; round-trip via
      `formFromQuote`; total reflects the fare.
- [ ] Gate: admin-quotes-editor, quote-transport-line, admin-quotes green; typecheck.

## Phase 4 — Calendar

**Files:** `src/lib/admin/calendar.ts`, `src/components/admin/AdminCalendar.tsx`; test
`tests/unit/admin-calendar.test.ts`.

- [ ] `DayDeparture` + `DayCustomLine` carry `transportPickup`/`transportDropoff`; the reads select the new
      columns; the pure mappers surface them.
- [ ] `AdminCalendar`: render a "round-trip transfer" badge + pickup/drop-off on the activity card.
- [ ] Tests: a booking_item / custom line with transport surfaces its pickup on the day sheet.
- [ ] Gate: admin-calendar green; typecheck.

## Phase 5 — Receipt / email / quote page

**Files:** `src/lib/services/receipt.ts`, `src/lib/invoice/model.ts`, `src/lib/invoice/pdf.ts`,
`src/lib/email/booking-confirmation.ts`, `src/lib/email/quote.ts`, `app/(site)/quotes/[ref]/page.tsx`;
tests `tests/unit/invoice-model.test.ts`, `tests/unit/invoice-pdf.test.ts`, `tests/integration/quote-receipt.test.ts`.

- [ ] `api_booking_receipt` items carry the transport triple; `receiptSchema` + loader thread them.
- [ ] `buildInvoice`: an item with a transport fare emits a **nested** second `InvoiceLine`
      (`isAddon: true`, own gross, description "Round-trip transfer · from <hotel>"), reconciling to the total.
- [ ] `pdf.ts` + `booking-confirmation.ts`: indent the add-on line under its parent. Quote email/page nest it.
- [ ] Tests: an item with transport → two lines that sum to the total; addon line rendered.
- [ ] Gate: invoice-model, invoice-pdf, quote-receipt, booking-confirmation-email green.

## Phase 6 — Christophe's data + full verification

- [ ] Hand-authored SQL to fold `BMTDB3C935BB085C`'s four transfer custom lines into transport add-ons on
      their tour lines (set the parent's transport columns; delete the transfer custom rows), preserving the
      €616 total. Delivered to owner (read-only MCP) — not auto-run.
- [ ] Full `npx vitest run` green; typecheck, eslint, prettier clean.

```

```
