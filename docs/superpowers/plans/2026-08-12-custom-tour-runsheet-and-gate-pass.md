# Custom-tour calendar run-sheet + room-for-gate-pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a custom/private-tour line on the operations calendar show its full run sheet (guests, start time, pickup hotel, room number), collect a hotel room number wherever a pickup is chosen (public checkout + quotes) for the driver's gate pass, and fix the day-sheet contradiction where a round-trip transfer prints "No pickup · customer makes own way" and "Drop-off: —".

**Architecture:** Three nullable, additive columns capture the missing facts: `guests` + `pickup_label` on `quote_items` and `booking_custom_items` (per custom line), and `room_or_cabin` on `quotes` (guest-level; `bookings.room_or_cabin` already exists). `api_convert_quote` copies them onto the minted booking. The quote editor gains a per-custom-line guests field + pickup control and a guest-pane room field; the public checkout gains a room field on the activity pickup step; the calendar day sheet renders the new facts and resolves pickup/drop-off through one shared pure function that treats a round-trip transport add-on as the pickup. `guests` never touches the money path (`PricedLine` ignores it).

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase/Postgres (idempotent SQL migrations + `catch-up.sql`/`setup.sql` parity + migration ledger), Vitest, Tailwind. Money is minor units; the quote editor holds numbers as text and parses once.

---

## Data facts established during research

- `booking_custom_items` (migration `20260909000000`) has: `description, starts_at, ends_at, rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor` + the transport add-on columns (`20260924000000`). **No headcount, no pickup of its own.**
- `bookings.room_or_cabin` already exists and is read into `AdminTransferDetails.roomOrCabin` — but `mapTransfer()` returns `null` unless `trip_direction` is set, so room is currently invisible on any non-transfer booking.
- `api_convert_quote`'s winning body is `supabase/migrations/20260925000000_convert_quote_transport.sql`. `resolved-function-bodies.test.ts` pins two contracts inside it: the owner resolve `v_owner := quote_owner_for_email(v_quote.customer_email)` and the deposit sizing `v_deposit_minor := round(v_quote.total_minor * v_quote.deposit_bps / 10000.0)`. **Keep both byte-identical.**
- The public checkout (`Checkout.tsx`) already has a `roomOrCabin` state + a "Room / cabin number" field, but both the field and the `roomOrCabin:` payload key are gated to `isAirport || isHotelTransfer`. `detailsHash` already includes `roomOrCabin` (no change needed there).
- `PickupFacts` (in `BookingFacts.tsx`) is shared by the calendar day sheet (`AdminCalendar.tsx`) and the bookings drawer (`AdminBookings.tsx`). It already encodes "null drop-off WITH a pickup = same as pickup".
- The quote line pickup is "the guest's hotel, remembered across lines" (`LineTransport.tsx`), so one guest-level room number is the right model.

## File structure

**Migration + parity**

- Create `supabase/migrations/20260927000000_custom_line_runsheet.sql` — the 3 columns + `api_convert_quote` re-applied with 2 copy changes.
- Modify `supabase/catch-up.sql` — append the migration verbatim.
- Regenerate `supabase/setup.sql` — `npm run setup:sql`.
- Modify `supabase/backfill-migration-ledger.sql` — add the ledger row.

**Quote data layer**

- Modify `src/lib/admin/quotes.ts` — types, column lists, mappers, `quoteItemRows`, `saveQuote`.

**Quote editor**

- Modify `src/components/admin/quotes/state.ts` — `parseGuests`, drafts, `QuoteLineDraft`/`QuoteFormValues`, `formFromQuote`, `quoteInputFromForm`.
- Create `src/components/admin/quotes/LinePickup.tsx` — a fareless per-line pickup control for custom lines.
- Modify `src/components/admin/quotes/LinesPane.tsx` — render Guests + LinePickup on custom lines.
- Modify `src/components/admin/AdminQuotes.tsx` — Room number field in the guest pane.

**Calendar**

- Modify `src/lib/admin/calendar.ts` — `DayCustomLine`/`DayBooking` fields, mappers, select strings.
- Modify `src/components/admin/BookingFacts.tsx` — pure `resolvePickup()` + `PickupFacts` extension.
- Modify `src/components/admin/AdminCalendar.tsx` — render the run sheet + wire the resolver.

**Checkout**

- Modify `src/components/checkout/Checkout.tsx` — room field on the activity pickup step + send it.
- Modify `src/lib/i18n/messages.ts` — one new FR string for the gate-pass hint.

**Tests**

- Modify `tests/unit/admin-calendar.test.ts`, the quotes-editor/quotes-lib unit tests, and the convert-quote integration test.

---

### Task 0: Migration — 3 columns + conversion copy

**Files:**

- Create: `supabase/migrations/20260927000000_custom_line_runsheet.sql`
- Modify: `supabase/catch-up.sql`, `supabase/backfill-migration-ledger.sql`
- Regenerate: `supabase/setup.sql`

- [ ] **Step 1: Write the migration.** Header block explaining the change, then the additive columns, then `api_convert_quote` re-applied. Copy the ENTIRE body of `20260925000000_convert_quote_transport.sql` verbatim and apply exactly the two hunks below. The columns:

```sql
-- 20260927000000_custom_line_runsheet
--
-- A custom/private-tour line carries no headcount and no pickup of its own, so the operations calendar
-- can show a bespoke tour's date and price but not "collect 2 guests from <hotel>, room 214". Three
-- additive, nullable columns fix that, on every table a custom line lives in so they survive quote ->
-- booking conversion and reach the day sheet:
--   * guests       — the party size for the run sheet (custom lines only; a catalogue line has its
--                    tier quantities, a rental counts vehicles). NOT a money field: PricedLine ignores
--                    it, quote_total_mismatch never sees it.
--   * pickup_label — where to collect the tour from (the guest's hotel), independent of the optional
--                    paid transport add-on (a private tour includes its transport, so it must not be
--                    forced through a €0 "round-trip transfer" line).
--   * room_or_cabin on quotes — the guest's room for the driver's hotel gate pass, copied onto the
--                    booking (bookings.room_or_cabin already exists) at conversion.
--
-- Null everywhere today, so purely additive; changes no existing figure. Then api_convert_quote is
-- re-applied VERBATIM from its winning body (20260925000000) apart from two copies: booking.room_or_cabin
-- from the quote, and guests/pickup_label onto booking_custom_items. The total check, the owner resolve
-- and the deposit sizing are byte-identical (resolved-function-bodies.test.ts pins the latter two).
--
-- Mirror into supabase/catch-up.sql and regenerate supabase/setup.sql (`npm run setup:sql`); add
-- ('20260927000000','custom_line_runsheet') to supabase/backfill-migration-ledger.sql.

alter table quote_items
  add column if not exists guests int check (guests is null or guests > 0),
  add column if not exists pickup_label text;

alter table booking_custom_items
  add column if not exists guests int check (guests is null or guests > 0),
  add column if not exists pickup_label text;

alter table quotes
  add column if not exists room_or_cabin text;

-- … api_convert_quote re-applied from 20260925000000 with the two hunks below …
```

**Hunk A — the booking INSERT** gains `room_or_cabin`:

```sql
  insert into bookings (
    user_id, customer_name, customer_email, customer_phone, status, source,
    currency, total_minor, operator_payout_minor, payment_state, locale,
    deposit_minor, balance_due_minor, room_or_cabin
  )
  values (
    v_owner, v_quote.customer_name, v_quote.customer_email, v_quote.customer_phone, 'payment_pending',
    'quote', v_quote.currency, v_quote.total_minor, v_quote.total_minor, 'pending', v_quote.locale,
    v_deposit_minor, v_quote.total_minor, v_quote.room_or_cabin
  )
  returning * into v_booking;
```

**Hunk B — the `booking_custom_items` INSERT** copies `guests` + `pickup_label`:

```sql
  insert into booking_custom_items (
    booking_id, position, kind, description, starts_at, ends_at,
    rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor,
    transport_pickup_label, transport_dropoff_label, transport_fare_minor,
    guests, pickup_label
  )
  select v_booking.id, qi.position, qi.kind, qi.description, qi.starts_at, qi.ends_at,
         qi.rental_vehicle_slug, qi.quantity, qi.unit_amount_minor, qi.subtotal_minor,
         qi.transport_pickup_label, qi.transport_dropoff_label, qi.transport_fare_minor,
         qi.guests, qi.pickup_label
    from quote_items qi
   where qi.quote_id = v_quote.id
     and qi.kind <> 'catalogue';
```

Everything else in the function body (the re-arm branch, the whitelist, the `quote_total_mismatch` sum `coalesce(sum(qi.subtotal_minor),0) + coalesce(sum(qi.transport_fare_minor),0)`, `v_owner := quote_owner_for_email(...)`, `v_deposit_minor := round(...)`, the hold loop, the catalogue `booking_items` INSERT, the final `update quotes`, the `revoke`/`grant`) is copied unchanged.

- [ ] **Step 2: Mirror into `catch-up.sql`.** Append the whole file content of `20260927000000_custom_line_runsheet.sql` verbatim to the end of `supabase/catch-up.sql` (that file is the concatenation of every migration; it is how a drifted DB is caught up).

- [ ] **Step 3: Add the ledger row.** In `supabase/backfill-migration-ledger.sql`, add `('20260927000000','custom_line_runsheet')` in the same VALUES list/format as the existing rows (match trailing-comma style).

- [ ] **Step 4: Regenerate setup.sql.**

Run: `npm run setup:sql`
Expected: `supabase/setup.sql` updates to include the 3 columns + the new `api_convert_quote` body; no other diff.

- [ ] **Step 5: Verify parity + ledger tests.**

Run: `npx vitest run tests/unit/setup-sql-parity tests/unit/catch-up-parity tests/unit/migration-ledger tests/unit/resolved-function-bodies`
Expected: PASS (resolved-function-bodies still sees the two pinned contracts; parity green).

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/20260927000000_custom_line_runsheet.sql supabase/catch-up.sql supabase/setup.sql supabase/backfill-migration-ledger.sql
git commit -m "feat(quotes): schema for custom-line guests/pickup + quote room, copied at conversion"
```

---

### Task 1: Quote data layer (`src/lib/admin/quotes.ts`)

**Files:** Modify `src/lib/admin/quotes.ts`; Test `tests/unit/quotes-lib.test.ts` (or the existing quotes lib test file — grep for `quoteItemRows`).

- [ ] **Step 1: Write failing tests** for `quoteItemRows` writing the new columns and `mapItem`/`mapQuote` reading them:

```ts
it('writes guests + pickup_label on a custom line, null on catalogue/rental', () => {
  const [custom, rental] = quoteItemRows([
    {
      kind: 'custom',
      description: 'Private South Tour',
      quantity: 1,
      unitAmountMinor: 9000,
      guests: 2,
      pickupLabel: 'Crystals Beach Resort',
      transportFareMinor: null,
    },
    {
      kind: 'rental',
      description: 'Nissan March · 1-day rental',
      quantity: 1,
      unitAmountMinor: 3000,
      rentalVehicleSlug: 'nissan-march',
      guests: 5,
      pickupLabel: 'x',
      transportFareMinor: null,
    },
  ]);
  expect(custom.guests).toBe(2);
  expect(custom.pickup_label).toBe('Crystals Beach Resort');
  expect(rental.guests).toBeNull();
  expect(rental.pickup_label).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail.** `npx vitest run tests/unit/quotes-lib.test.ts` → FAIL (`guests`/`pickup_label` undefined).

- [ ] **Step 3: Implement.** In `src/lib/admin/quotes.ts`:
  - `QuoteItem`: add `guests: number | null;` and `pickupLabel: string | null;`.
  - `QuoteRow`: add `roomOrCabin: string | null;`.
  - `QuoteItemInput`: add `guests?: number | null;` and `pickupLabel?: string | null;`.
  - `QuoteInput`: add `roomOrCabin?: string | null;`.
  - `QuoteItemInsert`: add `guests: number | null;` and `pickup_label: string | null;`.
  - `quoteItemRows` return object: add
    ```ts
    guests: item.kind === 'custom' ? (item.guests ?? null) : null,
    pickup_label: item.kind === 'custom' ? (item.pickupLabel?.trim() || null) : null,
    ```
  - `ITEM_COLUMNS`: append `, guests, pickup_label`.
  - `QUOTE_COLUMNS`: append `, room_or_cabin`.
  - `mapItem`: add `guests: raw.guests == null ? null : Number(raw.guests),` and `pickupLabel: textOrNull(raw.pickup_label),`.
  - `mapQuote`: add `roomOrCabin: textOrNull(raw.room_or_cabin),`.
  - `saveQuote` `fields` object (the full-replace side): add `room_or_cabin: input.roomOrCabin?.trim() || null,`.

- [ ] **Step 4: Run to verify pass.** `npx vitest run tests/unit/quotes-lib.test.ts` → PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(quotes): carry guests/pickup_label/room through the quote data layer"`

---

### Task 2: Quote editor pure state (`src/components/admin/quotes/state.ts`)

**Files:** Modify `src/components/admin/quotes/state.ts`; Test `tests/unit/admin-quotes-editor.test.ts` (grep for `quoteInputFromForm`).

- [ ] **Step 1: Write failing tests:**

```ts
it('parseGuests: blank → null, whole > 0 → number, else throws', () => {
  expect(parseGuests('', 'Guests')).toBeNull();
  expect(parseGuests('2', 'Guests')).toBe(2);
  expect(() => parseGuests('0', 'Guests')).toThrow();
  expect(() => parseGuests('2.5', 'Guests')).toThrow();
});

it('quoteInputFromForm carries guests/pickup on custom lines and room on the quote', () => {
  const form = {
    ...emptyQuoteForm('2026-08-12'),
    customerName: 'C',
    customerEmail: 'c@e.com',
    roomOrCabin: 'Room 214',
    lines: [
      {
        ...customLineDraft(),
        description: 'Private South Tour',
        unitText: '90',
        quantityText: '1',
        guests: '2',
        pickupLabel: 'Crystals Beach Resort',
      },
    ],
  };
  const input = quoteInputFromForm(form);
  expect(input.roomOrCabin).toBe('Room 214');
  expect(input.items[0].guests).toBe(2);
  expect(input.items[0].pickupLabel).toBe('Crystals Beach Resort');
});
```

- [ ] **Step 2: Run to verify fail.** FAIL (`parseGuests`/fields missing).

- [ ] **Step 3: Implement** in `state.ts`:
  - Add `parseGuests`:
    ```ts
    /** A blank guests field → null (no headcount stated); otherwise a whole number ≥ 1, or a
     *  {@link ValidationError}. Mirrors the `guests int check (guests is null or guests > 0)` column. */
    export function parseGuests(input: string, label: string): number | null {
      const raw = String(input ?? '').trim();
      if (!raw) return null;
      if (!/^\d+$/.test(raw) || Number(raw) < 1) {
        throw new ValidationError(
          `${label} must be a whole number of at least 1, or left blank ("${input}").`,
        );
      }
      return Number(raw);
    }
    ```
  - `QuoteLineDraft`: add `guests: string;` and `pickupLabel: string;` (both held as text; pickup is the hotel label).
  - `QuoteFormValues`: add `roomOrCabin: string;`.
  - `customLineDraft()`, `emptyQuoteForm()` lines, `tourLineDrafts()`, `rentalLineDraft()`, `transportLineDraft()`: add `guests: '', pickupLabel: ''` to each returned draft object.
  - `emptyQuoteForm()`: add `roomOrCabin: ''`.
  - `formFromQuote()`: in the line map add `guests: item.guests != null ? String(item.guests) : '', pickupLabel: item.pickupLabel ?? '',`; and top-level `roomOrCabin: quote.roomOrCabin ?? '',`.
  - `quoteInputFromForm()`: in the item map add `guests: line.kind === 'custom' ? parseGuests(line.guests, `${label} guests`) : null,` and `pickupLabel: line.kind === 'custom' ? line.pickupLabel.trim() || null : null,`; and in the returned `QuoteInput` add `roomOrCabin: form.roomOrCabin.trim() || null,`.

- [ ] **Step 4: Run to verify pass.** PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(quotes): editor state carries custom-line guests/pickup + quote room"`

---

### Task 3: Quote editor UI — guests + pickup (custom lines) + room (guest pane)

**Files:** Create `src/components/admin/quotes/LinePickup.tsx`; Modify `src/components/admin/quotes/LinesPane.tsx`, `src/components/admin/AdminQuotes.tsx`.

- [ ] **Step 1: Create `LinePickup.tsx`** — a fareless pickup control for a custom line, modelled on `LineTransport.tsx`'s dynamic `PickupMap` + shared `pickup` state, writing `line.pickupLabel`:

```tsx
'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { IconPin, IconPlus, IconX } from '@/components/ui/icons';
import type { QuotePickup } from '@/components/admin/quotes/pickup';

const PickupMap = dynamic(() => import('@/components/maps/PickupMap').then((m) => m.PickupMap), {
  ssr: false,
});

/** Where to collect a CUSTOM tour from — the guest's hotel, no fare (a private tour includes its
 *  transport). Shown on the calendar day sheet so the driver knows the pickup. Reuses the quote's
 *  shared `pickup` (remembered across lines); writes the chosen label onto `line.pickupLabel`. */
export function LinePickup({
  pickupLabel,
  onChange,
  pickup,
  setPickup,
}: {
  pickupLabel: string;
  onChange: (label: string) => void;
  pickup: QuotePickup;
  setPickup: Dispatch<SetStateAction<QuotePickup>>;
}) {
  const [editing, setEditing] = useState(false);
  if (!pickupLabel && !editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          if (pickup.label) onChange(pickup.label);
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-dark hover:text-teal"
      >
        <IconPlus width={13} height={13} /> Add pickup hotel
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-ink/15 bg-ink/[0.02] p-2.5">
      <div className="flex items-center gap-2">
        <IconPin width={13} height={13} className="text-teal-dark" />
        <span className="text-[12px] font-bold text-ink">Pickup hotel</span>
        <button
          type="button"
          onClick={() => {
            onChange('');
            setEditing(false);
          }}
          aria-label="Remove the pickup from this line"
          className="ml-auto grid h-6 w-6 place-items-center rounded text-coral hover:bg-coral/10"
        >
          <IconX width={12} height={12} />
        </button>
      </div>
      {editing ? (
        <div className="mt-2">
          <PickupMap
            value={pickup.label}
            onChange={(label) => setPickup((cur) => ({ ...cur, label }))}
            onCoords={(coords) => setPickup((cur) => ({ ...cur, coords }))}
            placeholder="Guest's hotel or address"
          />
          <button
            type="button"
            onClick={() => {
              onChange(pickup.label);
              setEditing(false);
            }}
            className="mt-1.5 text-[12px] font-semibold text-teal-dark hover:underline"
          >
            Done
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-ink-muted">
          {pickupLabel || '—'}{' '}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-semibold text-teal-dark hover:underline"
          >
            change
          </button>
        </p>
      )}
    </div>
  );
}
```

NOTE the pickup-search landmine ([[gytm-quotes-transport-addon]]): `setPickup` must be functional (`(cur) => …`) on both callbacks — copied above.

- [ ] **Step 2: Wire into `LinesPane.tsx`.** Find where each line renders its fields and where `LineTransport` is rendered (it already receives `pickup`/`setPickup`). For a line with `line.kind === 'custom'` (not rental), render, before or beside `LineTransport`:
  - A **Guests** number input bound to `line.guests` (update via the same per-line setter the quantity input uses):
    ```tsx
    <label className="block text-[12px] font-semibold text-ink-muted">
      Guests
      <input
        value={line.guests}
        onChange={(e) => updateLine(i, { guests: e.target.value })}
        inputMode="numeric"
        placeholder="e.g. 2"
        className={`${INPUT_CLS} mt-0.5 max-w-[6rem]`}
        aria-label="Number of guests on this custom tour"
      />
    </label>
    ```
  - `<LinePickup pickupLabel={line.pickupLabel} onChange={(label) => updateLine(i, { pickupLabel: label })} pickup={pickup} setPickup={setPickup} />`
    (Match the actual per-line update helper name in `LinesPane` — grep for how `quantityText`/`unitText` inputs call it; reuse that exact updater.)

- [ ] **Step 3: Room field in the guest pane (`AdminQuotes.tsx`).** In the "Who this offer is for" card (after the Phone `Field`, ~line 697), add:

```tsx
<Field label="Hotel room number" hint="For the driver's gate pass at the guest's hotel. Optional.">
  <input
    value={values.roomOrCabin}
    onChange={(e) => set('roomOrCabin', e.target.value)}
    className={INPUT_CLS}
    placeholder="e.g. Room 214"
  />
</Field>
```

(`set` and `values` are already in scope in this pane; `roomOrCabin` is now a `QuoteFormValues` field from Task 2.)

- [ ] **Step 4: Typecheck.** `npx tsc --noEmit` → PASS (no type errors from the new fields/props).

- [ ] **Step 5: Commit.** `git commit -am "feat(quotes): custom-line guests + pickup controls and guest-pane room field"`

---

### Task 4: Calendar data (`src/lib/admin/calendar.ts`)

**Files:** Modify `src/lib/admin/calendar.ts`; Test `tests/unit/admin-calendar.test.ts`.

- [ ] **Step 1: Write failing tests** for the mappers surfacing the new facts:

```ts
it('mapDayCustomLines surfaces guests, pickupLabel and the booking room', () => {
  const [line] = mapDayCustomLines([
    {
      id: 'ci1',
      kind: 'custom',
      description: 'Private South Tour',
      starts_at: '2026-09-02T05:00:00Z',
      ends_at: null,
      rental_vehicle_slug: null,
      quantity: 1,
      unit_amount_minor: 9000,
      subtotal_minor: 9000,
      transport_pickup_label: null,
      transport_dropoff_label: null,
      guests: 2,
      pickup_label: 'Crystals Beach Resort',
      bookings: {
        /* …counted booking fields… */ status: 'confirmed',
        payment_state: 'paid',
        room_or_cabin: 'Room 214' /* … */,
      } as any,
    },
  ]);
  expect(line.guests).toBe(2);
  expect(line.pickupLabel).toBe('Crystals Beach Resort');
  expect(line.roomOrCabin).toBe('Room 214');
});

it('mapDaySchedule surfaces the booking room on a departure party', () => {
  // build a raw occurrence row whose booking has room_or_cabin: 'Room 5' → expect booking.roomOrCabin === 'Room 5'
});
```

(Extend an existing fixture in the file rather than hand-rolling every booking field — reuse the test's booking-builder helper if present.)

- [ ] **Step 2: Run to verify fail.** FAIL (`guests`/`pickupLabel`/`roomOrCabin` undefined).

- [ ] **Step 3: Implement** in `calendar.ts`:
  - `DayCustomLine`: add `guests: number | null;`, `pickupLabel: string | null;`, `roomOrCabin: string | null;`.
  - `DayBooking`: add `roomOrCabin: string | null;`.
  - `RawDayCustomItem`: add `guests: number | null;`, `pickup_label?: string | null;`.
  - `RawDayBooking` already extends `RawTransferFields` (has `room_or_cabin`) — no change.
  - `mapDayCustomLines`: in the pushed object add `guests: raw.guests ?? null, pickupLabel: raw.pickup_label ?? null, roomOrCabin: b.room_or_cabin ?? null,`.
  - `mapDaySchedule`: in the `bookings.push({...})` object add `roomOrCabin: b.room_or_cabin ?? null,`.
  - Both `booking_custom_items` select strings (in `loadDaySchedule` and `loadCustomLinesByDay`): add `guests, pickup_label` to the column list (after `transport_dropoff_label`).

- [ ] **Step 4: Run to verify pass.** `npx vitest run tests/unit/admin-calendar.test.ts` → PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(calendar): surface custom-line guests/pickup + booking room on the day sheet"`

---

### Task 5: Pickup/drop-off resolver + day-sheet run sheet

**Files:** Modify `src/components/admin/BookingFacts.tsx`, `src/components/admin/AdminCalendar.tsx`; Test `tests/unit/booking-facts.test.ts` (create if absent).

- [ ] **Step 1: Write failing test** for a pure resolver that fixes the contradiction:

```ts
import { resolvePickup } from '@/components/admin/BookingFacts';

it('a round-trip transport add-on IS the pickup; drop-off is same as pickup', () => {
  const r = resolvePickup({
    pickupLocation: null,
    dropoffLocation: null,
    pickupPending: false,
    transportPickup: 'Coastal Road, Quatre Cocos',
    transportDropoff: null,
  });
  expect(r.pickup).toEqual({ kind: 'text', text: 'Coastal Road, Quatre Cocos', roundTrip: true });
  expect(r.dropoff).toEqual({ kind: 'same' });
});

it('no pickup and no transfer reads as make-own-way / dash', () => {
  const r = resolvePickup({ pickupLocation: null, dropoffLocation: null, pickupPending: false });
  expect(r.pickup).toEqual({ kind: 'none' });
  expect(r.dropoff).toEqual({ kind: 'dash' });
});

it('an explicit booking pickup still wins and keeps its own drop-off', () => {
  const r = resolvePickup({
    pickupLocation: 'Hotel A',
    dropoffLocation: 'Airport',
    pickupPending: false,
  });
  expect(r.pickup).toEqual({ kind: 'text', text: 'Hotel A', roundTrip: false });
  expect(r.dropoff).toEqual({ kind: 'text', text: 'Airport' });
});
```

- [ ] **Step 2: Run to verify fail.** FAIL (`resolvePickup` not exported).

- [ ] **Step 3: Implement `resolvePickup`** in `BookingFacts.tsx` and render `PickupFacts` from it. Signature + rule:

```ts
export type PickupView =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'text'; text: string; roundTrip: boolean };
export type DropoffView = { kind: 'dash' } | { kind: 'same' } | { kind: 'text'; text: string };

/** ONE reading of "where do we collect this guest, and where do we leave them", shared by the day
 *  sheet and the bookings drawer. A round-trip transport add-on (transportPickup) IS the pickup when
 *  the booking has no explicit pickup of its own, and a round trip returns to that same place — so it
 *  must never read "No pickup" beside a "Round-trip transfer" line (the day-sheet contradiction). */
export function resolvePickup(b: {
  pickupLocation: string | null;
  dropoffLocation: string | null;
  pickupPending: boolean;
  transportPickup?: string | null;
  transportDropoff?: string | null;
}): { pickup: PickupView; dropoff: DropoffView } {
  const roundTrip = !b.pickupLocation && !!b.transportPickup;
  const pickup: PickupView = b.pickupLocation
    ? { kind: 'text', text: b.pickupLocation, roundTrip: false }
    : b.transportPickup
      ? { kind: 'text', text: b.transportPickup, roundTrip: true }
      : b.pickupPending
        ? { kind: 'pending' }
        : { kind: 'none' };
  const explicitDropoff = b.dropoffLocation ?? (roundTrip ? (b.transportDropoff ?? null) : null);
  const dropoff: DropoffView = explicitDropoff
    ? { kind: 'text', text: explicitDropoff }
    : pickup.kind === 'text' || pickup.kind === 'pending'
      ? { kind: 'same' }
      : { kind: 'dash' };
  return { pickup, dropoff };
}
```

Then extend `PickupFacts` to accept optional `transportPickup?`, `transportDropoff?`, `roomOrCabin?`, render pickup/drop-off via `resolvePickup` (a `roundTrip` pickup appends a "· round-trip transfer" caption; `same` drop-off reads "Same as pickup"), and render a **Room** line when `roomOrCabin` is set. The existing `AdminBookings.tsx` call site passes none of the new props → renders exactly as today (the round-trip caption/room only appear when supplied).

- [ ] **Step 4: Wire `AdminCalendar.tsx`.**
  - In `GuestRow`'s "Pickup & drop-off" `Fact`, replace the current `<PickupFacts …/>` + separate "Round-trip transfer" `<p>` with a single `<PickupFacts pickupLocation={booking.pickupLocation} dropoffLocation={booking.dropoffLocation} pickupPending={booking.pickupPending} transportPickup={booking.transportPickup} transportDropoff={booking.transportDropoff} roomOrCabin={booking.roomOrCabin} />`.
  - In `CustomLineCard`, add a run-sheet block under the header: guests (`{line.guests} guest{s}` when set), pickup via `<PickupFacts pickupLocation={line.pickupLabel} dropoffLocation={null} pickupPending={false} transportPickup={line.transportPickup} transportDropoff={line.transportDropoff} roomOrCabin={line.roomOrCabin} />` (pass `line.pickupLabel` as the explicit pickup; the transport add-on still shows as round-trip when there is no `pickupLabel`), and keep the existing contact/price/link rows. Remove the now-duplicated standalone "Round-trip transfer · from …" `<p>` (it's rendered by `PickupFacts`).
  - Add a `Guests` chip/line to the custom card header row so it is visible without expanding.

- [ ] **Step 5: Run tests + typecheck.** `npx vitest run tests/unit/booking-facts.test.ts tests/unit/admin-calendar.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit.** `git commit -am "fix(calendar): round-trip transfer reads as pickup+same drop-off; custom card run sheet + room"`

---

### Task 6: Public checkout — room number on activity pickup

**Files:** Modify `src/components/checkout/Checkout.tsx`, `src/lib/i18n/messages.ts`; Test `tests/unit/checkout-selection.test.ts` if a payload builder is unit-testable (else rely on typecheck + manual verify).

- [ ] **Step 1: Add the room field to `pickupFields`.** Inside the `!tbd` branch of `pickupFields` (after the "Drop-off — same as pickup" toggle, ~line 1347), add — reusing the EXISTING `roomOrCabin` state and the EXISTING i18n strings `'Room / cabin number'`, `'optional'`, `'e.g. Room 214 or Cabin 8B'`:

```tsx
<label className="mt-3 block text-[13px] font-semibold text-ink">
  {t('Room / cabin number')} <span className="font-normal text-ink-muted">({t('optional')})</span>
  <input
    value={roomOrCabin}
    onChange={(e) => setRoomOrCabin(e.target.value)}
    placeholder={t('e.g. Room 214 or Cabin 8B')}
    className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
  />
  <span className="mt-1 block text-[12px] text-ink-muted">
    {t('So the driver can arrange your hotel gate pass.')}
  </span>
</label>
```

- [ ] **Step 2: Send it for activity pickups.** At the payload build (~line 930), replace the `roomOrCabin:` line with:

```tsx
// Room is for the driver's gate pass — collected on any pickup: airport/hotel transfer OR an activity
// pickup the customer is actually entering (not "make own way", not TBD).
roomOrCabin:
  isAirport || isHotelTransfer
    ? roomOrCabin.trim() || null
    : wantsPickup && !tbd
      ? roomOrCabin.trim() || null
      : undefined,
```

(`undefined` — not `null` — when there is no pickup, so it never overwrites; matches the existing convention.)

- [ ] **Step 3: Add the one new FR string** in `src/lib/i18n/messages.ts` for `'So the driver can arrange your hotel gate pass.'` → e.g. `« Pour que le chauffeur puisse organiser votre laissez-passer à l'hôtel. »` (use a straight apostrophe or the project's established apostrophe convention — see [[gytm-french-localisation]]: curly vs straight fall back to English, so match how neighbouring keys are written). The three reused strings already exist in both locales.

- [ ] **Step 4: Typecheck + i18n parity.** `npx tsc --noEmit && npx vitest run tests/unit/i18n` (or the messages-parity test — grep `messages` under tests) → PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(checkout): collect a room number on activity pickups for the driver gate pass"`

---

### Task 7: Full gate + manual verification

- [ ] **Step 1: Typecheck.** `npx tsc --noEmit` → PASS.
- [ ] **Step 2: Lint.** `npm run lint` → PASS (watch the AI-tool-params + pickup-map-setter source-scan rules).
- [ ] **Step 3: Full test suite.** `npx vitest run` → PASS (all, incl. parity, resolved-function-bodies, enum-zod-parity, convert-quote integration).
- [ ] **Step 4: Build.** `npm run build` → PASS.
- [ ] **Step 5: Manual verify in the dev preview.** Open `/admin/calendar`, open a day with a custom line and with a round-trip-transfer departure. Confirm: the custom card shows guests + pickup hotel + room; the round-trip departure reads "Pickup: <hotel> · round-trip transfer" and "Drop-off: Same as pickup" (never "No pickup"/"—"). Screenshot for the user.
- [ ] **Step 6: Final commit / branch summary** (per `superpowers:finishing-a-development-branch`).

---

## Out of scope / follow-ups (note to the user, don't build without a nod)

- **Driver voucher PDF** (`src/lib/invoice/model.ts` + `voucher-pdf.ts`): show `room_or_cabin` and the custom-line pickup for non-transfer bookings. The calendar (the operator's run sheet) is the stated surface; the voucher is a natural next step.
- **GDPR:** `api_erase_user` already nulls `bookings.room_or_cabin`; it does not yet null the new `quotes.room_or_cabin` on a retained (converted) quote. Low-sensitivity (the booking — the retained financial record — is scrubbed), but worth folding into the anonymize UPDATE when `api_erase_user` is next re-applied.
- **AI email→quote** (`quote-draft.ts`): could populate `guests`/`pickupLabel` from an extracted enquiry. Left unchanged.

## Self-review notes

- Spec coverage: (1) custom-tour "how many people" → `guests` (Tasks 0–5); "hotel name" → `pickup_label` + transport pickup (Tasks 0,3,4,5); "start time" already shown. (2) room number both surfaces → `quotes.room_or_cabin`+guest pane (Tasks 0–3) and checkout (Task 6), shown on calendar (Tasks 4,5). (3) pickup/drop-off contradiction → `resolvePickup` (Task 5). ✔
- Type consistency: `guests: number|null`, `pickupLabel/pickup_label: string|null`, `roomOrCabin/room_or_cabin: string|null` used consistently across quotes.ts, state.ts, calendar.ts. `resolvePickup` view types shared between test and component. ✔
- Money path: `guests` is never read by `PricedLine`/`lineSubtotalMinor`/`transportFareMinorOf`/`quote_total_mismatch`. ✔
