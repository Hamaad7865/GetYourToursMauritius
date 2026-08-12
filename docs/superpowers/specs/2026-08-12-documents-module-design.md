# Documents module — quote / invoice / proforma / receipt generator

**Date:** 2026-08-12
**Status:** approved (design)

## Problem

The business needs to bill parties that never go through the online booking flow — corporate and
local clients invoiced in Rupees, unpaid invoices sent for payment, receipts for money taken by bank
transfer or cash. The existing machinery cannot do this:

- `/admin/quotes` drafts an **offer that converts into a booking**, is **EUR-only** (the payment
  ledger is EUR-only), and its invoice appears **only after an online payment**
  (`/api/v1/bookings/[ref]/invoice` is gated on `paymentState === 'paid'`).
- The one real case that exposed the gap — **GLOBALAND (PTY) LTD**, a private full-day catamaran
  cruise billed at Rs 58,000 — had to be produced by a throwaway script, with no record, no number
  and no way to reprint.

There is no admin surface to create a standalone, numbered document for an arbitrary client, in an
arbitrary currency, paid offline or not yet paid.

## Decision

Build a **new, self-contained Documents module** — its own tables, its own pure model + renderers
under `src/lib/documents/`, its own `/admin/documents` screen. It is an **island**: it does not
touch the Peach payment ledger, `bookings`, or the existing Quotes→booking flow (all load-bearing and
heavily tested). Documents are manual/offline artifacts.

Resolved options:

- **Scope:** a saved, numbered library (not a stateless generator).
- **Types:** quote, invoice, proforma invoice, receipt.
- **Currencies:** MUR (`Rs`), EUR, USD — each document is single-currency.
- **VAT:** per-document mode (`inclusive` / `exclusive` / `none`), defaulting to inclusive.
- **Clients:** a self-building saved-client list (free-type with "remember this client").
- **Numbering:** allocated at **Issue**; drafts stay unnumbered so an abandoned draft never burns a
  number. A numbered document is **voided, never deleted**, so the sequence stays gapless.
- **Delivery:** download PDF, plus email-to-client (reusing Resend) as the final phase.

## Boundary with the existing Quotes module

They stay separate, and the UI makes the distinction legible:

- **Quotes** (existing): _offer a guest something bookable; they pay online._ EUR-only; converts to a
  booking.
- **Documents** (new): _bill anyone for anything, any currency, paid offline or unpaid._ Never
  converts to a booking; produces PDFs.

## Design

### 1. Data model — two new tables

**`document_clients`** — the self-building bill-to list:

- `id uuid pk`, `name text not null`, `email text`, `phone text`,
- `street text`, `locality text`, `region text`, `country text`,
- `brn text`, `vat text`,
- `created_by uuid`, `created_at`, `updated_at`.
- RLS: staff/admin only (`is_staff()`), same boundary as quotes.

**`documents`** — one row = one document = one immutable snapshot once issued:

- `id uuid pk`
- `type text check (type in ('quote','invoice','proforma','receipt'))`
- `number text` — null until issued (e.g. `INV-2026-0007`)
- `status text check (status in ('draft','issued','accepted','declined','expired','paid','part_paid','void','converted'))`
- `currency text check (currency in ('MUR','EUR','USD'))`
- `client_id uuid null references document_clients(id)` — provenance only
- `client_snapshot jsonb not null` — frozen bill-to (name/address/brn/vat/email)
- `issuer_snapshot jsonb not null` — frozen issuer identity (INVOICE_BUSINESS at issue time)
- `lines jsonb not null` — `[{ description, qty, unit_minor }]`
- `vat_mode text check (vat_mode in ('inclusive','exclusive','none'))`, `vat_rate_pct int default 15`
- `subtotal_net_minor bigint`, `vat_minor bigint`, `total_minor bigint` — stored for the list;
  the renderer recomputes from `lines` so the PDF is never wrong even if a stored total drifts
- `amount_paid_minor bigint default 0`, `payment_method text`, `payment_ref text`, `paid_at timestamptz`
  — manual settlement, **not** the Peach ledger
- `issue_date date`, `due_date date` (invoice/proforma), `valid_until date` (quote)
- `notes text` (client-facing), `internal_notes text` (never rendered)
- `source_document_id uuid null references documents(id)` — quote→invoice link
- `created_by uuid`, `created_at`, `updated_at`
- RLS: staff/admin only.

Money is in **minor units** throughout; MUR/EUR/USD are all ISO exponent-2, so conversion is a
uniform `/100`. `client_snapshot`/`issuer_snapshot` are frozen at issue exactly as booking supplement
snapshots are, so a reprint is stable if the client record or the business address later changes.

### 2. Numbering

A `document_counters(doc_type text, year int, next_val int, primary key (doc_type, year))` table and a
`SECURITY DEFINER` RPC `allocate_document_number(p_type, p_year)` that atomically upserts-and-increments
the counter row and returns the formatted number. Prefixes: `QUO`, `INV`, `PRO`, `RCT`; format
`PREFIX-YYYY-####` (4-digit zero-padded, per type, per year). The number is allocated once, at Issue.

### 3. Money & VAT — one pure builder

`buildDocument(input): DocumentModel` — pure, no I/O, no `Date.now()`/`new Date()` (the caller supplies
the issue date), mirroring `buildInvoice`. Per-line and total computation by mode:

- **inclusive:** `net = round(gross / 1.15)` per line, summed; `vat = total − net`.
- **exclusive:** typed amount is `net`; `vat = round(net × 0.15)`; `total = net + vat`.
- **none:** `net = total`; `vat = 0`; no VAT line rendered.

The model also derives the document chrome inputs: title, whether a PAID stamp shows (receipt, or an
invoice with `amount_paid_minor >= total_minor`), and the amount-due figure.

### 4. Rendering — one model, two views

`buildDocument` is the single source of truth; two thin renderers consume its output so the numbers can
never drift between them:

- **`renderDocumentHtml(model)`** — a live in-editor preview that updates as the operator types.
- **`renderDocumentPdf(model)`** — the artifact, via pdf-lib (edge-safe), reusing the helpers already
  exported from `src/lib/invoice/pdf.ts` (`toWinAnsi`, `formatGrouped`, `wrapText`, `fitText`).

Type drives the chrome:

| type     | title            | footer emphasis                    |
| -------- | ---------------- | ---------------------------------- |
| quote    | QUOTATION        | "Valid until <date>"               |
| invoice  | TAX INVOICE      | "Amount Due" (or PAID stamp)       |
| proforma | PROFORMA INVOICE | "Amount Due" (no VAT-reclaim copy) |
| receipt  | RECEIPT          | PAID stamp + method/ref            |

Currency is shown as `Rs` (MUR), `EUR`, or `US$` — all WinAnsi-safe. Amounts use `formatGrouped`.

### 5. Lifecycle

- **quote:** `draft` → **Issue** → `accepted` / `declined` / `expired` → `converted` (to an invoice)
- **proforma:** `draft` → **Issue** → `paid` → `void`
- **invoice:** `draft` → **Issue** → `paid` / `part_paid` → `void`
- **receipt:** created `issued` (proof of payment; carries the PAID stamp), or minted from a paid invoice

Drafts (unnumbered) may be deleted. Once issued, a document is **voided, not deleted**.
**Quote → Invoice** is one click: an RPC clones the client/lines/currency/VAT into a new invoice draft,
sets the quote `converted`, and links `source_document_id`.

### 6. API surface

Admin data access follows the existing `src/lib/admin/*.ts` pattern.

- `GET/POST` documents + clients through staff-RLS table access (list, load, save-draft).
- RPCs (`SECURITY DEFINER`) for the operations that must be atomic or cross-cutting:
  `allocate_document_number`, `issue_document` (allocate number + freeze snapshots + set status),
  `convert_document` (quote→invoice), `void_document`.
- `GET /api/v1/admin/documents/[id]/pdf` — staff-gated, on-demand render from the stored row;
  `content-type: application/pdf`.

### 7. UI — `/admin/documents`

Mirrors the proven Quotes shape: a **list** (filter by type + status, search number/client; columns
Number, Type, Client, Total, Status, Date) and an **editor** laid out as a section rail plus one pane:

- **Client** — pick a saved client or free-type; "remember this client" persists it.
- **Lines** — description / qty / unit; live running totals; currency + VAT-mode selectors.
- **Details** — issue date, due/valid-until, client-facing note, internal note, payment info.
- **Preview & issue** — live HTML preview; Issue; Download PDF; Email to client; Convert to invoice.

Reuses the admin UI kit (`Card`, `AdminHeading`, `Field`, `INPUT_CLS`, `BTN_*`). A `Documents` entry is
added to `src/components/admin/nav.ts` (staff-only, not `seo`-flagged), using the existing
`IconDocument`. Money is typed as text and parsed once to minor units (a currency-agnostic
`parseAmountToMinor`, since all three currencies are exponent-2).

### 8. Delivery

- **Download PDF** — the `GET .../pdf` route.
- **Email to client** — reuses the Resend infrastructure; the operator clicks Send, which attaches the
  PDF and a short covering note. Built last so the rest ships without waiting on it.

## Out of scope (non-goals)

- No link to the Peach payment ledger; no reconciliation with `payments`/`bookings`.
- No booking conversion (that is what the existing Quotes module is for).
- No public/guest-facing document pages — staff-only, download-and-send.
- No recurring invoices, no multi-currency FX conversion (each document is single-currency), no
  credit notes (a `void` is the escape hatch for v1).

## Testing

- `buildDocument` unit tests: every VAT mode × every currency; per-line rounding; lines reconcile to
  the stored totals; PAID/Amount-Due derivation by type.
- Numbering: concurrent `allocate_document_number` calls never collide or skip (integration/PGlite).
- Snapshot immutability: issuing freezes client + issuer; editing the client record afterwards does not
  change an issued document.
- Conversion: quote→invoice clones lines and marks the quote `converted`.
- PDF smoke: `renderDocumentPdf` returns bytes for each type; encoding-safe for `Rs`/accented client
  names.
- Nav: the new entry points at a real route and is invisible to the `seo` role
  (extends the existing dead-link/role test).
- Schema/parity: `catch-up-parity`, `setup-sql-parity`, migration ledger, and (for the RPCs)
  `resolved-function-bodies`.

## Rollout — phases

1. **Schema + numbering + money model + PDF renderer** (headless, fully tested): migrations, both new
   tables + counters, `allocate_document_number`, `buildDocument`, `renderDocumentPdf`, the `/pdf` route.
2. **Admin UI for invoices** — list + editor + live preview, MUR/EUR/USD, VAT modes, Issue + Download;
   nav entry.
3. **Remaining types** — quotes, proforma, receipts + the Quote→Invoice conversion.
4. **Saved clients** — the client list, pick + save-on-the-fly.
5. **Email delivery** — the Resend attachment path.
6. **Polish + full verification** — full `vitest run`, typecheck, eslint, prettier; parity suites.
