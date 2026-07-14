# Pre-Launch Bug Report — Belle Mare Tours

> Generated 2026-06-20 by a multi-agent read-only sweep (recon + 13 specialist hunters → adversarial
> verification of every P0/P1 → completeness critic + synthesis). 34 raw findings → **11 confirmed**, 2
> false positives filtered, 21 P2. Deploy gate green (typecheck, lint, 355 tests, `next build`).
> Launch target: < 8 days.

---

## 1. GO / NO-GO

**NO-GO until §2 is fixed.** The browse→hold→book→pay→confirm _engine_ is solid — server-authoritative
pricing, FOR UPDATE + capacity oversell guards, RLS, and the EUR-ledger/USD-charge split all hold up, and
the full gate is green. But there is **one money-correctness P0 (duplicate booking + double charge on
browser-back)** plus operational-wiring risks (off-by-default cron, silent email no-op, unauthenticated
paid-AI endpoints) that cause real harm within hours of launch. These are config/guard fixes, not rewrites.

**Deploy gate (all PASS):** typecheck · lint · vitest (62 files / 355 tests) · `next build`. Caveat: the
gate runs `next build` (not the Windows-broken Cloudflare `pages:build`) with the **localhost env default**,
so the config-default risks below are invisible to a green gate.

---

## 2. P0 — LAUNCH BLOCKERS

### P0-1 — Browser-Back/refresh after a booking mints a fresh idempotency key → duplicate booking + double charge

**Money error · `src/components/checkout/Checkout.tsx:186, 287-329, 335-344, 367`**
Idempotency rests entirely on React state that dies on remount. `idemKey` = `useState(() => idemParam ||
crypto.randomUUID())`; `idemParam` is populated only from the `gytm:hold:${occ}` stash and only when
`from=widget`. On a successful booking, `pay()` clears the stashes and does a full-page nav. Press **Back**
(or reload `/checkout` — no `Cache-Control: no-store`) and Checkout remounts: `bookingRef` is `null`,
`readHold()` is empty, a **fresh random `idemKey`** is minted, the `if (!ref)` branch creates a **second**
booking. `create_booking` dedups solely by `idempotency_key`; there is no occurrence+email uniqueness. Both
can be paid.
**Fix:** persist `{bookingRef, idemKey}` per occurrence in sessionStorage + rehydrate on mount; derive the
idem key deterministically from `(occ + party + email)`; server belt-and-suspenders in `api_book` (reuse a
recent `payment_pending` booking for the same occ+email); add `Cache-Control: no-store` to checkout; add a
duplicate-booking test.

### P0-2 — Unauthenticated, unthrottled paid-AI / Google endpoints → wallet-DoS

**Security / cost-abuse · `app/api/ai/trip-planner/route.ts`, `app/api/ai/place-insights/route.ts`, `app/api/planner/optimize/route.ts`, `app/api/planner/places/route.ts`**
All four routes are public; the only rate limit anywhere is on `api_capture_lead`. `plannerChatInputSchema`
allows 40 messages/request and `runPlannerTurn` runs `maxSteps: 6`, each step able to call billed Gemini +
Google Places (New)/Routes. `AI_PROVIDER` defaults to `'google'`. One anonymous POST fans out to many billed
calls — and **Google billing was already depleted once on this project**, now internet-exposed.
**Fix:** per-IP rate limiting (DB-token pattern or Cloudflare Rate Limiting + Turnstile) on all four routes
before exposing them; tighten `maxSteps` + the 40-message cap; consider requiring auth for the co-pilot. If
the planner ships **disabled** at launch, this downgrades to "must-fix before enabling the planner."

---

## 3. P1 — FIX BEFORE LAUNCH

### P1-1 — Email confirmations silently dropped (stub provider marks "sent" without sending)

`src/lib/notifications/index.ts:9-15`, `stub.ts:10`, `services/notifications.ts:38-40` — when
`RESEND_API_KEY`/`RESEND_FROM` are unset, `getNotificationProvider()` returns the stub whose `send()` is a
no-op, and the drain still marks `'sent'`. Every confirmation/refund email is silently black-holed.
**Fix:** fail closed in production (refuse to mark 'sent' with no real provider); set `RESEND_*` in the Pages env.

### P1-2 — Background-worker cron DISABLED by default (no hold sweep, no expiry, no availability roll-forward, no email)

`.github/workflows/scheduled-tasks.yml:19` + the internal routes are gated on `ENABLE_SCHEDULED_TASKS` +
`SITE_URL` + `INTERNAL_TASK_SECRET`, off by default with no alarm. Unconfigured → stale holds never swept
(inventory stays locked), availability horizon stops advancing (future dates vanish), no emails drained.
**Fix:** enabling the cron + all three settings is a P0-grade checklist item; add a heartbeat alert.

### P1-3 — Paid customer stuck on a non-refreshing "awaiting payment" page (no poll, no recovery)

`BookingConfirmation.tsx:51-64,109-114,219-223`, `EmbeddedCheckout.tsx:60-75` — `confirmThenReturn()` is
best-effort (ignores the sync response, navigates unconditionally); the confirmation page fetches once on
mount, no poll, no retry button. With the HMAC webhook absent, a just-charged customer hits a dead-end.
**Fix:** retry sync with backoff before navigating; poll `/api/v1/bookings/{ref}` for ~60-90s on
`payment_pending` with a "Confirming your payment…" state + a refresh affordance; a server reconciliation
pass for stuck bookings (rides on P1-2 cron).

### P1-4 — Cart checkout double-holds inventory (the cart's own hold blocks the purchase)

`src/components/cart/CartView.tsx:18-40,151-182` — "Proceed to checkout" creates a real hold, then navigates
omitting `holdId`/`from=widget`, so checkout mints a **second** hold for the same party. When free seats <
2×party, `create_hold` raises `insufficient_capacity` → "this date just filled up" even though the customer
is the only holder; the orphan lingers ~30 min.
**Fix:** stash `gytm:hold:${occ}` per held cart line and relax `readHold()` to accept `from=cart`, so
`api_book`'s reuse branch attaches the existing hold; add a hold-reuse test.

### P1-5 — `NEXT_PUBLIC_SITE_URL` silently defaults to `http://localhost:3000` with no live guard

`src/lib/config/env.ts:18` — a missing/typo'd value becomes localhost. It builds the Peach return URL +
`Origin`, the CORS allowlist, canonicals/OG/sitemap/robots/JSON-LD. Unset in prod → customers land on
localhost, Peach may reject on Origin mismatch, SEO points to localhost. The green gate runs with the
localhost default and can't catch it.
**Fix:** drop the `.default()` (or `superRefine` reject localhost when live); add a `siteUrlConfigured`
check to the live health gate; document that the prod build must set it (NEXT*PUBLIC*\* is build-time inlined).

### P1-6 — CSV formula injection in admin Bookings export via attacker-controlled customer name

`src/components/admin/AdminBookings.tsx:174-189` — `csvCell()` quotes but doesn't neutralize leading `= + - @`.
`customerName` is public-settable (`POST /api/v1/bookings`, only `min(1).max(120)`). An admin opening the
export in Excel/Sheets evaluates the formula → exfiltration or DDE.
**Fix:** prefix any cell starting with `= + - @ \t \r` with `'` in `csvCell()`, applied to every column; add a test.

### P1-7 — French i18n gaps on the core booking & confirmation flow

`BookingOptionCard.tsx:222-280`, `Checkout.tsx:651,362`, `BookingConfirmation.tsx:154` — multiple `t()`
strings have no `fr` key (the transport/pickup block ~8 strings, "Door-to-door transport", "Could not start
payment.", "Pickup to be arranged"), so French users see English on prominent surfaces.
**Fix:** add the `fr` entries (reuse the `{region}` placeholder; mind the em-dash near-miss "Drop-off — same
as pickup" vs "Drop-off same as pickup").

---

## 4. P2 — POST-LAUNCH (21 items, brief)

At-least-once email re-send window; whole-dollar USD vs exact EUR rounding; `regionFromCoords` fee for
out-of-Mauritius coords; cart drops pickup/transport intent; real hold expiring mid-checkout blocks Pay with
no recovery; stale order-summary transport line; signed-out guest holds unreadable by creator; account/admin
reads rely solely on RLS; vehicle activities unbookable without a dummy option-price row; unbounded `party`
key count; stale `fx.ts` comment ("charged in EUR"); health endpoint info leak + webhook no rate limit;
`RouteMap` re-runs paid Directions on every render (inline-array deps); gallery `<img>` missing dimensions
(CLS); catalogue FAQ translates DB content / place names (rule violation); dates formatted `en-GB` for French
users; `.dev.vars.example` omits `NEXT_PUBLIC_SITE_URL` + `INTERNAL_TASK_SECRET`.

---

## 5. UNCERTAIN — NEEDS HUMAN EYES

- **Capacity unit consistency** (people vs vehicles vs groups) across pricing modes — a mismatch silently mis-gates oversell.
- **`api_planner_places` / `api_search_activities`** public read RPCs exist but were not traced end-to-end (low money risk).
- **GDPR / PII retention** — `notification_outbox.payload`, `leads`, `bookings` store name/email with no erasure path (governance, not a code bug). Positive: no PII in logs.
- **Accessibility** — date picker, multi-step checkout, embedded payment never reviewed for keyboard/ARIA/contrast.
- **Supabase JWKS fetch outage** would fail auth for all logged-in users — undocumented in any runbook.

---

## 6. COVERAGE & RESIDUAL RISK

**Audited & clean:** server-authoritative pricing (client can't influence the charge); oversell guard (FOR
UPDATE + capacity); RLS + admin authz (refs/hold-ids are not bearer credentials); EUR-ledger/USD-charge split

- reconcile on EUR minor; catch-up-vs-migrations parity (3 tests); no secret leaks; no PII in logs; graceful
  Maps/optimize/places/FX fallbacks.

**Lacks test coverage (add with the fixes):** duplicate-booking on remount (P0-1); cart hold reuse (P1-4);
rate-limit on `/api/ai/*` + `/api/planner/*` (P0-2); notification fail-closed (P1-1); CSV `=`-cell escaping
(P1-6); `fr` key presence (P1-7). Config-default risks (P1-5, cron/email) are structurally invisible to the
green gate.

---

## 7. RECOMMENDED FIX ORDER — NEXT 8 DAYS

- **Day 1-2 (money + cost):** P0-1 double-charge; P0-2 rate-limit the AI/planner routes (or ship them disabled).
- **Day 3-4 (ops wiring):** P1-2 enable cron + 3 settings + heartbeat; P1-1 set Resend + fail-closed; P1-5 SITE_URL fail-closed + health guard.
- **Day 5-6 (trust + integrity):** P1-3 confirmation polling + sync retry + reconciliation; P1-4 cart hold reuse + test.
- **Day 7 (content + injection):** P1-7 missing `fr` keys; P1-6 CSV escape + test.
- **Day 8:** full regression; the §5 human-eyes checklist; deploy rehearsal on Cloudflare Pages with the **real** prod env (verify return URL, sitemap host, a live test booking + email + cron heartbeat) — validate the deployed Pages artifact, not just `next build`.

**Go-live gate:** do not flip live until **P0-1 and P0-2** are fixed **and** cron + Resend +
`NEXT_PUBLIC_SITE_URL` are confirmed set in the production env with a successful end-to-end test booking that
produced a confirmation email.
