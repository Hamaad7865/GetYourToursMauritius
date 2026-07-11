# Invoice + Receipt Email — Design

> Brainstormed 2026-06-20. When a booking is paid (status → confirmed), email the customer a branded
> confirmation with a combined **Tax Invoice / Receipt PDF** attached. Enriches the EXISTING
> `booking_confirmation` notification flow — no new pipeline.

## Locked decisions

1. **One combined Invoice + Receipt PDF** (business header + BRN/VAT, itemized lines, VAT breakdown, total,
   a "PAID" stamp with payment date + ref), attached to a branded HTML email.
2. **VAT-inclusive 15%**: displayed prices already include VAT. Each line: `net = gross ÷ 1.15`,
   `vat = gross − net`. The invoice shows subtotal-net + 15% VAT + total-gross. Total-gross == the booking total.
3. **Persist the actual charged amount + currency** (the card is charged in USD while the ledger is EUR) so
   the receipt matches the customer's card statement; future-proof if Peach enables EUR.
4. **Invoice number = the booking ref** (`BMT-xxx`, unique per booking). Strict sequential VAT numbering is a
   possible later enhancement, not in scope.
5. **In scope:** the paid `booking_confirmation`. **Out:** turning the refund email into a credit note (stays plain).

## What already exists (reuse, don't rebuild)

- DB trigger `enqueue_booking_notification` enqueues a `booking_confirmation` outbox row on status → confirmed.
- Cron → `POST /api/v1/internal/notifications/drain` → `drainNotifications` claims rows + calls
  `provider.send()`. Resend provider currently sends `{ from, to, subject, text }` (plain text only).
- `booking_json` / `api_get_booking` returns booking + items; business identity is in `src/lib/seo/site.ts`
  (`legalName`, `brn`, `vat`, address, email, phone). The charged USD amount is computed in
  `createPaymentLink` (`src/lib/services/payments.ts`) but NOT persisted.

## Architecture

On drain, for a `booking_confirmation`: fetch the full booking (service-role) + its payment → `buildInvoice`
→ render HTML email + PDF → `provider.send({ html, text, attachments:[invoice.pdf] })`. Everything is
edge-safe (`pdf-lib` is pure JS; no headless browser).

### Components (small, isolated)

- **`payments.charged_amount_minor` + `charged_currency`** (DB columns, nullable). Written in
  `createPaymentLink` when the charge is computed. Migration + `catch-up.sql` mirror + generated types.
- **`src/lib/invoice/model.ts` — `buildInvoice(booking, payment, business): InvoiceModel`** (pure). Lines =
  booking_items + a "Door-to-door transport" line (when transport > 0) + a "Child seats" line (when the
  child-seat extra > 0); lines MUST sum to the booking total. VAT-inclusive split (per-line net rounded to
  cents; `vatAmount = totalGross − totalNet` so gross stays exact). Carries business identity, customer,
  trip block (ref, activity title, date, pickup/dropoff), and the payment block (charged amount/currency,
  paid date, Peach ref).
- **`src/lib/invoice/pdf.ts` — `renderInvoicePdf(model): Uint8Array`** (`pdf-lib`, `StandardFonts.Helvetica`,
  currency shown as `EUR`/`USD` codes). Layout: header → "TAX INVOICE / RECEIPT" + number/date → customer +
  trip → line-item table → VAT breakdown → "PAID" stamp + payment line.
- **`src/lib/email/booking-confirmation.ts` — `renderConfirmationEmail(model): { subject, html, text }`**:
  branded HTML (confirmation + trip summary + "invoice & receipt attached" + support contact) + plain-text
  fallback (keeps the current text as the fallback).
- **`NotificationMessage` + `ResendNotificationProvider`**: add optional `html?: string` and
  `attachments?: { filename, content (base64), contentType }[]`; the Resend `send()` passes `html` +
  `attachments` to the API (it supports both).
- **`drainNotifications` enrichment**: for `booking_confirmation`, fetch booking + payment (a service helper
  `loadBookingForReceipt(bookingId)` using the service-role client → `booking_json` + the payment row), build
  - render, and send the rich message. Other templates unchanged.

## Data flow

paid → `confirmed` → trigger enqueues outbox → cron `/drain` → claim → fetch booking + payment →
`buildInvoice` → `renderConfirmationEmail` + `renderInvoicePdf` → `provider.send` → `mark_notification('sent')`.

## Error handling

Per-message try/catch already retries (max 5 attempts). Added: **if `renderInvoicePdf` throws, still send the
HTML email without the attachment** (log the PDF error) — the confirmation must go out; the PDF is
best-effort. If the booking fetch fails, the send fails and retries (don't mark sent).

## Testing

- Unit: `buildInvoice` VAT-inclusive math + rounding + multi-line sums (items + transport + child seats sum
  to total); charged-amount display; invoice number = ref.
- PDF: `renderInvoicePdf` returns valid `%PDF` bytes and renders without throwing for a representative
  booking (multi-line incl. vehicle/transport/child-seat).
- HTML: `renderConfirmationEmail` contains ref, total, line items, business name/BRN.
- Provider: Resend `send()` payload includes `html` + `attachments` (mocked fetch).
- Integration: draining a `booking_confirmation` makes the stub provider receive an HTML body + a PDF
  attachment; a thrown PDF render still sends the HTML.

## Owner config / dependencies (unchanged + new)

- Still gated on `RESEND_API_KEY` + `RESEND_FROM` set and the cron enabled (bug-sweep items) for ANY email to send.
- New DB columns → **re-run `supabase/catch-up.sql`** on the live DB.
- New dependency `pdf-lib` (pure JS, edge-safe; verify it fits the drain route's edge bundle at build).
