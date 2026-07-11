# Invoice + Receipt Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** When a booking is paid, email the customer a branded confirmation with a combined **Tax Invoice / Receipt PDF** attached (VAT-inclusive 15%, business identity, line items, "PAID" stamp with the actual charged amount).

**Architecture:** Enrich the existing `booking_confirmation` drain — fetch the full booking + payment, build a pure invoice model, render an HTML email + a `pdf-lib` PDF, send via Resend (extended for HTML + attachments). Edge-safe.

**Tech Stack:** Next.js 15 (edge), TypeScript strict, Supabase RPCs, Resend, `pdf-lib`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-invoice-receipt-email-design.md`.

---

## Task 1: Persist the charged amount + currency on the payment

**Files:** Create `supabase/migrations/20260723000000_payment_charge.sql`; modify `supabase/catch-up.sql`, `src/lib/services/payments.ts`, `src/lib/supabase/types.ts`; test `tests/integration/payment-charge.test.ts`.

The card is charged in USD while the ledger is EUR; the charged amount is computed in `createPaymentLink` but not stored. Persist it so the receipt is accurate.

- [ ] **Step 1: Migration** — `add column if not exists charged_amount_minor integer; add column if not exists charged_currency text;` on `payments`. (No function re-definition needed — these are plain columns.) Dated AFTER the latest migration (verify; currently `20260722120000_*`).
- [ ] **Step 2: Write them in `createPaymentLink`** (`src/lib/services/payments.ts`): after computing `chargeAmount` (USD whole dollars) + currency, persist `charged_amount_minor = chargeAmount * 100`, `charged_currency = 'USD'` to the payment row. READ the file: it already has the payment id from `api_create_payment`. Use the existing service-role/admin client (or add a tiny RPC `api_record_payment_charge(p jsonb)` SECURITY DEFINER updating the row by id) — prefer whichever matches the file's existing write pattern. If the charge currency could be EUR in future, store the real computed currency, not a hardcode.
- [ ] **Step 3: Mirror** the column adds (and any new RPC) into `supabase/catch-up.sql`; add the columns to the `payments` Row type in `src/lib/supabase/types.ts` (nullable).
- [ ] **Step 4: Test** (`tests/integration/payment-charge.test.ts`): create a booking → `createPaymentLink` → assert the payment row now carries `charged_amount_minor` + `charged_currency`. READ an existing payments integration test for the harness. Run `catch-up-parity` too.
- [ ] **Step 5: Verify + commit** — `npm run typecheck && npx vitest run`.

```bash
git add -A && git commit -m "feat(payments): persist the charged amount + currency for receipts"
```

---

## Task 2: Pure invoice model + VAT-inclusive math

**Files:** Create `src/lib/invoice/model.ts`, `tests/unit/invoice-model.test.ts`.

- [ ] **Step 1: Failing test** `tests/unit/invoice-model.test.ts`. First decide the input shape by reading what `booking_json`/the `Booking` validation type returns (items with `priceLabel`/`quantity`/`pax`/`subtotalEur`, `totalEur`, `currency`, `customerName`/`customerEmail`, `pickupLocation`/`dropoffLocation`, `childSeats`, the transport amount field, the activity title + occurrence date — confirm exact names) and the payment shape (`charged_amount_minor`/`charged_currency` from Task 1, paid date, provider ref). Then test `buildInvoice`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildInvoice } from '@/lib/invoice/model';

const business = {
  legalName: 'Belle Mare Tours Ltd',
  brn: 'C09091906',
  vat: '20529965',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  email: 'hello@x.com',
  phone: '+230...',
};

it('splits a VAT-inclusive total into net + 15% VAT (gross stays exact)', () => {
  const inv = buildInvoice(
    {
      ref: 'BMT-1',
      customerName: 'Jean',
      customerEmail: 'j@x.com',
      currency: 'EUR',
      totalEur: 115,
      activityTitle: 'Boat Trip',
      when: '2026-08-09T06:00:00Z',
      pickupLocation: null,
      dropoffLocation: null,
      childSeats: 0,
      transportEur: 0,
      items: [{ priceLabel: 'Adult', quantity: 1, pax: null, subtotalEur: 115 }],
    },
    {
      chargedAmount: 125,
      chargedCurrency: 'USD',
      paidAt: '2026-06-20T10:00:00Z',
      providerRef: 'pe_123',
    },
    business,
  );
  expect(inv.invoiceNumber).toBe('BMT-1');
  expect(inv.totalGrossEur).toBe(115);
  expect(inv.subtotalNetEur).toBe(100); // 115 / 1.15
  expect(inv.vatAmountEur).toBe(15);
  expect(inv.vatRatePct).toBe(15);
  expect(inv.payment.chargedAmount).toBe(125);
  expect(inv.payment.chargedCurrency).toBe('USD');
});

it('builds a transport line and a child-seat line and the lines sum to the total', () => {
  const inv = buildInvoice(
    {
      ref: 'BMT-2',
      customerName: 'A',
      customerEmail: 'a@x.com',
      currency: 'EUR',
      totalEur: 191,
      activityTitle: 'Tour',
      when: '2026-08-09T06:00:00Z',
      pickupLocation: 'Hotel',
      dropoffLocation: null,
      childSeats: 2,
      transportEur: 30,
      items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 155 }],
    },
    { chargedAmount: 207, chargedCurrency: 'USD' },
    business,
  );
  const sum = inv.lines.reduce((s, l) => s + l.lineGrossEur, 0);
  expect(sum).toBeCloseTo(191, 2);
  expect(inv.lines.some((l) => /transport/i.test(l.description))).toBe(true);
  expect(inv.lines.some((l) => /child seat/i.test(l.description))).toBe(true);
});
```

(Adapt field names to the REAL booking/payment shapes; the child-seat extra = €6 per extra seat — first free — confirm with `childSeatsCost` in `src/lib/services/pricing.ts`.)

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `src/lib/invoice/model.ts`.** Define `InvoiceLine` (`description, quantity, unitGrossEur, lineGrossEur`) and `InvoiceModel` (per the spec). `buildInvoice`: map each `item` → a line (`description = activityTitle + ' — ' + priceLabel`, qty = `pax ?? quantity`, lineGross = `subtotalEur`); append a `Door-to-door transport` line when `transportEur > 0`; append a `Child seats (N)` line when the child-seat extra > 0 (compute via the pricing helper). Assert/trust lines sum to `totalEur` (if a small residual remains from how the total was composed, fold it — but prefer building lines that reconcile exactly). VAT-inclusive: `totalNet = sum(round(lineGross/1.15))` per line to cents; `vatAmount = totalGross − totalNet`; `vatRatePct = 15`. Set `invoiceNumber = ref`, `issuedAt = paidAt ?? now-ISO passed in` (pass any timestamp in — do NOT call `new Date()` in a way tests can't control; accept an `issuedAt` arg or derive from `paidAt`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/invoice/model.ts tests/unit/invoice-model.test.ts && git commit -m "feat(invoice): pure invoice model with VAT-inclusive 15% split"`.

---

## Task 3: PDF renderer (pdf-lib)

**Files:** modify `package.json` (add `pdf-lib`); create `src/lib/invoice/pdf.ts`, `tests/unit/invoice-pdf.test.ts`.

- [ ] **Step 1: Add the dependency** — `npm install pdf-lib`. Confirm it imports in an edge-compatible way (pure ESM/JS; no Node `fs`).
- [ ] **Step 2: Failing smoke test** `tests/unit/invoice-pdf.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { renderInvoicePdf } from '@/lib/invoice/pdf';
import { buildInvoice } from '@/lib/invoice/model';
// ...build a representative InvoiceModel (reuse a fixture like Task 2's multi-line case)...
it('produces a valid non-empty PDF', async () => {
  const bytes = await renderInvoicePdf(model);
  expect(bytes.length).toBeGreaterThan(800);
  // PDF magic header "%PDF"
  expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
});
```

- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement `src/lib/invoice/pdf.ts`** — `export async function renderInvoicePdf(model: InvoiceModel): Promise<Uint8Array>`. Use `PDFDocument.create()`, `StandardFonts.Helvetica`/`HelveticaBold`, an A4 page. Draw, top→bottom: a business header (legalName, address, `BRN: … · VAT: …`, email/phone); a right-aligned "TAX INVOICE / RECEIPT" + `No. {invoiceNumber}` + `Date {issuedAt}`; a customer block (name, email); a trip block (`Booking {ref}`, activity title, `Date {when}`, pickup/dropoff when present); a line-item table (Description | Qty | Amount) iterating `model.lines` with `EUR {lineGrossEur}`; a totals block (`Subtotal (excl. VAT) EUR {subtotalNetEur}`, `VAT 15% EUR {vatAmountEur}`, bold `Total EUR {totalGrossEur}`); a **PAID** stamp/box with `Paid {chargedCurrency} {chargedAmount}` + `on {paidAt}` + `Ref {providerRef}`. Show currency as the code (`EUR`/`USD`), 2 decimals. Keep it single-page; wrap/truncate long text. Return `await pdf.save()`.
- [ ] **Step 5: Run → PASS.** Also run `npm run build` to confirm `pdf-lib` doesn't break the edge bundle of any route that will import it (the drain route). If the build flags an edge-incompat, note it and switch the import to dynamic `await import('pdf-lib')` inside the renderer.
- [ ] **Step 6: Commit** — `git add package.json package-lock.json src/lib/invoice/pdf.ts tests/unit/invoice-pdf.test.ts && git commit -m "feat(invoice): edge-safe PDF renderer via pdf-lib"`.

---

## Task 4: Branded HTML confirmation email template

**Files:** Create `src/lib/email/booking-confirmation.ts`, `tests/unit/booking-confirmation-email.test.ts`.

- [ ] **Step 1: Failing test** asserting `renderConfirmationEmail(model)` returns `{ subject, html, text }` where: `subject` contains the ref; `html` contains the ref, the activity title, the total (`EUR …`), each line description, and the business `legalName`; `text` is a non-empty plain-text fallback (reuse/keep the current plain-text confirmation wording).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `src/lib/email/booking-confirmation.ts`** — `renderConfirmationEmail(model: InvoiceModel): { subject, html, text }`. A simple, robust, inline-styled HTML (email clients need inline CSS; no external CSS/JS): a header with the operator name, "Your booking is confirmed", the booking ref + activity + date, a compact line-item summary + total, a "Your invoice & receipt are attached as a PDF." note, and the support email/phone. `subject = \`Your Belle Mare Tours booking ${model.invoiceNumber} — invoice & receipt\``. Keep `text`as a clean plain-text fallback. ESCAPE any interpolated customer/DB text into the HTML (a tiny`escapeHtml` helper) to avoid broken markup / injection.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add src/lib/email/booking-confirmation.ts tests/unit/booking-confirmation-email.test.ts && git commit -m "feat(email): branded HTML booking-confirmation template"`.

---

## Task 5: Resend provider — HTML + attachments

**Files:** modify `src/lib/notifications/types.ts` (or wherever `NotificationMessage` lives), `src/lib/notifications/resend.ts`; test `tests/unit/resend-provider.test.ts`.

- [ ] **Step 1: Failing test** — mock `fetch`; build a `NotificationMessage` with `html` + an `attachments: [{ filename:'invoice.pdf', content:<base64>, contentType:'application/pdf' }]`; call `ResendNotificationProvider.send(message)`; assert the POSTed JSON body to `https://api.resend.com/emails` includes `html` and `attachments` (with `filename` + `content`). READ the existing resend test/harness.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — extend `NotificationMessage` with optional `html?: string` and `attachments?: { filename: string; content: string; contentType?: string }[]` (content = base64). In `resend.ts` `send()`, include `html` (when present) and `attachments` (mapped to Resend's `{ filename, content }`) in the request body alongside the existing `subject`/`text`. Keep plain-text-only sends working unchanged.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(notifications): Resend provider supports HTML + PDF attachments"`.

---

## Task 6: Wire it into the drain + integration + green gate

**Files:** modify `src/lib/services/notifications.ts` (the drain) + add a booking-loader helper; test `tests/integration/booking-confirmation-email.test.ts`.

- [ ] **Step 1: Booking loader** — add `loadBookingForReceipt(admin, bookingId)` (service-role) that returns the full booking (`booking_json`/`api_get_booking`) + the activity title + occurrence date (join if `booking_json` lacks them) + the payment row (with `charged_amount_minor`/`charged_currency`, paid date, provider ref). READ how the drain currently gets a service-role client + how admin booking reads work.
- [ ] **Step 2: Enrich the drain** — in `drainNotifications`, when `message.template === 'booking_confirmation'`: load the booking (Step 1), `buildInvoice(...)`, `renderConfirmationEmail(model)` → set `message.html`/`message.subject`/`message.text`, and `renderInvoicePdf(model)` → base64 → `message.attachments`. Wrap the PDF render in try/catch: **on PDF failure, send the HTML email WITHOUT the attachment** (log the error). On a booking-load failure, let the send fail (it retries). Other templates unchanged. Pass a controllable `issuedAt` (the payment paid date, or a timestamp the drain has — do not rely on `new Date()` in a way the test can't set; the test can stub).
- [ ] **Step 3: Failing integration test** `tests/integration/booking-confirmation-email.test.ts` — enqueue a `booking_confirmation` for a paid booking, run the drain with a STUB provider that captures the message, assert the captured message has an HTML body containing the ref + total AND one `application/pdf` attachment whose content is valid `%PDF` base64. Add a second case: when `renderInvoicePdf` is made to throw, the message still sends with `html` and NO attachment (marked sent, not failed).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Green gate** — `npm run typecheck && npm run lint && npx vitest run && npm run build` (the build proves `pdf-lib` is OK on the drain's edge route). Report real numbers.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(email): send invoice + receipt PDF on booking confirmation"`.
- [ ] **Step 7: Review** — request a focused review (the VAT math, lines-sum-to-total, the charged-amount accuracy, the PDF-failure resilience, no secret/PII leak in logs, edge-bundle safety).

---

## Self-review (author)

**Spec coverage:** combined Invoice+Receipt PDF (T3) ✓; VAT-inclusive 15% net+VAT+gross (T2) ✓; persist + show actual charged amount (T1 + T2 payment block + T3 PAID stamp) ✓; invoice number = ref (T2) ✓; branded HTML email + PDF attachment (T4 + T5 + T6) ✓; enrich existing flow, no new pipeline (T6 drain) ✓; refund email untouched (only `booking_confirmation` branch changes) ✓; PDF-failure resilience (T6) ✓.

**Type consistency:** `InvoiceModel`/`InvoiceLine` from `@/lib/invoice/model` consumed by `renderInvoicePdf` (T3) and `renderConfirmationEmail` (T4); `NotificationMessage` gains `html`/`attachments` (T5) used by the drain (T6); `charged_amount_minor`/`charged_currency` (T1) flow into the payment block (T2) → PAID stamp (T3).

**Verify-at-execution-time:** the exact `booking_json` / `Booking` field names + the transport/child-seat amount fields (T2/T6 — read the real shapes); how `createPaymentLink` writes the charge (service-role update vs a new RPC — T1); `pdf-lib` edge-bundle compatibility on the drain route (T3 Step 5 / T6 build); whether `booking_json` already carries the activity title + occurrence date or needs a join (T6 Step 1).
