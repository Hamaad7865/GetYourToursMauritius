# AI Email → Quote, Rental Lines, Calendar Union, info@ Sender — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **Status:** grounded from the 2026-08-07 surface map. Build after the deposit feature (Phases 1–4) lands.

**Goal:** An operator pastes a customer enquiry email into `/admin/quotes`; the AI extracts the request (tours, party, dates, pickup hotel, car rental, preferences), the system **matches each to the real catalogue and prices it from the catalogue**, and produces a **draft quote the operator reviews and sends** — from `info@bellemaretours.com`. Rentals become quote lines; everything booked shows on the admin calendar.

**Non-negotiable guardrails (enforced by code, not just prompt):**

1. **The AI never sets a price that becomes a charge.** It proposes a catalogue **slug**; the system prices from `activity_option_prices.amount_minor`. A catalogue line is auto-demoted to custom unless its unit price _exactly_ equals the real tier (`quoteInputFromForm`, state.ts:306-314) — so a model-invented price cannot survive as a catalogue charge. Custom lines (most vehicle tours) carry **no AI price** — the operator prices them (an optional `fromPriceEur` _hint_ may be shown, clearly marked, never pre-charged).
2. **The operator always reviews before send.** The AI pre-fills the editor; nothing auto-sends.
3. **Gemini billing is an external blocker.** With no `GOOGLE_GENERATIVE_AI_API_KEY` the provider is the stub and the model builder returns null → the feature reports "AI unavailable, fill manually". Build + test against a `MockLanguageModelV1`; it works in prod when billing is restored.

---

## Phase A — AI email → draft quote

### Task A1: Extraction schema + service

**Files:** create `src/lib/services/quote-extraction.ts`, `src/lib/validation/quote-extraction.ts` (Zod); test `tests/unit/quote-extraction.test.ts` (MockLanguageModelV1).

- The Zod extraction schema (what the model must return):
  ```
  customer: { name?: string, email?: string }
  party:    { adults: number, children?: number, infants?: number }
  availability: { from?: string, to?: string }   // ISO dates, a RANGE
  pickupHotel?: string                            // free text
  locale: 'en' | 'fr'
  activities: Array<{ rawText: string, matchedSlug: string | null, confidence: 'high'|'low' }>
  rental: { requested: boolean, matchedSlug: string | null, days?: number, transmission?: 'automatic'|'manual'|null }
  preferences?: string                            // e.g. "one rest day between excursions"
  ```
- Build the model with the `plannerModel(ctx)` pattern (planner-agent.ts:81-86): guard `ctx.ai.name === 'google'` + key; else return null → `{ available: false }`.
- Feed the model **candidate lists** so `matchedSlug` is a REAL slug: published activities via `searchActivities(ctx, {page:1,pageSize:100})` (slug, title, category, region, pricingMode) and the rental fleet via `api_list_rental_vehicles` (slug, name, category). The prompt: "match each requested tour to at most one candidate slug, or null if unsure; never invent a slug or a price."
- Use `generateObject({ model, schema, prompt })` (AI SDK v4 — the clean forced-JSON path; not yet used in the repo, so this is the first use).
- Accept an injectable `modelOverride?: LanguageModelV1 | null` (like `runPlannerTurn`) so tests pass a scripted `MockLanguageModelV1`.
- **Tests:** feed the French sample email + a scripted model returning the expected extraction → assert the structured result. Assert the null-model path returns `{ available: false }`.

### Task A2: Extraction → draft `QuoteFormValues`

**Files:** `src/lib/services/quote-extraction.ts` (or a sibling `quote-draft.ts`); test `tests/integration/quote-draft-from-email.test.ts`.

- Start from `emptyQuoteForm()` (state.ts:222). Override customerName/email (from extraction), validUntil (default), locale, introNote.
- **Pickup hotel + preferences** → `introNote` (no structured field exists — landmine).
- For each `activities[]` with a `matchedSlug`:
  - Resolve slug → activity_id (keep both from the `searchActivities` candidate — `loadQuotableActivities` has no slug).
  - Run `catalogueLineRefusal({ pricingMode, isPrivate, priceCount })` (state.ts:439). **If refused (vehicle/vehicle_custom pricing, private option, or zero price tiers) → a CUSTOM line** with the AI's description and **no price** (operator prices it). Most sightseeing tours (private south tour, catamarans) land here.
  - Else attempt a catalogue line: pick a date in `availability` (respecting the rest-day preference — see A3), call `loadActivityDepartures(activityId, day)` (quote-catalogue.ts:73); if a status='open' occurrence exists, build `tourLineDrafts(pick)` with party split across tiers and the **real** `amountMinor`; if no open occurrence on any candidate day → fall back to a CUSTOM line with the requested date as a note.
- **Party size** (no quote-level field) → split across tier quantities on each line.
- Result is a `QuoteFormValues` that survives `quoteInputFromForm` unchanged. **Never** put a non-catalogue price on a catalogue line (it demotes silently).
- **Tests:** the French email → a draft with the 4 excursions as lines (catamarans/dolphin priced if occurrences exist, else custom+unpriced), a rental line, pickup hotel in the intro note, party = 2 on each line.

### Task A3: Rest-day scheduling (best-effort)

- Given `availability.from..to` and N excursions with a "rest day between" preference, propose dates spacing excursions ≥2 days apart within the window. Pure function `proposeSchedule(from, to, count, gapDays)` → dates; used to pick catalogue occurrence days and to annotate custom lines. Operator can change any date. Unit-tested pure.

### Task A4: Admin "Draft from email" UI

**Files:** `src/components/admin/quotes/DraftFromEmail.tsx`; a route `app/api/v1/admin/quotes/draft-from-email/route.ts` (staff-gated, mirrors the send route's gate); wire into `AdminQuotes.tsx`.

- A textarea + "Draft quote" button in the quote editor. Posts the pasted email to the staff route → runs A1+A2 → returns a `QuoteFormValues` the editor loads for review.
- Show a summary of what was matched vs. what needs attention (unpriced custom lines, low-confidence matches, unmatched requests). Never auto-save, never auto-send.
- If `{ available: false }` (no Gemini), show "AI drafting is unavailable — add lines manually" (billing blocker), still fully usable by hand.
- **Tests:** staff-gated (non-staff 403); a stubbed extraction → the route returns a draft; the AI-unavailable path returns the manual message.

---

## Phase B — Rental as a quote line

**Files:** `src/components/admin/quotes/LinesPane.tsx` (+ a rental picker), reuse `src/lib/admin/rental.ts` (`loadRentalFleet`) and `src/lib/services/pricing.ts` (`rentalDays`, `rentalTotalEur`); the editor state + service already support `kind='rental'`.

- Add an **"Add rental"** toolbar button beside "Add tour"/"Add custom line". A picker lists **active** vehicles (`loadRentalFleet` filtered active), a day count, and computes `unit = daily_rate_minor`, `quantity = days`, `subtotal = days × daily_rate_minor` (reuse `rentalDays`/`rentalTotalEur` so the quote matches the public `RentalWidget`).
- The line is `kind='rental'`, `rentalVehicleSlug=<slug>`, `description` non-empty (vehicle name + dates). **Landmine:** `quoteItemRows` clears `rental_vehicle_slug` unless `kind==='rental'` — the picker MUST set kind, not leave it 'custom'.
- **The vehicle security `deposit_minor` does NOT enter the quote total** (it's a separate refundable hold; `quote_total_mismatch` would fire if it leaked in). Show it as an informational note only.
- A rental line converts into `booking_custom_items` (kind='rental') via the existing `api_convert_quote` — no SQL change needed for a plain rental line.
- **Tests:** adding a rental line prices days × daily rate; the deposit is not in the total; `quoteItemRows` preserves the slug; conversion lands it in `booking_custom_items`.

---

## Phase C — Calendar union (Part 3)

**Files:** `src/lib/admin/calendar.ts` (`loadDaySchedule`, `mapDaySchedule` + new `mapDayCustomLines`), `src/components/admin/AdminCalendar.tsx`; test `tests/unit/admin-calendar.test.ts`.

- `loadDaySchedule(day)` adds a SECOND browser query on `booking_custom_items` `.gte('starts_at', startUtc).lt('starts_at', endUtc)` embedding `bookings ( … )`, folded into the returned list. (The partial index `booking_custom_items_starts_idx` was built for exactly this.)
- Add a pure `mapDayCustomLines(rows)` (unit-tested like `mapDaySchedule`). Introduce a `kind: 'occurrence' | 'custom'` discriminant on the day entry so the card renderer handles a line with **no occurrence, no capacity, no pax**.
- **Landmines (all from the map):** a rental's `quantity` is VEHICLES not people — it must **not** be summed into `pax`; call-off UI (`notifiableCount`, `callOffDeparture(occurrenceId)`) must **exclude** custom/rental lines (no occurrence to call off); a custom line with NULL `starts_at` appears on no day (acceptable — only dated lines show); a multi-day rental shows on its **start day** for v1 (note `ends_at` on the card), not every intervening day.
- This closes the gap where a converted-quote booking (only `booking_custom_items`, zero `booking_items`) appears on the calendar nowhere today.
- **Tests:** a dated custom line and a rental line appear on their day; a rental contributes 0 pax; a NULL-starts_at line appears nowhere; the call-off count ignores custom lines.

---

## Phase D — Send quotes from info@bellemaretours.com

**Files:** `src/lib/notifications/index.ts` (provider construction), `src/lib/notifications/resend.ts` (per-message `from`), `src/lib/config/env.ts` (new `QUOTE_FROM`), the send route.

- `info@bellemaretours.com` is a **real, monitored Google Workspace mailbox on the verified `bellemaretours.com` domain** (SPF/DKIM/DMARC complete — mail-auth-chain). It is NOT the dying legacy `visitemaurice.com` info@. So sending from it is deliverable.
- Add an optional per-message `from` and set the `quote_sent` template's `from` to `env.QUOTE_FROM ?? SITE.email` (= `info@bellemaretours.com`). Reply-To is already `info@`. Wire in `getNotificationProvider()` / the send path; do NOT change the global `RESEND_FROM` (that would move every confirmation/refund/invoice too).
- **Tests:** the message handed to the provider for `quote_sent` carries `from = info@bellemaretours.com`; other templates keep `RESEND_FROM`.
- **Owner note:** confirm Resend is allowed to send from `info@` (same verified domain as `bookings@`, so it should be — but a first send should be watched for a domain-identity rejection).

---

## Cross-cutting

- **Parity** for any SQL: catch-up.sql + setup.sql + ledger + openapi. (Phases B/C/D need little or no SQL.)
- **Known shared-tree baseline:** the suite currently has 2 pre-existing failures from another session's uncommitted **saved-cards** work (openapi `/saved-cards`, i18n saved-card strings). Do not touch or fix those; the bar is no NEW failures.
- **i18n:** every new user-facing string in EN **and** FR (`src/lib/i18n/messages.ts`), or i18n-coverage gains a failure.
- **Never push / never touch the live DB** — local + verified only until the owner deploys.

## Self-Review

**Owner's ask covered:** paste-email → AI draft (Phase A) · price from catalogue, AI never charges (guardrails + A2) · car rental line (Phase B) · calendar shows everything booked (Phase C) · send from info@ (Phase D).
**Biggest risks:** (1) most sightseeing tours are vehicle-priced → custom, unpriced by AI — that's correct and safe, but means the operator still prices those; set expectations. (2) catalogue lines need a real open occurrence on the chosen day — the AI proposes dates, the system verifies. (3) Gemini billing gates the live AI; everything else works without it.
**Deferred:** multi-day rental showing on every day; a structured pickup-hotel field; auto-send.
