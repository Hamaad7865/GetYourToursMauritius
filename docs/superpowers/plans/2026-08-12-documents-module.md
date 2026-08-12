# Documents Module Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use `- [ ]`. Spec:
> `docs/superpowers/specs/2026-08-12-documents-module-design.md`. This repo's convention (see
> `2026-08-12-per-line-transport-addon.md`) is phase-gated checklists — each phase gate is "affected
> suites + typecheck green", not necessarily a git commit (commits happen when the owner asks).

**Goal:** A staff-only Documents module that creates, numbers, stores and renders standalone quotes,
invoices, proformas and receipts for any client, in MUR / EUR / USD, paid offline or unpaid — filling
the gap the online-booking-only invoice pipeline can't (the GLOBALAND case).

**Architecture:** A self-contained island. Two tables (`documents`, `document_clients`) + a
`document_counters` numbering table, all staff-RLS. A pure `buildDocument` model is the single source
of truth; `renderDocumentPdf` and a React `DocumentPreview` are two thin views of it. No contact with
`bookings`/`payments`/Peach. Reuses the pdf-lib helpers already exported from `src/lib/invoice/pdf.ts`.

**Tech stack:** Next.js/React (edge), Supabase Postgres (SECURITY DEFINER RPCs + RLS), pdf-lib, Zod,
vitest/PGlite. Money in integer **minor units** (MUR/EUR/USD all exponent-2).

---

## Phase 1 — Schema, numbering, money model, PDF renderer (headless)

**Files:** Create `supabase/migrations/20260927000000_documents_module.sql`,
`src/lib/documents/money.ts`, `src/lib/documents/model.ts`, `src/lib/documents/pdf.ts`,
`app/api/v1/admin/documents/[id]/pdf/route.ts`; modify `supabase/catch-up.sql`, `supabase/setup.sql`
(regen via `npm run setup:sql`), `supabase/backfill-migration-ledger.sql`; test
`tests/unit/document-money.test.ts`, `tests/unit/document-model.test.ts`,
`tests/unit/document-pdf.test.ts`, `tests/integration/documents-schema.test.ts`.

### 1a. Migration — tables + RLS

- [ ] `document_clients(id uuid pk default gen_random_uuid(), name text not null, email text, phone text,
street text, locality text, region text, country text, brn text, vat text, created_by uuid, created_at
timestamptz default now(), updated_at timestamptz default now())`. Enable RLS; policies
      `for all using (is_staff()) with check (is_staff())`. Grant to `authenticated`; revoke from `anon`
      (see the definer-grant-leak landmine — revoke from PUBLIC **and** anon).
- [ ] `documents(...)` exactly the columns in spec §1 (type/status/currency CHECKs as written;
      `lines jsonb not null default '[]'`; `client_snapshot`/`issuer_snapshot jsonb`; `*_minor bigint`;
      dates; notes; `source_document_id uuid references documents(id)`; audit cols). Enable RLS,
      staff-only policies, same grants.
- [ ] `document_counters(doc_type text, year int, next_val int not null default 0, primary key
(doc_type, year))`. RLS on; no direct policies (only the definer RPC touches it).
- [ ] Indexes: `documents(type, status)`, `documents(created_at desc)`, `documents(number)`.

### 1b. Migration — RPCs (SECURITY DEFINER, `set search_path = public`)

- [ ] `allocate_document_number(p_type text, p_year int) returns text`: `insert into document_counters
as c (doc_type, year, next_val) values (p_type, p_year, 1) on conflict (doc_type, year) do update
set next_val = c.next_val + 1 returning next_val` → format `PREFIX-YYYY-####` where PREFIX =
      `case p_type when 'quote' then 'QUO' when 'invoice' then 'INV' when 'proforma' then 'PRO' when
'receipt' then 'RCT' end`, seq `lpad(next_val::text, 4, '0')`. Guard `is_staff()` first (raise
      insufficient_privilege otherwise).
- [ ] `issue_document(p_id uuid, p_issuer jsonb) returns documents`: guard `is_staff()`; select the row
      `for update`; refuse if `status <> 'draft'`; allocate a number via `allocate_document_number(type,
extract(year from coalesce(issue_date, current_date)))`; set `number`, `issuer_snapshot = p_issuer`,
      `status = case type when 'receipt' then 'issued' when 'quote' then 'issued' else 'issued' end`,
      `updated_at = now()`; return the row. (Snapshots of the CLIENT are already frozen on save;
      issuer is frozen here.)
- [ ] `convert_document(p_id uuid) returns documents`: guard `is_staff()`; load the source (must be a
      `quote`); insert a new `invoice` draft copying `currency, client_id, client_snapshot, lines,
vat_mode, vat_rate_pct, notes`, `source_document_id = p_id`, `status='draft'`; set source
      `status='converted'`; return the NEW row.
- [ ] `void_document(p_id uuid) returns documents`: guard `is_staff()`; refuse if `status='draft'`
      (drafts are deleted, not voided); set `status='void'`; return the row.
- [ ] Mirror the whole migration into `supabase/catch-up.sql` (comment-stripped, last-def-wins), run
      `npm run setup:sql`, append `('20260927000000','documents_module')` to
      `supabase/backfill-migration-ledger.sql`.
- [ ] Gate: `documents-schema`, `migration-ledger`, `setup-sql-parity`, `catch-up-parity`,
      `resolved-function-bodies` green.

### 1c. `src/lib/documents/money.ts`

- [ ] `export type Currency = 'MUR' | 'EUR' | 'USD'`; `CURRENCY_SYMBOL: Record<Currency,string>` =
      `{ MUR: 'Rs', EUR: 'EUR', USD: 'US$' }` (all WinAnsi-safe).
- [ ] `parseAmountToMinor(text: string): number` — trims, strips grouping commas/spaces, rejects
      non-numeric, `Math.round(value * 100)`; throws on NaN/negative/unsafe-integer (mirror the guards in
      `quotes/totals.ts`).
- [ ] `minorToMajor(minor: number): number` = `minor / 100`; `formatMinor(minor)` = 2-dp grouped string
      (reuse the shape of `formatGrouped`).
- [ ] Tests (`document-money.test.ts`): parse "58,000" → 5800000; "58000.5" → 5800050; "" / "x" / "-1"
      throw; round-trip minor↔major.

### 1d. `src/lib/documents/model.ts` — `buildDocument` (pure)

- [ ] Types: `DocumentType = 'quote'|'invoice'|'proforma'|'receipt'`; `VatMode =
'inclusive'|'exclusive'|'none'`; `DocumentLineInput { description: string; qty: number; unitMinor:
number }`; `DocumentInput { type; number; currency; issuerSnapshot; clientSnapshot; lines;
vatMode; vatRatePct; issueDate; dueDate?; validUntil?; notes?; amountPaidMinor?; paymentMethod?;
paymentRef?; paidAt? }`; `DocumentModel { title; number; currency; symbol; issuer; client; lines:
Array<{ description; qty; unitMinor; lineMinor }>; subtotalNetMinor; vatMinor; vatRatePct;
totalMinor; amountPaidMinor; amountDueMinor; isPaid; showVat; issueDate; dueLabel? }`.
- [ ] `buildDocument(input): DocumentModel` — no `Date.now()`/`new Date()`. Per line `lineMinor =
round(qty * unitMinor)` (qty is integer count; unit already minor). VAT by mode (spec §3): inclusive
      → `net = Σ round(lineMinor / (1+r))`, `vat = total − net`; exclusive → `net = Σ lineMinor`, `vat =
round(net * r)`, `total = net + vat`; none → `net = total`, `vat = 0`, `showVat=false`.
      `isPaid = type==='receipt' || (amountPaidMinor ?? 0) >= totalMinor`. `amountDueMinor = max(0,
total − amountPaid)`. `title`/`dueLabel` from type table (spec §4).
- [ ] Tests (`document-model.test.ts`): inclusive Rs 58,000 → net 5043478, vat 756522, total 5800000
      (the GLOBALAND figures ×100); exclusive 100.00 → net 10000, vat 1500, total 11500; none → no vat;
      receipt is paid, dueMinor 0; multi-line reconciles (Σ lineMinor == subtotal+vat under inclusive).

### 1e. `src/lib/documents/pdf.ts` — `renderDocumentPdf`

- [ ] `renderDocumentPdf(model: DocumentModel): Promise<Uint8Array>` — pdf-lib, A4, importing
      `toWinAnsi, formatGrouped, wrapText, fitText` from `@/lib/invoice/pdf`. Header = issuer block
      (legalName/address/BRN/VAT/contact) left, title + number + issue date right. BILL TO = client
      snapshot (name + address + BRN/VAT if present). Wrapped line table (qty/amount right-aligned).
      Totals: Subtotal (excl. VAT) + `VAT r%` only when `showVat`; Total; then either an `Amount Due`
      line (unpaid) or a PAID box (receipt / fully-paid invoice) with method/ref. Currency prefix =
      `model.symbol`. Footer "Thank you for choosing <issuer.legalName>." Set PDF metadata (title/author),
      `useObjectStreams: false` (the AV-false-positive note in invoice/pdf.ts).
- [ ] Tests (`document-pdf.test.ts`): returns non-empty bytes starting `%PDF` for each of the 4 types;
      an accented client name and a `Rs` currency don't throw.

### 1f. PDF route

- [ ] `app/api/v1/admin/documents/[id]/pdf/route.ts` (`runtime = 'edge'`): `requireUser`; load the doc
      by id via a **staff service context** (RLS already limits to staff); 404 if missing; `buildDocument`
      from the stored row (issuer from `issuer_snapshot` or `INVOICE_BUSINESS` if still a draft) →
      `renderDocumentPdf` → `application/pdf` attachment named `<type>-<number|draft>.pdf`. `OPTIONS`
      preflight like the booking invoice route.
- [ ] Gate: `document-money`, `document-model`, `document-pdf` green; typecheck.

## Phase 2 — Admin UI for invoices (list + editor + preview)

**Files:** Create `app/(site)/admin/documents/page.tsx`, `src/components/admin/AdminDocuments.tsx`,
`src/components/admin/documents/state.ts`, `.../ClientPane.tsx`, `.../LinesEditor.tsx`,
`.../DetailsPane.tsx`, `.../DocumentPreview.tsx`, `src/lib/admin/documents.ts`; modify
`src/components/admin/nav.ts`; test `tests/unit/admin-documents-editor.test.ts`, update
`tests/unit/admin-quotes-editor.test.ts` (nav).

- [ ] `src/lib/admin/documents.ts`: `loadDocuments()`, `loadDocument(id)`, `saveDocument(input)` (insert
      draft / update draft; freezes `client_snapshot` from the form), `issueDocument(id)` (RPC),
      `convertDocument(id)` (RPC), `voidDocument(id)` (RPC), `deleteDraft(id)`, plus `loadClients()`,
      `upsertClient(input)`. Follow the PostgREST/RPC call style in `src/lib/admin/quotes.ts`;
      minor↔form via `money.ts`. Refusals surfaced through the existing `refusalMessage` idiom.
- [ ] `documents/state.ts`: `DocumentFormValues` (type, currency, vatMode, client fields, `lines:
DocumentLineDraft[]` with text amounts, dates, notes, payment fields); `emptyDocumentForm(type)`,
      `formFromDocument(row)`, `documentInputFromForm(form)` (parses amounts via `parseAmountToMinor`,
      drops payment on non-receipt/unpaid), `formTotalMinor(form)` (reuses `buildDocument`).
- [ ] `AdminDocuments.tsx`: list (type + status filters, search number/client, columns Number/Type/
      Client/Total/Status/Date) + editor (rail: Client · Lines · Details · Preview & issue), same
      two-screens-in-one-component shape as `AdminQuotes`. Staff-gate copy for non-staff (mirror
      AdminQuotes' `isStaff` guard).
- [ ] `ClientPane.tsx` (pick saved client via a searchable list + "remember this client" checkbox),
      `LinesEditor.tsx` (description/qty/unit rows, add/remove, currency + VAT-mode selectors, live
      totals), `DetailsPane.tsx` (issue date, due/valid-until, notes, internal notes, payment info shown
      only for receipt or an invoice marked paid), `DocumentPreview.tsx` (renders `buildDocument(form)`
      as styled JSX — the live view; "Download PDF" links to the `/pdf` route; Issue/Convert/Void
      buttons).
- [ ] `page.tsx` → `<AdminDocuments/>` (`runtime='edge'`). Add `{ href: '/admin/documents', label:
'Documents', icon: IconDocument }` to `ADMIN_NAV` (after Quotes; NOT `seo`-flagged).
- [ ] Update the nav dead-link/role test in `admin-quotes-editor.test.ts` to include `/admin/documents`.
- [ ] Tests (`admin-documents-editor.test.ts`): `documentInputFromForm` parses amounts and drops payment
      on an unpaid invoice; `formFromDocument`∘`documentInputFromForm` round-trips; `formTotalMinor`
      reflects VAT mode; the nav entry resolves to the real route.
- [ ] Gate: `admin-documents-editor`, `admin-quotes-editor` green; typecheck; eslint.

## Phase 3 — Remaining types + conversion

- [ ] Wire the "New document" action to a type picker (quote / invoice / proforma / receipt) seeding
      `emptyDocumentForm(type)`. Type-specific fields: quote shows `validUntil`; invoice/proforma show
      `dueDate`; receipt shows payment method/ref + `paidAt` and is created already paid.
- [ ] `DocumentPreview`/`pdf.ts` already branch on type (Phase 1e) — verify each renders correctly.
- [ ] "Convert to invoice" on an issued quote calls `convertDocument` and opens the new invoice draft
      (same `onOpen` remount trick AdminQuotes uses for Duplicate).
- [ ] Tests: extend `admin-documents-editor` — a receipt form carries payment + is paid; convert emits
      an invoice draft linked to the quote. Integration (`documents-schema`): `convert_document` marks the
      quote `converted` and clones lines; `void_document` refuses a draft.
- [ ] Gate: documents suites green; typecheck.

## Phase 4 — Saved clients (self-building list)

- [ ] `ClientPane`: on save with "remember this client" ticked, `upsertClient` persists it; the picker
      lists saved clients and auto-fills the bill-to on select. Editing bill-to fields after issue does
      NOT change the issued doc (snapshot already frozen — assert in a test).
- [ ] Tests: `upsertClient` then `loadClients` returns it; selecting a client fills the form; snapshot
      immutability (issue, then change the client row, re-`buildDocument` from the stored snapshot →
      unchanged) in `documents-schema`.
- [ ] Gate: documents suites green.

## Phase 5 — Email delivery

**Files:** Create `src/lib/email/document.ts`; modify `src/lib/admin/documents.ts` (a `emailDocument`
action) + a small `app/api/v1/admin/documents/[id]/email/route.ts`; test
`tests/unit/document-email.test.ts`.

- [ ] `document.ts`: build the subject/body (covering note + the doc summary) and attach the rendered
      PDF; send via the existing Resend provider (`src/lib/notifications/resend.ts`) — confirm it
      supports attachments; if not, add a minimal attachment path. From/Reply-To identical to the other
      transactional mail.
- [ ] Route: `POST .../[id]/email` — `requireUser` (staff), render + send, return `{ emailed: boolean }`.
      The editor's "Email to client" button calls it (operator-initiated send).
- [ ] Tests: the email carries the PDF attachment and the right subject; a doc with no client email is
      refused with a clear message.
- [ ] Gate: `document-email` green; typecheck.

## Phase 6 — Polish + full verification

- [ ] Full `npx vitest run` green; `npm run typecheck`, `npm run lint`, `npm run format:check` clean
      (`.mcp.json` CRLF is the known local-only false red — leave it).
- [ ] Manual smoke via the dev server: create an MUR invoice for "GLOBALAND (PTY) LTD" (Rs 58,000,
      inclusive) → preview matches the earlier one-off → Issue allocates `INV-2026-####` → Download PDF.
- [ ] Memory: add a `gytm-documents-module.md` note (island; no ledger link; numbering at issue;
      void-not-delete; snapshots frozen at issue) + index line.
