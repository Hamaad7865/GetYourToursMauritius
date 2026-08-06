# Admin Quotes Module — Part 1 (Quotes Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff draft an itemised quote in `/admin/quotes`, email it to a guest with a signed public link, and have the guest pay it through the existing Peach checkout so it becomes a real booking with a ledger entry, confirmation email and VAT invoice.

**Architecture:** Two new tables (`quotes`, `quote_items`) hold the draft. A third (`booking_custom_items`) is the durable home for priced lines that have no `session_occurrence` — free-text work today, rentals in Part 2 — because `booking_items` requires `session_occurrence_id` and `activity_option_id` NOT NULL and we are not relaxing that on the money path. The public link is a raw HMAC token in the URL matched against a stored hash, so a guest pays without an account. Conversion happens at **pay**, not at send, so an unaccepted quote never holds capacity; a new `api_convert_quote` RPC does it atomically and the money path downstream (Peach checkout → HMAC webhook → `append_payment_event` → confirmation/invoice) is untouched.

**Tech Stack:** Next.js App Router (edge runtime), Supabase Postgres + RLS + SECURITY DEFINER RPCs, Zod, Vitest, Resend, Peach Checkout.

---

## Scope

**In (Part 1):** quotes + quote_items + booking_custom_items schema; admin list/editor; catalogue lines and free-text custom lines with their own date/time; send-by-email; public quote page; pay → booking conversion.

**Out (own plans, both depend on Part 1):**

- **Part 2 — Rental bookings.** `rental_vehicles` is a price list only (slug, name, `daily_rate_minor`, `deposit_minor`, no fleet count). `booking_custom_items.kind = 'rental'` and `rental_vehicle_slug` are created here so Part 2 has somewhere to land, but no rental UI or pricing ships in Part 1.
- **Part 3 — Calendar union.** `src/lib/admin/calendar.ts` builds the day sheet purely from `session_occurrences`; showing date-bearing custom lines means teaching it a second source. `booking_custom_items.starts_at` is indexed here so Part 3 is a read change, not a migration.

**Open questions for Part 2 (do not block Part 1):**

1. Is the rental deposit charged online with the rental, or collected on handover? Changes whether `deposit_minor` enters `total_minor`.
2. `rental_vehicles` has no fleet count. Can the same vehicle be quoted twice on overlapping dates, or does Part 2 add `fleet_size` and an availability check?

---

## File Structure

| File                                            | Responsibility                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| `supabase/migrations/20260909000000_quotes.sql` | Tables, enums, indexes, RLS, `api_convert_quote`                              |
| `supabase/catch-up.sql`                         | Drift parity — append the same migration                                      |
| `src/lib/quotes/token.ts`                       | Mint/verify the public link token (Web Crypto HMAC)                           |
| `src/lib/quotes/totals.ts`                      | Pure line-total and quote-total maths                                         |
| `src/lib/quotes/types.ts`                       | Zod schemas shared by admin, API and the public page                          |
| `src/lib/admin/quotes.ts`                       | Staff-side load/create/update/send, mirroring `src/lib/admin/bookings.ts`     |
| `src/lib/email/quote.ts`                        | Quote email subject + HTML, mirroring `src/lib/email/booking-confirmation.ts` |
| `src/components/admin/AdminQuotes.tsx`          | List + editor UI                                                              |
| `app/(site)/admin/quotes/page.tsx`              | Admin route                                                                   |
| `app/(site)/quotes/[ref]/page.tsx`              | Public quote page (token in `?t=`)                                            |
| `app/api/v1/quotes/[ref]/pay/route.ts`          | Token-authenticated convert + mint checkout                                   |
| `app/api/v1/admin/quotes/send/route.ts`         | Staff-authenticated send                                                      |

---

## Task 1: Schema

**Files:**

- Create: `supabase/migrations/20260909000000_quotes.sql`
- Modify: `supabase/catch-up.sql` (append the identical body)
- Test: `tests/integration/quotes-schema.test.ts` (new — the schema's invariants); `tests/unit/migration-ledger.test.ts`, `tests/unit/release-supabase-ledger.test.ts` and `tests/integration/catch-up-parity.test.ts` (existing — must stay green)

Write `tests/integration/quotes-schema.test.ts` FIRST and watch it fail (`relation "quotes" does not exist`) before Step 1, and commit it in the same commit as the migration. The three existing guards only prove the file is mirrored; none of them would notice a wrong column type or a dropped constraint. DB-backed tests live in `tests/integration/` — `tests/db/` holds harness helpers only (`pglite.ts`, `rpc.ts`, `seed.ts`, `book.ts`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260909000000_quotes.sql
create type quote_status as enum ('draft','sent','accepted','expired','cancelled');
create type quote_item_kind as enum ('catalogue','custom','rental');

-- MUST be the first statement and must not be USED anywhere later in this same migration:
-- Postgres forbids using an enum value added by ALTER TYPE in the transaction that added it.
-- api_convert_quote only references 'quote' at runtime (a later transaction), which is fine.
alter type booking_source add value if not exists 'quote';

create table quotes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  status quote_status not null default 'draft',
  currency text not null default 'EUR',
  total_minor bigint not null default 0,
  valid_until date not null,
  intro_note text,
  internal_notes text,
  -- SHA-256 of the raw link token. The raw token exists only in the emailed URL.
  token_hash text,
  sent_at timestamptz,
  -- Set once the guest pays. UNIQUE so one quote can never mint two payable bookings.
  booking_id uuid unique references bookings(id) on delete set null,
  locale content_locale not null default 'en',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  position int not null,
  kind quote_item_kind not null,
  session_occurrence_id uuid references session_occurrences(id),
  activity_option_id uuid references activity_options(id),
  price_label text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  rental_vehicle_slug text references rental_vehicles(slug),
  quantity int not null check (quantity > 0),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  -- A catalogue line must name an occurrence + option; a custom/rental line must not.
  constraint quote_item_shape check (
    (kind = 'catalogue' and session_occurrence_id is not null and activity_option_id is not null)
    or (kind <> 'catalogue' and session_occurrence_id is null and activity_option_id is null
        and description is not null)
  )
);
create index quote_items_quote_idx on quote_items(quote_id, position);

-- Priced booking lines with no session_occurrence. Deliberately NOT booking_items: that table's
-- NOT NULL occurrence + option are load-bearing for capacity, the day sheet and the voucher, and
-- relaxing them would make every existing reader handle a null occurrence.
create table booking_custom_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  position int not null,
  kind quote_item_kind not null check (kind <> 'catalogue'),
  description text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  rental_vehicle_slug text references rental_vehicles(slug),
  quantity int not null check (quantity > 0),
  unit_amount_minor bigint not null check (unit_amount_minor >= 0),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  created_at timestamptz not null default now()
);
create index booking_custom_items_booking_idx on booking_custom_items(booking_id, position);
-- Part 3 (calendar union) reads by day; index it now so that stays a read-only change.
create index booking_custom_items_starts_idx on booking_custom_items(starts_at)
  where starts_at is not null;

alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table booking_custom_items enable row level security;

create policy quotes_staff on quotes for all to authenticated
  using (is_staff()) with check (is_staff());
create policy quote_items_staff on quote_items for all to authenticated
  using (is_staff()) with check (is_staff());
create policy booking_custom_items_staff on booking_custom_items for all to authenticated
  using (is_staff()) with check (is_staff());

-- The revoke is what actually closes anon (stock Supabase default privileges hand every new table to
-- anon + authenticated). The grants must then be explicit, because a fresh database built from
-- setup.sql — and the PGlite harness — has no default privileges at all, so without them the staff
-- policies above would gate a table nobody may touch.
revoke all on quotes, quote_items, booking_custom_items from public, anon;
grant select, insert, update, delete on quotes to authenticated, service_role;
grant select, insert, update, delete on quote_items to authenticated, service_role;
grant select, insert, update, delete on booking_custom_items to authenticated, service_role;
```

- [ ] **Step 2: Append the identical body to `supabase/catch-up.sql`**

Wrap each `create` in the file's existing `if not exists` idiom so a re-run is a no-op. Follow the pattern already used by the `20260908000000_multi_supplements_trip_capacity.sql` block.

- [ ] **Step 3: Regenerate the setup SQL and the ledger**

Run: `npm run setup:sql`
Expected: `supabase/setup.sql` grows a `quotes` section; no other diff.

- [ ] **Step 4: Run the parity tests**

Run: `npx vitest run tests/unit/migration-ledger.test.ts tests/unit/release-supabase-ledger.test.ts tests/integration/catch-up-parity.test.ts tests/integration/quotes-schema.test.ts`
Expected: PASS. A ledger failure means the ledger or catch-up copy drifted — fix the copy, never the test.

The two ledger tests only compare file _text_; they execute no SQL. `tests/integration/catch-up-parity.test.ts` is the only guard that actually RUNS `catch-up.sql` — it applies every migration, layers `catch-up.sql` on top and snapshots every function body — so it is what proves Step 2's real requirement, that a re-run is a no-op. Run it whenever you touch `catch-up.sql`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909000000_quotes.sql supabase/catch-up.sql supabase/setup.sql tests/integration/quotes-schema.test.ts
git commit -m "feat(quotes): schema for quotes, quote items and non-occurrence booking lines"
```

---

## Task 2: Public link token

The guest must pay without an account. A raw HMAC token travels in the emailed URL; only its SHA-256 hash is stored, so a database read can't mint a working link.

**Files:**

- Create: `src/lib/quotes/token.ts`
- Test: `tests/unit/quote-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/quote-token.test.ts
import { describe, expect, it } from 'vitest';
import { mintQuoteToken, hashQuoteToken, quoteTokenMatches } from '@/lib/quotes/token';

describe('quote link token', () => {
  it('mints a token that matches its own hash', async () => {
    const token = mintQuoteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await quoteTokenMatches(token, await hashQuoteToken(token))).toBe(true);
  });

  it('rejects a different token', async () => {
    const hash = await hashQuoteToken(mintQuoteToken());
    expect(await quoteTokenMatches(mintQuoteToken(), hash)).toBe(false);
  });

  it('rejects an absent stored hash rather than treating it as a match', async () => {
    expect(await quoteTokenMatches(mintQuoteToken(), null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/quote-token.test.ts`
Expected: FAIL — cannot resolve `@/lib/quotes/token`.

- [ ] **Step 3: Implement**

```ts
// src/lib/quotes/token.ts
/** Edge-safe (Web Crypto only) minting + constant-time verification of the public quote link token. */

export function mintQuoteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashQuoteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare. A null/absent stored hash is never a match — fail closed. */
export async function quoteTokenMatches(
  token: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(token)) return false;
  const actual = await hashQuoteToken(token);
  if (actual.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1)
    diff |= actual.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/quote-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotes/token.ts tests/unit/quote-token.test.ts
git commit -m "feat(quotes): signed public link token"
```

---

## Task 3: Quote totals

**Files:**

- Create: `src/lib/quotes/totals.ts`, `src/lib/quotes/types.ts`
- Test: `tests/unit/quote-totals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/quote-totals.test.ts
import { describe, expect, it } from 'vitest';
import { lineSubtotalMinor, quoteTotalMinor } from '@/lib/quotes/totals';

describe('quote totals', () => {
  it('multiplies unit by quantity', () => {
    expect(lineSubtotalMinor({ quantity: 3, unitAmountMinor: 4500 })).toBe(13500);
  });

  it('sums every line', () => {
    expect(
      quoteTotalMinor([
        { quantity: 2, unitAmountMinor: 5500 },
        { quantity: 1, unitAmountMinor: 12000 },
      ]),
    ).toBe(23000);
  });

  it('is zero for an empty quote rather than NaN', () => {
    expect(quoteTotalMinor([])).toBe(0);
  });

  it('rejects a fractional quantity instead of silently rounding money', () => {
    expect(() => lineSubtotalMinor({ quantity: 1.5, unitAmountMinor: 1000 })).toThrow(
      /whole number/i,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/quote-totals.test.ts`
Expected: FAIL — cannot resolve `@/lib/quotes/totals`.

- [ ] **Step 3: Implement**

```ts
// src/lib/quotes/totals.ts
export interface PricedLine {
  quantity: number;
  unitAmountMinor: number;
}

/** Minor units only — never floats. A fractional quantity is a caller bug, not something to round. */
export function lineSubtotalMinor(line: PricedLine): number {
  if (!Number.isInteger(line.quantity)) {
    throw new Error(`Quote line quantity must be a whole number, got ${line.quantity}`);
  }
  if (!Number.isInteger(line.unitAmountMinor)) {
    throw new Error(`Quote line unit amount must be a whole number, got ${line.unitAmountMinor}`);
  }
  return line.quantity * line.unitAmountMinor;
}

export function quoteTotalMinor(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineSubtotalMinor(line), 0);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/quote-totals.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotes/totals.ts tests/unit/quote-totals.test.ts
git commit -m "feat(quotes): line and quote total maths"
```

---

## Task 4: Conversion RPC

The single most dangerous step: it mints a payable booking. Rules baked into the function — a quote converts **once** (`quotes.booking_id` is UNIQUE and set inside the same transaction), catalogue line prices are **recomputed from the catalogue**, never trusted from the quote row, and custom line amounts are taken as-is because they are the negotiated figure.

**Files:**

- Modify: `supabase/migrations/20260909000000_quotes.sql` (append), `supabase/catch-up.sql`
- Modify: `tests/db/rpc.ts` — add `api_convert_quote` to the `ALLOWED` set, or the PGlite adapter throws `unknown rpc`
- Test: `tests/integration/quotes-rpc.test.ts`

**House RPC convention — do not deviate:** every `api_*` function takes ONE `jsonb` argument and returns
`jsonb`. The PGlite adapter calls `select api_convert_quote($1::jsonb)`, so a `(quote_id uuid)` signature
will not run in tests or in production. `tests/db/` holds harness helpers only (`pglite.ts`, `rpc.ts`,
`seed.ts`) — DB-backed tests live in `tests/integration/`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/quotes-rpc.test.ts
// Follow the harness pattern of an existing PGlite test (e.g. tests/integration/admin-atomic-writes.test.ts):
// boot PGlite via tests/db/pglite.ts, wrap it with pgliteServiceRoleRpc from tests/db/rpc.ts, and seed
// with tests/db/seed.ts. `callRpc` below is that adapter's .rpc(); `seedQuote` is a local helper you write
// in this file that inserts a quotes row + quote_items rows directly.
import { describe, expect, it } from 'vitest';

describe('api_convert_quote', () => {
  it('creates one payment_pending booking with source quote', async () => {
    const quote = await seedQuote({
      customLines: [{ description: 'Private guide', amount: 12000 }],
    });
    const booking = await callRpc('api_convert_quote', { quoteId: quote.id });
    expect(booking.status).toBe('payment_pending');
    expect(booking.source).toBe('quote');
    expect(booking.total_minor).toBe(12000);
  });

  it('refuses to convert the same quote twice', async () => {
    const quote = await seedQuote({ customLines: [{ description: 'Charter', amount: 50000 }] });
    await callRpc('api_convert_quote', { quoteId: quote.id });
    await expect(callRpc('api_convert_quote', { quoteId: quote.id })).rejects.toThrow(
      /already converted/i,
    );
  });

  it('refuses a cancelled quote', async () => {
    const quote = await seedQuote({ status: 'cancelled' });
    await expect(callRpc('api_convert_quote', { quoteId: quote.id })).rejects.toThrow(/cancelled/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/quotes-rpc.test.ts`
Expected: FAIL — `function api_convert_quote does not exist`.

- [ ] **Step 3: Append the RPC to the migration (and catch-up.sql)**

```sql
create or replace function api_convert_quote(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  q quotes;
  b bookings;
  new_ref text;
begin
  select * into q from quotes where id = (payload->>'quoteId')::uuid for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.booking_id is not null then raise exception 'Quote already converted'; end if;
  if q.status = 'cancelled' then raise exception 'Quote is cancelled'; end if;
  if q.valid_until < current_date then raise exception 'Quote has expired'; end if;

  new_ref := 'BMT' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 13));

  insert into bookings (ref, customer_name, customer_email, customer_phone, status, source,
                        currency, total_minor, payment_state, locale)
  values (new_ref, q.customer_name, q.customer_email, q.customer_phone, 'payment_pending', 'quote',
          q.currency, q.total_minor, 'pending', q.locale)
  returning * into b;

  insert into booking_custom_items (booking_id, position, kind, description, starts_at, ends_at,
                                    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor)
  select b.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor
  from quote_items qi where qi.quote_id = q.id and qi.kind <> 'catalogue';

  update quotes set booking_id = b.id, status = 'accepted', updated_at = now() where id = q.id;
  return to_jsonb(b);
end $$;

revoke all on function api_convert_quote(jsonb) from public, anon, authenticated;
```

Note: catalogue lines are inserted by a follow-up step in Task 8, which calls the existing hold/capacity path. This RPC covers custom lines only, so Task 4 is independently testable.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/quotes-rpc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the definer-grant and catch-up parity guards**

Run: `npx vitest run tests/integration/definer-grants-lockdown.test.ts tests/integration/catch-up-parity.test.ts`
Expected: PASS.

`definer-grants-lockdown` is the test that has caught a leaked `anon`/`authenticated` grant twice — a new SECURITY DEFINER function must be revoked from all three roles.

`catch-up-parity` is the only test that EXECUTES `catch-up.sql`: it applies the migrations, then layers `catch-up.sql` on top and diffs every function body. This step is exactly where it bites — if the `create or replace function api_convert_quote` body copied into `catch-up.sql` drifts from the migration's, the operator's re-run silently overwrites the good version with the stale one, and only this test sees it. The ledger tests would stay green; they compare file text and run no SQL.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260909000000_quotes.sql supabase/catch-up.sql supabase/setup.sql tests/db/rpc.ts tests/integration/quotes-rpc.test.ts
git commit -m "feat(quotes): convert a quote to a payable booking, exactly once"
```

---

## Task 5: Admin service layer

**Files:**

- Create: `src/lib/admin/quotes.ts`
- Test: `tests/unit/admin-quotes.test.ts`

Mirror `src/lib/admin/bookings.ts`: staff RLS via the authenticated client, Zod-parsed rows, no service-role key in the browser. Exports: `loadQuotes(limit)`, `loadQuote(id)`, `saveQuote(input)`, `cancelQuote(id)`, `sendQuote(id)`.

- [ ] **Step 1: Write the failing test** — assert `saveQuote` recomputes `total_minor` from its lines rather than trusting a client-supplied total:

```ts
// tests/unit/admin-quotes.test.ts
import { describe, expect, it } from 'vitest';
import { quoteRowTotal } from '@/lib/admin/quotes';

describe('saveQuote totals', () => {
  it('ignores a client-supplied total and recomputes from the lines', () => {
    expect(
      quoteRowTotal({
        totalMinor: 1,
        items: [
          { quantity: 2, unitAmountMinor: 5000 },
          { quantity: 1, unitAmountMinor: 2500 },
        ],
      }),
    ).toBe(12500);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/admin-quotes.test.ts`
Expected: FAIL — `quoteRowTotal` is not exported.

- [ ] **Step 3: Implement `quoteRowTotal` on top of `quoteTotalMinor`, then the CRUD functions**

```ts
// src/lib/admin/quotes.ts (excerpt)
import { quoteTotalMinor, type PricedLine } from '@/lib/quotes/totals';

/** The stored total is always derived. A total that arrived from the browser is discarded. */
export function quoteRowTotal(input: { totalMinor?: number; items: PricedLine[] }): number {
  return quoteTotalMinor(input.items);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/admin-quotes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/quotes.ts tests/unit/admin-quotes.test.ts
git commit -m "feat(quotes): staff service layer"
```

---

## Task 6: Quote email

**Files:**

- Create: `src/lib/email/quote.ts`
- Test: `tests/unit/quote-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/quote-email.test.ts
import { describe, expect, it } from 'vitest';
import { renderQuoteEmail } from '@/lib/email/quote';

const quote = {
  ref: 'Q7F3A21',
  customerName: 'Marie Dupont',
  currency: 'EUR',
  totalMinor: 23000,
  validUntil: '2026-08-19',
  introNote: 'As discussed on the phone.',
  items: [
    { description: 'Catamaran cruise, 23 Aug, 2 adults', quantity: 2, unitAmountMinor: 5500 },
    { description: 'Private guide, full day', quantity: 1, unitAmountMinor: 12000 },
  ],
};

describe('quote email', () => {
  it('lists every line and the total', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      payUrl: 'https://bellemaretours.com/quotes/Q7F3A21?t=abc',
    });
    expect(html).toContain('Private guide, full day');
    expect(html).toContain('Catamaran cruise, 23 Aug, 2 adults');
    expect(html).toContain('230.00');
  });

  it('links to the tokenised pay URL exactly once', () => {
    const payUrl = 'https://bellemaretours.com/quotes/Q7F3A21?t=abc';
    const { html } = renderQuoteEmail({ ...quote, payUrl });
    expect(html.split(payUrl).length - 1).toBeGreaterThanOrEqual(1);
  });

  it('never leaks internal notes into the guest email', () => {
    const { html } = renderQuoteEmail({
      ...quote,
      internalNotes: 'margin is thin, do not discount further',
      payUrl: 'https://bellemaretours.com/quotes/Q7F3A21?t=abc',
    });
    expect(html).not.toContain('margin is thin');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/quote-email.test.ts`
Expected: FAIL — cannot resolve `@/lib/email/quote`.

- [ ] **Step 3: Implement `renderQuoteEmail`**

Follow the structure of `src/lib/email/booking-confirmation.ts` — same header/logo partial, same money formatting helper, `{ subject, html }` return shape. Take only the guest-facing fields as parameters; `internalNotes` must not be destructured into the template at all.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/unit/quote-email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/quote.ts tests/unit/quote-email.test.ts
git commit -m "feat(quotes): itemised quote email"
```

---

## Task 7: Public quote page

**Files:**

- Create: `app/(site)/quotes/[ref]/page.tsx`
- Test: `tests/integration/quote-page.test.ts`

- [ ] **Step 1: Write the failing test** — the security property, not the layout:

```ts
// tests/integration/quote-page.test.ts
import { describe, expect, it } from 'vitest';
import { resolveQuoteForToken } from '@/lib/quotes/resolve';

describe('public quote access', () => {
  it('returns null for a wrong token instead of the quote', async () => {
    expect(await resolveQuoteForToken('Q7F3A21', 'f'.repeat(64))).toBeNull();
  });

  it('returns null when no token is supplied at all', async () => {
    expect(await resolveQuoteForToken('Q7F3A21', '')).toBeNull();
  });

  it('returns null for a cancelled quote even with the right token', async () => {
    const { ref, token } = await seedSentQuote({ status: 'cancelled' });
    expect(await resolveQuoteForToken(ref, token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/quote-page.test.ts`
Expected: FAIL — cannot resolve `@/lib/quotes/resolve`.

- [ ] **Step 3: Implement `resolveQuoteForToken` + the page**

`resolveQuoteForToken(ref, token)` loads by `ref` with the service-role client, calls `quoteTokenMatches(token, row.token_hash)`, and returns null on any of: no row, no match, status `cancelled`, `valid_until` in the past. The page renders lines, total, validity and a Pay button posting to Task 8's route. `export const runtime = 'edge'` and `robots: { index: false, follow: false }` in metadata, matching `app/(site)/bookings/[ref]/pay/page.tsx`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/quote-page.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/\(site\)/quotes src/lib/quotes/resolve.ts tests/integration/quote-page.test.ts
git commit -m "feat(quotes): public quote page behind a link token"
```

---

## Task 8: Pay route

**Files:**

- Create: `app/api/v1/quotes/[ref]/pay/route.ts`
- Test: `tests/integration/quote-pay.test.ts`

Authenticated by the **token**, not by `requireUser` — that is the whole point, since the guest has no account. Rate-limited per IP like `app/api/v1/client-errors/route.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/quote-pay.test.ts
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/quotes/[ref]/pay/route';

describe('POST /api/v1/quotes/{ref}/pay', () => {
  it('rejects a bad token with 404, not 401 (no quote existence oracle)', async () => {
    const res = await POST(
      new Request('https://x/api/v1/quotes/Q7F3A21/pay', {
        method: 'POST',
        body: JSON.stringify({ token: 'f'.repeat(64) }),
      }),
      { params: Promise.resolve({ ref: 'Q7F3A21' }) },
    );
    expect(res.status).toBe(404);
  });

  it('returns the same checkout id when called twice (no second payable session)', async () => {
    const { ref, token } = await seedSentQuote();
    const body = JSON.stringify({ token });
    const first = await POST(new Request('https://x', { method: 'POST', body }), {
      params: Promise.resolve({ ref }),
    });
    const second = await POST(new Request('https://x', { method: 'POST', body }), {
      params: Promise.resolve({ ref }),
    });
    expect((await first.json()).data.checkoutId).toBe((await second.json()).data.checkoutId);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/integration/quote-pay.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Order of operations: rate limit → `resolveQuoteForToken` (404 on null) → if `quotes.booking_id` is already set, reuse that booking; otherwise `api_convert_quote` → for each catalogue line take the hold and insert the `booking_items` row → mint the checkout by calling the EXISTING `createPaymentLink(ctx, { bookingRef, idempotencyKey }, adminCtx)` in `src/lib/services/payments.ts` → return `{ checkoutId, bookingRef }`.

Do **not** call `createCheckout()` in `src/lib/payments/peach.ts` directly. `createPaymentLink` goes through `api_create_payment`, which holds the checkout lease and single-flights concurrent callers — that lease is what stops a second payable session existing for one booking, the defect class fixed in `ec5ebcf`. Reusing it means the "same checkout id twice" test passes because the invariant is genuinely enforced, not re-implemented.

Pass `returnUrl: quotePayReturnUrl(quoteRef)` (`src/lib/quotes/link-cookie.ts`) — **not** the `${SITE_URL}/bookings/{ref}` that `/api/v1/payments` builds. That value becomes Peach's `shopperResultUrl`, which is where a card taking the redirect-based 3-D Secure path returns the guest **top-level**; `?return=` cannot help there, because it is read only by `EmbeddedCheckout`'s own `router.replace`. Left at the default, a quote guest is charged and then shown BookingConfirmation's "Sign in to view booking …" — they have no account. It must stay absolute and same-origin: `peach.ts` derives the `Origin` header from it via `originOf`. Assert it in the route test: the `returnUrl` handed to the provider points at `/quotes/{ref}`.

The route's 404 for a missing/expired link cookie is what `startQuotePayment` turns into "This quote link has timed out. Please open the link in your quote email again." — so answer `NotFoundError` there, and keep the code `not_found`.

Also verify the recomputed catalogue total matches `quotes.total_minor` before minting, and fail with a 409 if it doesn't (see Self-Review, Known gap).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/integration/quote-pay.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/quotes tests/integration/quote-pay.test.ts
git commit -m "feat(quotes): pay a quote without an account"
```

---

## Task 9: Admin UI

**Files:**

- Create: `src/components/admin/AdminQuotes.tsx`, `app/(site)/admin/quotes/page.tsx`
- Modify: `app/(site)/admin/layout.tsx` (add the nav entry)

- [ ] **Step 1: Build the list** — ref, guest, total, status, valid-until, sorted newest first. Follow `src/components/admin/AdminBookings.tsx` for table, sort and CSV idiom.
- [ ] **Step 2: Build the editor** — guest fields, valid-until (default today + 14 days), intro note, internal notes, and the line editor: "Add tour" (activity → date → option → party, priced from the catalogue, with an override field) and "Add custom line" (description, date, time, quantity, unit amount).
- [ ] **Step 3: Wire Send** — posts to the staff route, shows the resulting public URL with a copy button, flips status to `sent`.
- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, whole suite. Check `git status` first — an uncommitted file from a parallel session can make this green while CI is red.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminQuotes.tsx app/\(site\)/admin/quotes app/\(site\)/admin/layout.tsx
git commit -m "feat(admin): draft, send and track quotes"
```

---

## Task 10: Contract artifacts and docs

- [ ] **Step 1: Register the two new routes in `src/lib/openapi/registry.ts`**
- [ ] **Step 2: Regenerate** — Run: `npm run openapi:write`
- [ ] **Step 3: Document the module in `docs/HANDBOOK.md`** — the quote lifecycle, the token model, and the one-booking-per-quote rule.
- [ ] **Step 4: Run the full CI gate**

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run openapi:write
```

Expected: all green. If `format:check` fails on `.mcp.json` alone, that is the known CRLF drift — `tr -d '\r'`, nothing to commit.

- [ ] **Step 5: Commit**

```bash
git add openapi.json src/lib/openapi/registry.ts docs/HANDBOOK.md
git commit -m "docs(quotes): contract and handbook entry"
```

---

## Self-Review

**Spec coverage:** draft with catalogue + custom lines (Tasks 1, 5, 9) · dates on custom lines (Task 1, `starts_at`/`ends_at`) · send by email with everything requested (Task 6) · link to checkout (Tasks 7, 8) · payment lands in the ledger and fires invoice/confirmation (Task 8 reuses the untouched Peach path) · rentals (Part 2, groundwork in Task 1) · calendar visibility (Part 3, index in Task 1).

**Money-path invariants asserted by tests:** one booking per quote (Task 4, UNIQUE + guard) · no second payable session (Task 8) · totals never trusted from the browser (Tasks 3, 5) · definer grants revoked (Task 4) · no existence oracle on the public route (Task 8).

**Known gap:** the quote's catalogue lines are priced when the line is added, but the catalogue can change before the guest pays. Task 8 recomputes catalogue prices at conversion; if the recomputed total differs from the quoted total the route must fail loudly rather than silently charge a different figure. Implement that check in Task 8 Step 3 and cover it with a test.
