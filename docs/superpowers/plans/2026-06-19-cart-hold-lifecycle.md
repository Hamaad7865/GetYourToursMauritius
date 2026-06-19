# Cart & Hold Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saved tours gather in the cart locking nothing; **Checkout** reserves every line's spot (a real ~30-min server hold); held lines live in the cart with a live countdown so leaving checkout never loses them; on expiry they drop out and a navbar bell notifies the user; come back before 30 min → pay from the cart. Inventory is never oversold and the cart never shows a spot the server already released.

**Architecture:** The cart stays a client `localStorage` store (`src/lib/cart/useCart.ts`); we add `status/holdId/expiresAt/idemKey` to each line and change expiry so **saved** lines persist while **held** lines expire by their server `expiresAt`. Checkout calls the existing `POST /api/v1/holds` per line. A new owner-scoped `api_release_hold` + `GET /api/v1/holds/[id]` let the cart release a removed line and reconcile against the server on load. A tiny client notifications store feeds a navbar bell. No server push, no new tables beyond a `created_by` column on `booking_holds`.

**Tech Stack:** Next.js 15 App Router (edge routes), TypeScript strict, Supabase Postgres RPCs, Zod, Vitest (+ PGlite integration harness), Tailwind.

**Design source:** `docs/superpowers/specs/2026-06-19-cart-hold-lifecycle-design.md`. The checkout-flow redesign and admin visibility are a SEPARATE spec — out of scope here.

---

## File structure

**Create:**
- `supabase/migrations/20260720120000_hold_release_authz.sql` — `created_by` on `booking_holds`; `create_hold`/`api_create_hold` set it; owner RLS select policy; `api_release_hold(holdId)`; grants.
- `src/lib/cart/cart-holds.ts` — pure reducer helpers for hold state (`markHeld`, `markUnavailable`, `dropExpiredHolds`, `expiringSoon`).
- `src/lib/cart/holdClient.ts` — browser fetch helpers (`createHoldsForLines`, `getHoldStatus`, `releaseHoldRequest`).
- `src/lib/notifications/inbox.ts` — client notifications store (`useInbox`, `pushNotification`, pure helpers).
- `src/components/site/NotificationsBell.tsx` — navbar bell + dropdown.
- `app/api/v1/holds/[id]/release/route.ts` — owner-scoped release endpoint.
- `app/api/v1/holds/[id]/route.ts` — owner-scoped GET hold status (for reconcile).
- Tests: `tests/unit/cart-holds.test.ts`, `tests/unit/notifications-inbox.test.ts`, `tests/integration/hold-release.test.ts`.

**Modify:**
- `src/lib/cart/useCart.ts` — extend `CartItem`; new expiry model; expose `markHeld`/`markUnavailable`/`removeHeld`/`reconcile`.
- `src/lib/services/holds.ts` — add `releaseHold(ctx, holdId)` and `getHold(ctx, holdId)`.
- `src/lib/validation/booking.ts` — add `holdStatusSchema`.
- `src/lib/openapi/registry.ts` — register the two new `/holds/{id}` paths.
- `src/components/gyg/GygHeader.tsx` — mount `<NotificationsBell/>` in the right-side nav.
- `app/cart/page.tsx` (+ its cart component) — Checkout creates holds (skip sold-out + notify), held lines show countdown, remove releases the hold.
- `supabase/catch-up.sql` — append everything from the new migration (owner re-runs on the live DB).

---

## Task 1: Cart line gains hold state + new expiry model

**Files:**
- Modify: `src/lib/cart/useCart.ts`
- Create: `src/lib/cart/cart-holds.ts`
- Test: `tests/unit/cart-holds.test.ts`

The current store auto-expires EVERY line 30 min after `addedAt`. New model: **saved** lines persist; **held** lines expire by their server `expiresAt`; **unavailable** lines are shown briefly then cleared.

- [ ] **Step 1: Write the failing test** — `tests/unit/cart-holds.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { dropExpiredHolds, expiringSoon, markHeld, markUnavailable } from '@/lib/cart/cart-holds';
import type { CartItem } from '@/lib/cart/useCart';

const line = (over: Partial<CartItem> = {}): CartItem => ({
  id: 'occ#Adult', slug: 's', title: 'T', image: null, occurrenceId: 'occ',
  dateLabel: 'Mon', lang: 'English', priceLabel: 'Adult', guests: 2, unitEur: 50,
  pricingMode: 'per_person', maxGuests: null, seatsLeft: 10, unit: 'per person',
  addedAt: 0, status: 'saved', idemKey: 'k1', ...over,
});

const NOW = 1_000_000;

describe('dropExpiredHolds', () => {
  it('keeps saved lines regardless of age', () => {
    const items = [line({ status: 'saved', addedAt: 0 })];
    expect(dropExpiredHolds(items, NOW).kept).toHaveLength(1);
  });
  it('keeps held lines whose expiresAt is in the future', () => {
    const items = [line({ status: 'held', holdId: 'h1', expiresAt: new Date(NOW + 60_000).toISOString() })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(1);
    expect(r.expired).toHaveLength(0);
  });
  it('drops held lines whose expiresAt has passed and reports them', () => {
    const items = [line({ status: 'held', holdId: 'h1', expiresAt: new Date(NOW - 1).toISOString() })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(0);
    expect(r.expired.map((i) => i.id)).toEqual(['occ#Adult']);
  });
  it('drops unavailable lines and reports them', () => {
    const items = [line({ status: 'unavailable' })];
    const r = dropExpiredHolds(items, NOW);
    expect(r.kept).toHaveLength(0);
    expect(r.unavailable.map((i) => i.id)).toEqual(['occ#Adult']);
  });
});

describe('markHeld / markUnavailable', () => {
  it('markHeld stamps holdId + expiresAt and flips status', () => {
    const next = markHeld([line()], 'occ#Adult', { holdId: 'h9', expiresAt: 'iso' });
    expect(next[0]).toMatchObject({ status: 'held', holdId: 'h9', expiresAt: 'iso' });
  });
  it('markUnavailable flips status and clears any hold', () => {
    const next = markUnavailable([line({ status: 'held', holdId: 'h9' })], 'occ#Adult');
    expect(next[0]).toMatchObject({ status: 'unavailable', holdId: undefined });
  });
});

describe('expiringSoon', () => {
  it('flags a held line within the 5-minute window', () => {
    const soon = line({ status: 'held', holdId: 'h', expiresAt: new Date(NOW + 4 * 60_000).toISOString() });
    const far = line({ id: 'x', status: 'held', holdId: 'h', expiresAt: new Date(NOW + 10 * 60_000).toISOString() });
    expect(expiringSoon([soon, far], NOW).map((i) => i.id)).toEqual(['occ#Adult']);
  });
});
```

- [ ] **Step 2: Run it, expect failure** — `npx vitest run tests/unit/cart-holds.test.ts` → FAIL (`@/lib/cart/cart-holds` not found).

- [ ] **Step 3: Add the `CartItem` fields** in `src/lib/cart/useCart.ts` — extend the interface (keep existing fields):

```typescript
export type CartLineStatus = 'saved' | 'held' | 'unavailable';
// add to interface CartItem:
  /** Saved (no hold) → held (server hold) → unavailable (sold out at checkout). */
  status: CartLineStatus;
  /** Server hold id + ISO expiry — present only when status === 'held'. */
  holdId?: string;
  expiresAt?: string;
  /** Stable idempotency anchor so re-running Checkout reuses the same hold. */
  idemKey: string;
```

In `add()`, default new lines to `status: 'saved'` and `idemKey: crypto.randomUUID()` (alongside the existing `addedAt`).

- [ ] **Step 4: Create the pure helpers** — `src/lib/cart/cart-holds.ts`:

```typescript
import type { CartItem } from './useCart';

export const EXPIRY_WARN_MS = 5 * 60 * 1000;

export interface ReconcileResult {
  kept: CartItem[];
  expired: CartItem[];
  unavailable: CartItem[];
}

/** Partition the cart: drop held lines whose server expiry passed and any 'unavailable' lines;
 *  keep saved lines (no expiry) and still-valid held lines. */
export function dropExpiredHolds(items: CartItem[], now: number): ReconcileResult {
  const kept: CartItem[] = [];
  const expired: CartItem[] = [];
  const unavailable: CartItem[] = [];
  for (const i of items) {
    if (i.status === 'unavailable') { unavailable.push(i); continue; }
    if (i.status === 'held' && i.expiresAt && new Date(i.expiresAt).getTime() <= now) {
      expired.push(i); continue;
    }
    kept.push(i);
  }
  return { kept, expired, unavailable };
}

export function markHeld(items: CartItem[], id: string, h: { holdId: string; expiresAt: string }): CartItem[] {
  return items.map((i) => (i.id === id ? { ...i, status: 'held', holdId: h.holdId, expiresAt: h.expiresAt } : i));
}

export function markUnavailable(items: CartItem[], id: string): CartItem[] {
  return items.map((i) => (i.id === id ? { ...i, status: 'unavailable', holdId: undefined, expiresAt: undefined } : i));
}

/** Held lines inside the warning window (and not yet expired). */
export function expiringSoon(items: CartItem[], now: number): CartItem[] {
  return items.filter((i) => {
    if (i.status !== 'held' || !i.expiresAt) return false;
    const ms = new Date(i.expiresAt).getTime() - now;
    return ms > 0 && ms <= EXPIRY_WARN_MS;
  });
}
```

- [ ] **Step 5: Replace the blanket TTL filter** in `useCart.ts`. Where it currently filters `addedAt`-expired items on read/interval, call `dropExpiredHolds(items, Date.now()).kept` instead so saved lines are never silently dropped. (The `expired`/`unavailable` arrays get wired to notifications in Task 7.) Keep the 15s interval but have it call `dropExpiredHolds`.

- [ ] **Step 6: Run tests + typecheck** — `npx vitest run tests/unit/cart-holds.test.ts` → PASS; `npm run typecheck` → clean (fix any callers constructing `CartItem` without `status`/`idemKey`).

- [ ] **Step 7: Commit**
```bash
git add src/lib/cart/useCart.ts src/lib/cart/cart-holds.ts tests/unit/cart-holds.test.ts
git commit -m "feat(cart): hold state on cart lines + expiry-by-hold model"
```

---

## Task 2: Notifications inbox store

**Files:**
- Create: `src/lib/notifications/inbox.ts`
- Test: `tests/unit/notifications-inbox.test.ts`

- [ ] **Step 1: Failing test** — `tests/unit/notifications-inbox.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { addNote, capNotes, unreadCount, type Note } from '@/lib/notifications/inbox';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1', type: 'expired', message: 'X expired', createdAt: 1, read: false, ...over,
});

describe('inbox helpers', () => {
  it('addNote prepends newest-first and dedupes by id', () => {
    const a = addNote([note({ id: 'n1' })], note({ id: 'n2', createdAt: 2 }));
    expect(a.map((n) => n.id)).toEqual(['n2', 'n1']);
    const b = addNote(a, note({ id: 'n2', createdAt: 2 }));
    expect(b).toHaveLength(2);
  });
  it('capNotes keeps only the newest 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => note({ id: `n${i}`, createdAt: i }));
    expect(capNotes(many)).toHaveLength(20);
  });
  it('unreadCount counts unread only', () => {
    expect(unreadCount([note({ read: false }), note({ id: 'n2', read: true })])).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/unit/notifications-inbox.test.ts`.

- [ ] **Step 3: Implement** `src/lib/notifications/inbox.ts` — mirror `useCart`'s localStorage + custom-event pattern (key `gytm:inbox`, a `gytm:inbox` window event for cross-component sync):

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';

export type NoteType = 'secured' | 'expiring' | 'expired' | 'unavailable';
export interface Note { id: string; type: NoteType; message: string; createdAt: number; read: boolean; }

const KEY = 'gytm:inbox';
const EVENT = 'gytm:inbox';
const CAP = 20;

export function addNote(notes: Note[], n: Note): Note[] {
  if (notes.some((x) => x.id === n.id)) return notes;
  return [n, ...notes];
}
export function capNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, CAP);
}
export function unreadCount(notes: Note[]): number {
  return notes.filter((n) => !n.read).length;
}

function read(): Note[] {
  if (typeof window === 'undefined') return [];
  try { return capNotes(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Note[]); } catch { return []; }
}
function write(notes: Note[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capNotes(notes)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* private mode — ignore */ }
}

/** Imperative push (callable outside React, e.g. from the cart reconcile). De-dupes by id. */
export function pushNotification(type: NoteType, message: string, id?: string): void {
  if (typeof window === 'undefined') return;
  const n: Note = { id: id ?? `${type}:${message}:${Date.now()}`, type, message, createdAt: Date.now(), read: false };
  write(addNote(read(), n));
}

export function useInbox() {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    const sync = () => setNotes(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const markAllRead = useCallback(() => write(read().map((n) => ({ ...n, read: true }))), []);
  const clear = useCallback(() => write([]), []);
  return { notes, unread: unreadCount(notes), markAllRead, clear };
}
```

- [ ] **Step 4: Run tests + typecheck** → PASS / clean.
- [ ] **Step 5: Commit**
```bash
git add src/lib/notifications/inbox.ts tests/unit/notifications-inbox.test.ts
git commit -m "feat(notifications): client inbox store for hold alerts"
```

---

## Task 3: Notifications bell in the navbar

**Files:**
- Create: `src/components/site/NotificationsBell.tsx`
- Modify: `src/components/gyg/GygHeader.tsx`

No new test (presentational; logic is covered by Task 2). Verify in the browser.

- [ ] **Step 1: Build the bell** — `src/components/site/NotificationsBell.tsx` (client). Use an existing bell glyph from `@/components/ui/icons` if present, else an inline SVG. Mirror `CartAction`'s badge styling (coral pill). Dropdown toggled on click, lists `notes` newest-first, `markAllRead` on open, empty state "No notifications yet."

```tsx
'use client';
import { useState } from 'react';
import { useInbox } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';

export function NotificationsBell() {
  const { notes, unread, markAllRead } = useInbox();
  const t = useT();
  const [open, setOpen] = useState(false);
  const toggle = () => { setOpen((o) => { if (!o) markAllRead(); return !o; }); };
  return (
    <div className="relative">
      <button type="button" onClick={toggle} aria-label={t('Notifications')} className="relative grid place-items-center">
        {/* bell icon */}
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-2 -top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold leading-none text-ink">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-ink/10 bg-white p-2 shadow-xl">
          {notes.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">{t('No notifications yet')}</p>
          ) : (
            <ul className="max-h-96 overflow-auto">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream">{n.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it** in `src/components/gyg/GygHeader.tsx` right-side nav row, before the Profile menu (next to `CartAction`): `<NotificationsBell />`. Match the existing spacing/wrapping of the sibling actions.

- [ ] **Step 3: Add i18n** — append French keys to `src/lib/i18n/messages.ts`: `"Notifications": "Notifications"`, `"No notifications yet": "Aucune notification pour l’instant"`.

- [ ] **Step 4: Typecheck + lint** → clean.
- [ ] **Step 5: Commit**
```bash
git add src/components/site/NotificationsBell.tsx src/components/gyg/GygHeader.tsx src/lib/i18n/messages.ts
git commit -m "feat(notifications): navbar bell"
```

---

## Task 4: Owner-scoped hold release (SQL)

**Files:**
- Create: `supabase/migrations/20260720120000_hold_release_authz.sql`
- Modify: `supabase/catch-up.sql`
- Test: `tests/integration/hold-release.test.ts`

Holds have no owner today, which is exactly why `release_hold` was revoked. Add `created_by`, set it on create, and authorize release against it. Migration is dated AFTER the latest (`20260719120000`) so it can't be reverted by filename order (see the migration-revert-drift gotcha).

- [ ] **Step 1: Failing integration test** — `tests/integration/hold-release.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

const ALICE = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const BOB = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

async function used(db: TestDb, occ: string): Promise<number> {
  const { rows } = await db.pg.query<{ n: number }>(`select used_capacity($1) as n`, [occ]);
  return Number(rows[0]!.n);
}

describe('api_release_hold — owner-scoped', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  it('stamps created_by, releases the owner hold and frees capacity', async () => {
    const { occurrenceId } = await seedOccurrence(db, 10);
    await db.as({ sub: ALICE, role: 'authenticated' });
    const { rows: made } = await db.pg.query<{ holdid: string }>(
      `select (api_create_hold(jsonb_build_object('occurrenceId',$1::text,'people',4,'idempotencyKey','k1')))->>'holdId' as holdid`,
      [occurrenceId],
    );
    const holdId = made[0]!.holdid;
    expect(await used(db, occurrenceId)).toBe(4);

    await db.pg.query(`select api_release_hold($1)`, [holdId]);
    expect(await used(db, occurrenceId)).toBe(0);
  });

  it("refuses to release another user's hold", async () => {
    const { occurrenceId } = await seedOccurrence(db, 10);
    await db.as({ sub: ALICE, role: 'authenticated' });
    const { rows: made } = await db.pg.query<{ holdid: string }>(
      `select (api_create_hold(jsonb_build_object('occurrenceId',$1::text,'people',2,'idempotencyKey','k2')))->>'holdId' as holdid`,
      [occurrenceId],
    );
    const holdId = made[0]!.holdid;
    await db.as({ sub: BOB, role: 'authenticated' });
    await expect(db.pg.query(`select api_release_hold($1)`, [holdId])).rejects.toThrow(/forbidden|hold_not_found/);
    await db.as({ sub: ALICE, role: 'authenticated' });
    expect(await used(db, occurrenceId)).toBe(2); // still held
  });
});
```

> Note: confirm `api_create_hold` exists and returns `{ holdId, … }` (it's the wrapper `createHold` calls). If its name/shape differs, align the test to the real wrapper before implementing.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/integration/hold-release.test.ts`.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260720120000_hold_release_authz.sql`:

```sql
-- Owner-scoped hold release for the cart lifecycle. Holds previously had no owner, so release_hold
-- was revoked from authenticated (a leaked hold id could cancel anyone's reservation). Stamp the
-- creator on every hold and authorize release/visibility against it.

alter table booking_holds add column if not exists created_by uuid;

-- Stamp created_by = auth.uid() on creation. create_hold is SECURITY DEFINER, so auth.uid() is the
-- calling user (NULL for anonymous holds, which simply can't be released by a user — they expire).
create or replace function create_hold(p_occurrence_id uuid, p_quantity int, p_idempotency_key text)
returns booking_holds
language plpgsql security definer set search_path = public as $$
declare v_hold booking_holds; v_cap int; v_used int;
begin
  perform 1 from session_occurrences where id = p_occurrence_id for update;
  select * into v_hold from booking_holds where idempotency_key = p_idempotency_key;
  if found then return v_hold; end if;
  select capacity into v_cap from session_occurrences where id = p_occurrence_id;
  select used_capacity(p_occurrence_id) into v_used;
  if v_used + p_quantity > v_cap then raise exception 'insufficient_capacity'; end if;
  insert into booking_holds (session_occurrence_id, quantity, idempotency_key, created_by)
  values (p_occurrence_id, p_quantity, p_idempotency_key, auth.uid())
  returning * into v_hold;
  return v_hold;
end; $$;
```

> Replace the body with the CURRENT `create_hold` body (copy from `supabase/migrations/20260615120700_functions.sql`) and add only `created_by` to the INSERT + `, auth.uid()` to VALUES. Do NOT hand-rewrite the capacity logic from memory — copy it verbatim so the audited oversell guard is preserved.

```sql
-- RLS: a user can see their own holds (needed for the reconcile GET).
alter table booking_holds enable row level security;
drop policy if exists holds_owner_select on booking_holds;
create policy holds_owner_select on booking_holds for select
  using (created_by is not null and created_by = auth.uid());

-- Owner-scoped release.
create or replace function api_release_hold(p_hold_id uuid)
returns booking_holds
language plpgsql security definer set search_path = public as $$
declare v_hold booking_holds;
begin
  select * into v_hold from booking_holds where id = p_hold_id;
  if not found then raise exception 'hold_not_found'; end if;
  if not (is_staff() or (auth.uid() is not null and v_hold.created_by = auth.uid())) then
    raise exception 'forbidden';
  end if;
  update booking_holds set status = 'released' where id = p_hold_id and status = 'active'
    returning * into v_hold;
  if not found then
    select * into v_hold from booking_holds where id = p_hold_id; -- already released/expired: idempotent no-op
  end if;
  return v_hold;
end; $$;

revoke execute on function api_release_hold(uuid) from public;
grant execute on function api_release_hold(uuid) to authenticated, service_role;
```

> If `api_create_hold` (the JSON wrapper) builds the hold itself rather than calling `create_hold`, also `create or replace` it here to pass/stamp `created_by`. Verify against `20260615121200_api_functions.sql`.

- [ ] **Step 4: Run the test** → PASS. If the parity test (`tests/integration/catch-up-parity.test.ts`) fails, that's expected until Step 5.

- [ ] **Step 5: Mirror into `supabase/catch-up.sql`** — append the same `alter table` (idempotent `if not exists`), the `create_hold`/`api_create_hold` redefinitions, the RLS policy (`drop policy if exists` + `create policy`), the `api_release_hold` function, and its grants, before the final `commit;`. Run `npx vitest run tests/integration/catch-up-parity.test.ts` → PASS.

- [ ] **Step 6: Commit**
```bash
git add supabase/migrations/20260720120000_hold_release_authz.sql supabase/catch-up.sql tests/integration/hold-release.test.ts
git commit -m "feat(holds): owner-scoped api_release_hold + created_by + RLS"
```

---

## Task 5: Release + status endpoints and service functions

**Files:**
- Modify: `src/lib/services/holds.ts`, `src/lib/validation/booking.ts`, `src/lib/openapi/registry.ts`
- Create: `app/api/v1/holds/[id]/release/route.ts`, `app/api/v1/holds/[id]/route.ts`

- [ ] **Step 1: Add the status schema** — in `src/lib/validation/booking.ts`:

```typescript
export const holdStatusSchema = z.object({
  holdId: z.string(),
  status: z.string(),       // 'active' | 'released' | 'expired' | 'booked'
  expiresAt: z.string().nullable(),
});
export type HoldStatus = z.infer<typeof holdStatusSchema>;
```

- [ ] **Step 2: Add service functions** — in `src/lib/services/holds.ts` (mirror the existing `createHold`):

```typescript
import { holdStatusSchema, type HoldStatus } from '@/lib/validation/booking';

/** Release a hold the caller owns (frees the reserved capacity). Idempotent. */
export async function releaseHold(ctx: ServiceContext, holdId: string): Promise<void> {
  await callRpc(ctx, 'api_release_hold', { holdId });
}

/** Read a hold's status (owner-scoped via RLS). Returns null when not found / not owned. */
export async function getHold(ctx: ServiceContext, holdId: string): Promise<HoldStatus | null> {
  const rows = await ctx.db
    .from('booking_holds')
    .select('id, status, expires_at')
    .eq('id', holdId)
    .maybeSingle();
  if (!rows) return null;
  return holdStatusSchema.parse({ holdId: rows.id, status: rows.status, expiresAt: rows.expires_at });
}
```

> If `ctx.db` is the rpc-only transport (no `.from`), add a tiny `api_get_hold(holdId)` RPC in Task 4's migration instead and call it via `callRpc`. Check `src/lib/services/rpc.ts` / `ServiceContext` shape and pick whichever the codebase already uses for owner-scoped reads.

- [ ] **Step 3: Release route** — `app/api/v1/holds/[id]/release/route.ts` (mirror `app/api/v1/bookings/route.ts`, but `requireUser` and read the dynamic `id`):

```typescript
import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { releaseHold } from '@/lib/services/holds';

export const runtime = 'edge';

export const POST = apiHandler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  await requireUser(req);
  const { id } = await params;
  const ctx = buildServiceContext(req);
  await releaseHold(ctx, id);
  return jsonOk({ released: true });
});

export function OPTIONS(req: Request): Response { return preflightResponse(req); }
```

- [ ] **Step 4: Status route** — `app/api/v1/holds/[id]/route.ts`:

```typescript
import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getHold } from '@/lib/services/holds';

export const runtime = 'edge';

export const GET = apiHandler(async (req, { params }: { params: Promise<{ id: string }> }) => {
  await requireUser(req);
  const { id } = await params;
  const ctx = buildServiceContext(req);
  const hold = await getHold(ctx, id);
  if (!hold) return jsonError(404, 'not_found', 'Hold not found');
  return jsonOk(hold);
});

export function OPTIONS(req: Request): Response { return preflightResponse(req); }
```

- [ ] **Step 5: Register in OpenAPI** — add `/holds/{id}` (GET → `holdStatusSchema`) and `/holds/{id}/release` (POST → `{released: bool}`) to `src/lib/openapi/registry.ts` so `tests/unit/openapi.test.ts` passes; then `npm run openapi:write`.

- [ ] **Step 6: Typecheck + lint + the openapi test** → clean/PASS.
- [ ] **Step 7: Commit**
```bash
git add src/lib/services/holds.ts src/lib/validation/booking.ts src/lib/openapi/registry.ts "app/api/v1/holds/[id]" openapi.json
git commit -m "feat(holds): release + status endpoints"
```

---

## Task 6: Browser hold client (create / status / release)

**Files:**
- Create: `src/lib/cart/holdClient.ts`

Thin `fetch` wrappers used by the cart, sending the Supabase access token. No new test (covered end-to-end by Task 7's wiring + the endpoint integration tests); keep it tiny.

- [ ] **Step 1: Implement** `src/lib/cart/holdClient.ts`:

```typescript
'use client';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import type { CartItem } from './useCart';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token ? { 'content-type': 'application/json', authorization: `Bearer ${token}` } : { 'content-type': 'application/json' };
}

export interface HoldOutcome { id: string; ok: boolean; holdId?: string; expiresAt?: string; }

/** Create a hold per saved line. Resolves per-line so the caller can mark held vs unavailable. */
export async function createHoldsForLines(items: CartItem[]): Promise<HoldOutcome[]> {
  const headers = await authHeaders();
  return Promise.all(items.map(async (i) => {
    try {
      const res = await fetch('/api/v1/holds', {
        method: 'POST', headers,
        body: JSON.stringify({ occurrenceId: i.occurrenceId, expectedSlug: i.slug, people: i.guests, idempotencyKey: i.idemKey }),
      }).then((r) => r.json());
      if (res.ok && res.data?.holdId) return { id: i.id, ok: true, holdId: res.data.holdId, expiresAt: res.data.expiresAt };
      return { id: i.id, ok: false };
    } catch { return { id: i.id, ok: false }; }
  }));
}

export async function getHoldStatus(holdId: string): Promise<{ status: string; expiresAt: string | null } | null> {
  const res = await fetch(`/api/v1/holds/${holdId}`, { headers: await authHeaders() }).then((r) => r.json());
  return res.ok ? { status: res.data.status, expiresAt: res.data.expiresAt } : null;
}

export async function releaseHoldRequest(holdId: string): Promise<void> {
  await fetch(`/api/v1/holds/${holdId}/release`, { method: 'POST', headers: await authHeaders() }).catch(() => {});
}
```

- [ ] **Step 2: Typecheck** → clean.
- [ ] **Step 3: Commit**
```bash
git add src/lib/cart/holdClient.ts
git commit -m "feat(cart): browser hold client (create/status/release)"
```

---

## Task 7: Wire the lifecycle into the cart store + cart page

**Files:**
- Modify: `src/lib/cart/useCart.ts`, `app/cart/page.tsx` (+ the cart list component it renders)

This is the integration task. Read `app/cart/page.tsx` first to see how lines render today; follow its structure.

- [ ] **Step 1: Expose lifecycle ops from `useCart`** — add to the hook's return:
  - `markHeld(id, {holdId, expiresAt})` / `markUnavailable(id)` (write via the Task-1 helpers).
  - `removeHeld(id)` — look up the line; if `status === 'held' && holdId`, call `releaseHoldRequest(holdId)` (fire-and-forget) then remove; saved lines just remove (reuse existing `remove`).
  - `reconcile()` — `const { kept, expired, unavailable } = dropExpiredHolds(items, Date.now())`; for each `expired`/`unavailable`, `pushNotification('expired'|'unavailable', \`${i.title} — held spot expired\`, \`expired:${i.holdId ?? i.id}\`)`; write `kept`. Call `reconcile()` from the existing 15s interval and on mount, REPLACING the old blanket TTL filter.
  - On mount, also verify still-future held lines against the server: for each `held` line call `getHoldStatus(holdId)`; if it returns `released`/`expired`/null, drop it + notify. (Keeps the "never show a released spot" guarantee from the spec.)

- [ ] **Step 2: Checkout button creates holds** — in the cart page's "Checkout" handler:

```typescript
const saved = items.filter((i) => i.status !== 'unavailable');
const outcomes = await createHoldsForLines(saved);
let anyHeld = false, anySoldOut = false;
for (const o of outcomes) {
  if (o.ok && o.holdId && o.expiresAt) { markHeld(o.id, { holdId: o.holdId, expiresAt: o.expiresAt }); anyHeld = true; }
  else { markUnavailable(o.id); anySoldOut = true; }
}
if (anySoldOut) pushNotification('unavailable', t('Some spots sold out and were skipped.'));
if (anyHeld) {
  pushNotification('secured', t('Spots secured — pay within 30 minutes.'));
  router.push('/checkout?from=cart'); // hand off to the checkout flow (separate spec)
}
```

- [ ] **Step 3: Render held state** — for `held` lines show a live countdown from `expiresAt` (reuse the timer pattern in `src/components/checkout/Checkout.tsx`); for `unavailable` lines show a "No longer available" pill + a remove action; "Remove" calls `removeHeld(id)`.

- [ ] **Step 4: Manual verification** (dev server): add two tours → cart shows them as saved (no timer); click Checkout → both become held with a countdown, "Spots secured" appears in the bell; navigate away and back → still there; let one expire (or force a past `expiresAt` in devtools) → it drops + an "expired" bell note; remove a held line → it disappears and (Network tab) a `POST /holds/{id}/release` fires.

- [ ] **Step 5: Typecheck + lint + full unit/integration suite** — `npm run typecheck && npm run lint && npx vitest run` → all green.

- [ ] **Step 6: Commit**
```bash
git add src/lib/cart/useCart.ts app/cart
git commit -m "feat(cart): hold lifecycle wiring — checkout holds, reconcile, release, notify"
```

---

## Task 8: Green gate + review

**Files:** none (verification)

- [ ] **Step 1:** `npm run typecheck && npm run lint && npx vitest run` → all green (308 + new tests).
- [ ] **Step 2:** Re-read the spec; confirm each decision (1–6) maps to a task. Note the one owner action: **re-run `supabase/catch-up.sql` on the live DB** (the `created_by` column + `api_release_hold` + RLS policy).
- [ ] **Step 3:** Request a code review (superpowers:requesting-code-review) focused on the oversell invariant (holds still reserve correctly), the release authz (can't release another user's hold), and the expiry/reconcile edges.
- [ ] **Step 4: Commit** any review fixes; the feature is done.

---

## Self-review (author)

**Spec coverage:** hold-at-checkout (Task 7 Step 2) ✓; localStorage + server reconcile (Task 1 + Task 7 Step 1 + Task 5 status endpoint) ✓; add-saves/checkout-holds-all (Task 7) ✓; lean client bell (Tasks 2–3) ✓; skip sold-out + continue (Task 7 Step 2) ✓; remove releases hold (Task 4 + Task 7 `removeHeld`) ✓; edge — expire during payment relies on existing `api_book` re-check (noted, no new work) ✓.

**Type consistency:** `CartItem.status/holdId/expiresAt/idemKey`, `markHeld/markUnavailable/dropExpiredHolds/expiringSoon`, `Note/NoteType/useInbox/pushNotification`, `holdStatusSchema/HoldStatus`, `createHoldsForLines/getHoldStatus/releaseHoldRequest`, `api_release_hold` — names are consistent across tasks.

**Open verification points flagged inline:** the exact `api_create_hold` wrapper shape (Task 4 note); whether `ctx.db` supports `.from` reads or needs an `api_get_hold` RPC (Task 5 Step 2). Resolve by reading the real files at execution time, not by guessing.
