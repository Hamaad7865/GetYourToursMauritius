# First-Visit Homepage Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the row under the homepage hero show each visitor tours they are likely to want — the tours of guides they read, tours still free tomorrow if they are in Mauritius, otherwise our real most-booked tours — without ever changing the row's height.

**Architecture:** One public Postgres function (`api_home_picks`) returns the shared, per-day data (most-booked order, tours with a free seat tomorrow). The server renders the "Most booked" row (what Google sees); in the browser a pure function, `chooseHomeRow`, picks the visitor's row from localStorage (guides read), a session flag / an uncached locality endpoint (on the island) and the picks, and swaps the tiles in the same footprint. Spec: `docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md`.

**Tech Stack:** Next.js 15 app router on Cloudflare Pages (edge runtime), Supabase Postgres (plpgsql, PGlite in tests), Zod + zod-openapi, React 19 client components, Tailwind 3.4, Vitest.

---

## Ground rules for whoever executes this

- Read `CLAUDE.md`, `docs/handbook/development.md` and `docs/handbook/landmines.md` first.
- Work directly on `main` (owner's rule). **Never `git add -A`** — add the exact files listed. The pre-commit hook rejects unformatted files, so run `npx prettier --write <files>` before each commit.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Do not push.** The owner wants this pushed only after the ~22 Oct homepage SEO re-measure (Task 10).
- Windows: use the Bash tool (Git Bash) for the commands below; PowerShell breaks heredocs.
- After each task's prettier step, re-run that task's tests before committing — prettier also reformats the TypeScript you just tested. (`openapi.json`, `supabase/catch-up.sql` and `supabase/setup.sql` are in `.prettierignore`; never format them.)

## File map

| File                                                                  | Responsibility                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `supabase/migrations/20261017130000_home_picks.sql` (new)             | `api_home_picks(p jsonb)` — most booked + free tomorrow                |
| `supabase/catch-up.sql`, `supabase/backfill-migration-ledger.sql`     | Mirror + ledger row for the migration                                  |
| `tests/db/rpc.ts`                                                     | Allow the new RPC in the PGlite adapter                                |
| `tests/integration/home-picks.test.ts` (new)                          | SQL behaviour of `api_home_picks`                                      |
| `src/lib/validation/home-picks.ts` (new)                              | Zod schema + type for the picks                                        |
| `src/lib/services/home-picks.ts` (new)                                | `homePicks(ctx)` service                                               |
| `app/api/v1/activities/picks/route.ts` (new)                          | Public, edge-cached `GET /api/v1/activities/picks`                     |
| `src/lib/openapi/registry.ts`, `openapi.json`                         | API contract                                                           |
| `tests/integration/home-picks-route.test.ts` (new)                    | Service + route                                                        |
| `src/lib/geo/visitor-country.ts`, `app/api/planner/locality/route.ts` | `onIsland` flag + dev-only `?as=` override                             |
| `src/lib/recent/interest.ts` (new)                                    | `gytm:interest` store (guides read)                                    |
| `src/lib/recent/on-island.ts` (new)                                   | `gytm:on-island` session flag                                          |
| `src/components/gyg/RecordInterest.tsx` (new)                         | Records a guide read; renders nothing                                  |
| `src/lib/content/tour-links.ts`                                       | `postInterestTopic()` — only posts with their own tours count          |
| 5 guide pages (attractions, blog, 3 topic hubs)                       | Mount `<RecordInterest>`                                               |
| `src/lib/catalogue/home-tours.ts`                                     | Export `homeTile()` (photo-or-nothing), reused by the new row          |
| `src/lib/catalogue/home-row.ts` (new)                                 | `chooseHomeRow`, `homeRowHeading`, `mauritiusTomorrow` — all the rules |
| `src/components/gyg/home/HomeToursRow.tsx` (new)                      | Client row: decides, swaps tiles, placeholders, Clear, analytics event |
| `src/components/gyg/home/HomeToursReserve.tsx` (new)                  | Pre-paint script that shows placeholders for known personal rows       |
| `src/components/gyg/home/HomeTours.tsx`                               | Becomes a thin server wrapper                                          |
| `src/components/gyg/home/ContinuePlanning.tsx`                        | Export `readContinuingSlugs`; "Clear viewed" also clears guides        |
| `app/(site)/page.tsx`                                                 | Loads picks in parallel with the catalogue                             |
| `src/lib/consent/gtag.ts`                                             | `pushDataLayerEvent()`                                                 |
| `src/lib/i18n/messages.ts`                                            | French for every new string                                            |
| `app/(site)/cookies/page.tsx`                                         | Discloses the browser-only lists                                       |
| `docs/handbook/landmines.md`                                          | Two new landmines                                                      |

---

### Task 1: `api_home_picks` in Postgres

**Files:**

- Create: `supabase/migrations/20261017130000_home_picks.sql`
- Create: `tests/integration/home-picks.test.ts`
- Modify: `tests/db/rpc.ts` (the `ALLOWED` set)
- Modify: `supabase/catch-up.sql` (append), `supabase/backfill-migration-ledger.sql`, regenerated `supabase/setup.sql`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/home-picks.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { seedOccurrence, type SeedResult } from '../db/seed';

/**
 * api_home_picks (20261017130000) — the shared data behind the homepage's first row
 * (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md):
 *   * mostBooked   — published tours ranked by confirmed/completed bookings made in the last 90 days,
 *                    test bookings by staff/admin/seo accounts excluded, ties in catalogue order;
 *   * freeTomorrow — tours with an open slot TOMORROW (Mauritius date) that still has a seat, under the
 *                    same rules as api_list_availability.
 * Assertions are relative (order between, or membership of, this file's own tours): the migrations seed
 * catalogue rows of their own.
 */

const STAFF = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
const SEO = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';

interface Tour extends SeedResult {
  slug: string;
}
interface Picks {
  date: string;
  mostBooked: string[];
  freeTomorrow: string[];
}
interface Target {
  occ: string;
  opt: string;
}

describe('api_home_picks', () => {
  let db: TestDb;
  let picks: Picks;
  let tomorrow: string;
  const t: Record<string, Tour> = {};

  /** A published tour with no slots yet. */
  async function tour(
    over: { minAdvance?: number; status?: string; sort?: number; extra?: object } = {},
  ): Promise<Tour> {
    const seeded = await seedOccurrence(db, 50);
    await db.pg.query(`delete from session_occurrences where id = $1`, [seeded.occurrenceId]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `update activities
          set min_advance_days = $2, status = $3, sort = $4,
              extra = coalesce(extra, '{}'::jsonb) || $5::jsonb
        where id = $1
        returning slug`,
      [
        seeded.activityId,
        over.minAdvance ?? 1,
        over.status ?? 'published',
        over.sort ?? 0,
        JSON.stringify(over.extra ?? {}),
      ],
    );
    return { ...seeded, slug: rows[0]!.slug };
  }

  /** A slot on (Mauritius today + dayOffset) at a Mauritius wall-clock time. */
  async function slot(
    x: Tour,
    dayOffset: number,
    time: string,
    capacity = 50,
    status = 'open',
  ): Promise<string> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
       values ($1, $2,
         (((now() at time zone 'Indian/Mauritius')::date + $3::int) + $4::time) at time zone 'Indian/Mauritius',
         (((now() at time zone 'Indian/Mauritius')::date + $3::int) + $4::time + interval '4 hours') at time zone 'Indian/Mauritius',
         $5, $6::occurrence_status)
       returning id`,
      [x.optionId, x.operatorId, dayOffset, time, capacity, status],
    );
    return rows[0]!.id;
  }

  async function book(
    target: Target,
    opts: {
      status?: string;
      userId?: string | null;
      daysAgo?: number;
      items?: number;
      quantity?: number;
    } = {},
  ): Promise<void> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status, created_at)
       values ($1, 'Guest', 'guest@example.com', 7500, $2::booking_status,
               now() - make_interval(days => $3::int))
       returning id`,
      [opts.userId ?? null, opts.status ?? 'confirmed', opts.daysAgo ?? 1],
    );
    for (let i = 0; i < (opts.items ?? 1); i++) {
      await db.pg.query(
        `insert into booking_items
           (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, $3, 'Adult', $4, 7500, 7500)`,
        [rows[0]!.id, target.occ, target.opt, opts.quantity ?? 1],
      );
    }
  }

  /** One slot five days out, to hang bookings on. */
  async function bookable(x: Tour): Promise<Target> {
    return { occ: await slot(x, 5, '10:00'), opt: x.optionId };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const [id, role] of [
      [STAFF, 'staff'],
      [SEO, 'seo'],
    ] as const) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Team', $2)`, [
        id,
        role,
      ]);
    }

    // ── Ranking ──
    t.top = await tour();
    t.second = await tour();
    t.tieLow = await tour({ sort: 1 });
    t.tieHigh = await tour({ sort: 2 });
    t.multiItem = await tour({ sort: 3 });
    t.cancelledOnly = await tour();
    t.oldOnly = await tour();
    t.staffOnly = await tour();
    t.draft = await tour({ status: 'draft' });

    const top = await bookable(t.top);
    for (let i = 0; i < 3; i++) await book(top);
    const second = await bookable(t.second);
    await book(second);
    await book(second, { status: 'completed' });
    await book(await bookable(t.tieLow));
    await book(await bookable(t.tieHigh));
    // ONE booking with three lines: it counts once, not three times.
    await book(await bookable(t.multiItem), { items: 3 });
    const cancelled = await bookable(t.cancelledOnly);
    for (const status of ['cancelled', 'expired', 'payment_pending', 'refunded']) {
      await book(cancelled, { status });
    }
    const old = await bookable(t.oldOnly);
    for (let i = 0; i < 4; i++) await book(old, { daysAgo: 100 });
    const staff = await bookable(t.staffOnly);
    for (let i = 0; i < 3; i++) await book(staff, { userId: STAFF });
    for (let i = 0; i < 3; i++) await book(staff, { userId: SEO });
    const draft = await bookable(t.draft);
    for (let i = 0; i < 4; i++) await book(draft);

    // ── Free tomorrow ──
    t.open = await tour();
    await slot(t.open, 1, '10:00');
    t.full = await tour();
    await book({ occ: await slot(t.full, 1, '10:00', 2), opt: t.full.optionId }, { quantity: 2 });
    t.closed = await tour();
    await slot(t.closed, 1, '10:00', 50, 'closed');
    t.notice = await tour({ minAdvance: 2 });
    await slot(t.notice, 1, '10:00');
    t.inquiry = await tour({ extra: { inquiryOnly: true } });
    await slot(t.inquiry, 1, '10:00');
    t.draftSlot = await tour({ status: 'draft' });
    await slot(t.draftSlot, 1, '10:00');
    t.earlyTomorrow = await tour();
    await slot(t.earlyTomorrow, 1, '00:30');
    t.dayAfter = await tour();
    await slot(t.dayAfter, 2, '00:30');
    t.today = await tour({ minAdvance: 0 });
    await slot(t.today, 0, '23:30');

    tomorrow = (
      await db.pg.query<{ d: string }>(
        `select to_char((now() at time zone 'Indian/Mauritius')::date + 1, 'YYYY-MM-DD') as d`,
      )
    ).rows[0]!.d;

    // Called as an anonymous visitor, like the homepage does.
    await db.as(null);
    picks = await pgliteRpc(db.pg).rpc<Picks>('api_home_picks', {});
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  it('is callable by anonymous visitors', async () => {
    const { rows } = await db.pg.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.api_home_picks(jsonb)', 'EXECUTE') as ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });

  it('names the Mauritius date its free-tomorrow list is about', () => {
    expect(picks.date).toBe(tomorrow);
  });

  it('ranks by distinct confirmed + completed bookings, ties in catalogue order', () => {
    const at = (x: Tour) => picks.mostBooked.indexOf(x.slug);
    for (const x of [t.top, t.second, t.tieLow, t.tieHigh, t.multiItem]) {
      expect(at(x), x.slug).toBeGreaterThanOrEqual(0);
    }
    expect(at(t.top)).toBeLessThan(at(t.second));
    expect(at(t.second)).toBeLessThan(at(t.tieLow));
    expect(at(t.tieLow)).toBeLessThan(at(t.tieHigh));
    // A booking with three lines counts once: multiItem ties the one-booking tours, on sort 3.
    expect(at(t.tieHigh)).toBeLessThan(at(t.multiItem));
  });

  it('leaves out unpaid or reversed bookings, old ones, team test bookings and unpublished tours', () => {
    for (const x of [t.cancelledOnly, t.oldOnly, t.staffOnly, t.draft]) {
      expect(picks.mostBooked, x.slug).not.toContain(x.slug);
    }
  });

  it('returns at most 24 ranked tours', () => {
    expect(picks.mostBooked.length).toBeLessThanOrEqual(24);
  });

  it('lists tours with a free seat tomorrow, Mauritius time', () => {
    expect(picks.freeTomorrow).toContain(t.open.slug);
    expect(picks.freeTomorrow).toContain(t.earlyTomorrow.slug); // 00:30 tomorrow
  });

  it('leaves out full, closed, too-short-notice, inquiry-only and unpublished tours, and other days', () => {
    for (const x of [
      t.full,
      t.closed,
      t.notice,
      t.inquiry,
      t.draftSlot,
      t.dayAfter, // 00:30 the day after tomorrow
      t.today, // 23:30 today
    ]) {
      expect(picks.freeTomorrow, x.slug).not.toContain(x.slug);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/integration/home-picks.test.ts`
Expected: FAIL in `beforeAll` with `unknown rpc api_home_picks`.

- [ ] **Step 3: Allow the RPC in the test adapter**

In `tests/db/rpc.ts`, add `'api_home_picks',` on a new line directly after `'api_release_pending_booking',` (the last entry of `ALLOWED`).

- [ ] **Step 4: Run again — now it fails in SQL**

Run: `npx vitest run tests/integration/home-picks.test.ts`
Expected: FAIL with `function api_home_picks(jsonb) does not exist`.

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/20261017130000_home_picks.sql`:

```sql
-- 20261017130000_home_picks
--
-- The homepage's first row (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). One
-- public read, identical for every visitor, so the route can cache it at the edge:
--   * mostBooked   — published tours ranked by the number of distinct bookings with status confirmed
--                    or completed made in the last 90 days. Bookings by staff/admin/seo accounts are
--                    test bookings and are left out. Ties break in catalogue order (sort, rating_count
--                    desc, title — api_search_activities' order). Only the order leaves this function,
--                    never the counts.
--   * freeTomorrow — published tours that can be booked online (not extra.inquiryOnly) with an OPEN slot
--                    TOMORROW, Mauritius date, that has not started and still has a seat. These are the
--                    rules of the winning api_list_availability body (20260728000000_activity_min_advance):
--                    status 'open', starts_at > now(), day >= today + min_advance_days, and
--                    capacity - used_capacity() > 0. Keep them in step if that body changes.
--   * date         — that tomorrow, so a cached answer read after midnight can be recognised as stale.
--
-- SECURITY DEFINER because anon cannot read bookings or profiles; it exposes slugs only.
-- Keep this file's SQL identical to the copy appended in supabase/catch-up.sql.

create or replace function api_home_picks(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Indian/Mauritius')::date;
  v_tomorrow date := v_today + 1;
  v_most jsonb;
  v_free jsonb;
begin
  select coalesce(jsonb_agg(r.slug order by r.n desc, r.sort, r.rating_count desc, r.title), '[]'::jsonb)
  into v_most
  from (
    select a.slug, a.sort, a.rating_count, a.title, count(distinct b.id) as n
    from bookings b
    join booking_items bi on bi.booking_id = b.id
    join activity_options o on o.id = bi.activity_option_id
    join activities a on a.id = o.activity_id
    left join profiles pr on pr.id = b.user_id
    where b.status in ('confirmed', 'completed')
      and b.created_at > now() - interval '90 days'
      and a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and coalesce(pr.role::text, 'customer') not in ('staff', 'admin', 'seo')
    group by a.id
    order by n desc, a.sort, a.rating_count desc, a.title
    limit 24
  ) r;

  select coalesce(jsonb_agg(x.slug order by x.sort, x.rating_count desc, x.title), '[]'::jsonb)
  into v_free
  from (
    select a.slug, a.sort, a.rating_count, a.title
    from activities a
    where a.status = 'published'
      and coalesce(a.is_custom_planner, false) = false
      and coalesce(a.extra -> 'inquiryOnly', 'false'::jsonb) <> 'true'::jsonb
      and v_tomorrow >= v_today + coalesce(a.min_advance_days, 1)
      and exists (
        select 1
        from session_occurrences so
        join activity_options o on o.id = so.activity_option_id
        where o.activity_id = a.id
          and so.status = 'open'
          and so.starts_at > now()
          and so.starts_at >= (v_tomorrow::timestamp at time zone 'Indian/Mauritius')
          and so.starts_at < ((v_tomorrow + 1)::timestamp at time zone 'Indian/Mauritius')
          and so.capacity - used_capacity(so.id) > 0
      )
  ) x;

  return jsonb_build_object(
    'date', to_char(v_tomorrow, 'YYYY-MM-DD'),
    'mostBooked', v_most,
    'freeTomorrow', v_free
  );
end;
$$;

revoke execute on function api_home_picks(jsonb) from public;
grant execute on function api_home_picks(jsonb) to anon, authenticated, service_role;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/integration/home-picks.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Mirror into catch-up.sql and the ledger**

```bash
{ printf '\n-- ---- migration 20261017130000_home_picks (homepage first row: most booked + free tomorrow) ----\n'; cat supabase/migrations/20261017130000_home_picks.sql; } >> supabase/catch-up.sql
```

In `supabase/backfill-migration-ledger.sql`, replace

```sql
  ('20261017120000', 'charge_currency_setting')
on conflict (version) do nothing;
```

with

```sql
  ('20261017120000', 'charge_currency_setting'),
  ('20261017130000', 'home_picks')
on conflict (version) do nothing;
```

Then regenerate the derived SQL (CLAUDE.md rule for every migration):

```bash
npm run seed:gen && npm run setup:sql
```

- [ ] **Step 8: Run the parity and ledger guards**

Run: `npx vitest run tests/integration/home-picks.test.ts tests/integration/catch-up-parity.test.ts tests/unit/migration-ledger.test.ts tests/integration/definer-grants-lockdown.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git status --short   # expect only the files below (plus .dev-tools/, never add it)
npx prettier --write tests/integration/home-picks.test.ts tests/db/rpc.ts
git add supabase/migrations/20261017130000_home_picks.sql supabase/catch-up.sql supabase/backfill-migration-ledger.sql supabase/setup.sql tests/db/rpc.ts tests/integration/home-picks.test.ts
# also add supabase/seed.sql if `git status` shows seed:gen changed it
git commit -F - <<'EOF'
feat(db): api_home_picks — most-booked tours and tours with a free seat tomorrow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Picks schema, service, public route and API contract

**Files:**

- Create: `src/lib/validation/home-picks.ts`
- Create: `src/lib/services/home-picks.ts`
- Create: `app/api/v1/activities/picks/route.ts`
- Create: `tests/integration/home-picks-route.test.ts`
- Modify: `src/lib/openapi/registry.ts`, regenerated `openapi.json`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/home-picks-route.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { seedOccurrence } from '../db/seed';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { homePicks } from '@/lib/services/home-picks';
import type { ServiceContext } from '@/lib/services/context';

// Inject a PGlite-backed ServiceContext into the route handler.
vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { GET: picksGet } = await import('../../app/api/v1/activities/picks/route');

/** The homepage picks reach the browser through homePicks() and GET /api/v1/activities/picks. */
describe('homePicks + GET /api/v1/activities/picks', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const seeded = await seedOccurrence(db, 10);
    await db.pg.query(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2,
         (((now() at time zone 'Indian/Mauritius')::date + 1) + time '10:00') at time zone 'Indian/Mauritius',
         (((now() at time zone 'Indian/Mauritius')::date + 1) + time '14:00') at time zone 'Indian/Mauritius',
         10)`,
      [seeded.optionId, seeded.operatorId],
    );
    slug = (
      await db.pg.query<{ slug: string }>(`select slug from activities where id = $1`, [
        seeded.activityId,
      ])
    ).rows[0]!.slug;
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    setRouteContext(ctx);
    await db.as(null);
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  it('the service returns the parsed picks', async () => {
    const picks = await homePicks(ctx);
    expect(picks.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(picks.freeTomorrow).toContain(slug);
    expect(Array.isArray(picks.mostBooked)).toBe(true);
  });

  it('the route serves them to anyone, cached at the edge for a minute', async () => {
    const res = await picksGet(new Request('http://localhost/api/v1/activities/picks'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.freeTomorrow).toContain(slug);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/integration/home-picks-route.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/home-picks` / the route module.

- [ ] **Step 3: Write the schema**

Create `src/lib/validation/home-picks.ts`:

```ts
import { z } from 'zod';

/**
 * GET /activities/picks — the shared data behind the homepage's first row (api_home_picks). The same
 * answer for every visitor, so it is safe to cache at the edge; what to SHOW a visitor is decided in
 * their browser (chooseHomeRow).
 */
export const homePicksSchema = z.object({
  /** Tomorrow in Mauritius, YYYY-MM-DD: the day `freeTomorrow` is about. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Published tours, most confirmed bookings in the last 90 days first. Order only — no counts. */
  mostBooked: z.array(z.string()),
  /** Published, bookable-online tours with a free seat on `date`, in catalogue order. */
  freeTomorrow: z.array(z.string()),
});
export type HomePicks = z.infer<typeof homePicksSchema>;
```

- [ ] **Step 4: Write the service**

Create `src/lib/services/home-picks.ts`:

```ts
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { homePicksSchema, type HomePicks } from '@/lib/validation/home-picks';

/** The homepage's shared picks — most booked, and free tomorrow (api_home_picks, 20261017130000). */
export async function homePicks(ctx: ServiceContext): Promise<HomePicks> {
  const data = await callRpc(ctx, 'api_home_picks', {});
  return homePicksSchema.parse(data);
}
```

- [ ] **Step 5: Write the route**

Create `app/api/v1/activities/picks/route.ts`:

```ts
import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { homePicks } from '@/lib/services/home-picks';

export const runtime = 'edge';

/**
 * GET /api/v1/activities/picks — most-booked tours and tours with a free seat tomorrow (public). The
 * answer is the same for every visitor, so a short edge cache is safe; "free tomorrow" is at most a
 * couple of minutes old, and the booking widget re-checks the real seat anyway.
 */
export const GET = apiHandler(async (req) => {
  await authenticateOptional(req);
  const ctx = buildServiceContext(req);
  const picks = await homePicks(ctx);
  return jsonOk(picks, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
```

- [ ] **Step 6: Register the route in the API contract**

In `src/lib/openapi/registry.ts`, add the import next to the other validation imports:

```ts
import { homePicksSchema } from '@/lib/validation/home-picks';
```

and add this entry directly after the `'/activities/facets'` entry:

```ts
  '/activities/picks': {
    get: {
      operationId: 'getHomePicks',
      summary: 'Homepage picks: most-booked tours and tours with a free seat tomorrow',
      tags: ['Catalogue'],
      responses: { '200': okJson(homePicksSchema, 'Home picks') },
    },
  },
```

Then regenerate the static contract:

```bash
npm run openapi:write
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/integration/home-picks-route.test.ts tests/unit/openapi.test.ts tests/unit/openapi-fresh.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/lib/validation/home-picks.ts src/lib/services/home-picks.ts app/api/v1/activities/picks/route.ts src/lib/openapi/registry.ts tests/integration/home-picks-route.test.ts
git add src/lib/validation/home-picks.ts src/lib/services/home-picks.ts app/api/v1/activities/picks/route.ts src/lib/openapi/registry.ts openapi.json tests/integration/home-picks-route.test.ts
git commit -F - <<'EOF'
feat(api): GET /api/v1/activities/picks — the homepage's shared picks, edge-cached

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: "On the island" from the locality endpoint

**Files:**

- Modify: `src/lib/geo/visitor-country.ts`
- Modify: `app/api/planner/locality/route.ts`
- Test: `tests/unit/visitor-country.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/visitor-country.test.ts`, change the import to

```ts
import { devLocalityOverride, localityFromCountry } from '@/lib/geo/visitor-country';
```

and append:

```ts
/* Cloudflare's header never reaches `next dev`, so the homepage's on-island row could not be seen
 * locally. The override exists for that and nothing else: a production build must ignore it, or anyone
 * could pick their own row with a query string. */
describe('devLocalityOverride', () => {
  it('lets next dev stand in for Cloudflare with ?as=island / ?as=abroad', () => {
    expect(devLocalityOverride('island', 'development')).toBe('mauritius');
    expect(devLocalityOverride('abroad', 'development')).toBe('abroad');
  });

  it('ignores anything else, and is never honoured outside development', () => {
    expect(devLocalityOverride(null, 'development')).toBeNull();
    expect(devLocalityOverride('mars', 'development')).toBeNull();
    expect(devLocalityOverride('island', 'production')).toBeNull();
    expect(devLocalityOverride('island', 'test')).toBeNull();
    expect(devLocalityOverride('island', undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/visitor-country.test.ts`
Expected: FAIL — `devLocalityOverride` is not exported.

- [ ] **Step 3: Implement the override**

In `src/lib/geo/visitor-country.ts`, add after `localityFromCountry`:

```ts
/**
 * `next dev` only: `?as=island` / `?as=abroad` stands in for Cloudflare's header, which never reaches a
 * local server, so the homepage's location-based row can be checked without a VPN. Returns null — "no
 * override" — for anything else and in every non-development build.
 */
export function devLocalityOverride(
  param: string | null,
  nodeEnv: string | undefined,
): VisitorLocality | null {
  if (nodeEnv !== 'development') return null;
  if (param === 'island') return 'mauritius';
  if (param === 'abroad') return 'abroad';
  return null;
}
```

- [ ] **Step 4: Return `onIsland` from the route**

Replace the body of `app/api/planner/locality/route.ts` from the import of `visitorLocality` to the end of `GET` with:

```ts
import { devLocalityOverride, visitorLocality } from '@/lib/geo/visitor-country';

export const runtime = 'edge';

/**
 * GET /api/planner/locality — where this visitor is browsing from, reduced to two yes/no answers:
 *   * mayUseDeviceLocation — whether the assistant may offer "use my current location" (unknown counts
 *     as yes; see visitorLocality);
 *   * onIsland — whether the homepage should lead with tours still free tomorrow (only a CONFIRMED
 *     Mauritius counts).
 *
 * The homepage is edge-cached and identical for everyone, so neither can be rendered into page HTML
 * without one visitor's answer being served to the next. It is asked for here instead. The country
 * itself never leaves the server.
 */
export const GET = apiHandler(async (req) => {
  const override = devLocalityOverride(
    new URL(req.url).searchParams.get('as'),
    process.env.NODE_ENV,
  );
  const locality = override ?? (await visitorLocality());
  return jsonOk(
    { mayUseDeviceLocation: locality !== 'abroad', onIsland: locality === 'mauritius' },
    // Per-visitor by construction: it must never be stored by a shared cache.
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
});
```

(Keep the existing `apiHandler`, `jsonOk`, `preflightResponse` imports and the `OPTIONS` export.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/visitor-country.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/geo/visitor-country.ts app/api/planner/locality/route.ts tests/unit/visitor-country.test.ts
git add src/lib/geo/visitor-country.ts app/api/planner/locality/route.ts tests/unit/visitor-country.test.ts
git commit -F - <<'EOF'
feat(geo): locality endpoint answers onIsland; dev-only ?as= override

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Browser stores — guides read, and the on-island session flag

**Files:**

- Create: `src/lib/recent/interest.ts`, `src/lib/recent/on-island.ts`
- Test: `tests/unit/interest.test.ts`, `tests/unit/on-island.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/interest.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEREST_EVENT,
  INTEREST_KEY,
  clearInterest,
  readInterest,
  recordInterest,
} from '@/lib/recent/interest';

/**
 * The guides a visitor read, each with the tours it recommends — what lets the homepage's first row
 * lead with "Picked from the guides you've read". It lives in the visitor's own browser, so it must
 * survive whatever is already in there. This suite runs in `node`; `window` is a minimal stand-in.
 */

function fakeWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const events: string[] = [];
  return {
    events,
    store,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
}

describe('guide interest', () => {
  let win: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    win = fakeWindow();
    vi.stubGlobal('window', win);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty before any guide has been read', () => {
    expect(readInterest()).toEqual([]);
  });

  it('keeps the latest guide first, each with its tours in page order', () => {
    recordInterest('post:mauritius-in-december', ['catamaran', 'dolphins']);
    recordInterest('attraction:ile-aux-cerfs', ['blue-cruise', 'catamaran']);
    expect(readInterest()).toEqual([
      { topic: 'attraction:ile-aux-cerfs', slugs: ['blue-cruise', 'catamaran'] },
      { topic: 'post:mauritius-in-december', slugs: ['catamaran', 'dolphins'] },
    ]);
  });

  it('moves a re-read guide to the front instead of listing it twice', () => {
    recordInterest('post:a', ['x']);
    recordInterest('post:b', ['y']);
    recordInterest('post:a', ['x', 'z']);
    expect(readInterest().map((i) => i.topic)).toEqual(['post:a', 'post:b']);
    expect(readInterest()[0]!.slugs).toEqual(['x', 'z']);
  });

  it('keeps five guides and six tours per guide', () => {
    for (let i = 0; i < 7; i++) {
      recordInterest(`post:${i}`, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    }
    const kept = readInterest();
    expect(kept).toHaveLength(5);
    expect(kept[0]!.topic).toBe('post:6');
    expect(kept[0]!.slugs).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('lists a tour once per guide', () => {
    recordInterest('hub:/dolphin-swim-mauritius', ['a', 'a', 'b']);
    expect(readInterest()[0]!.slugs).toEqual(['a', 'b']);
  });

  it('records nothing for a guide with no tours, or no topic', () => {
    recordInterest('post:empty', []);
    recordInterest('', ['a']);
    expect(readInterest()).toEqual([]);
    expect(win.store.has(INTEREST_KEY)).toBe(false);
  });

  it('announces each change in this tab', () => {
    recordInterest('post:a', ['x']);
    clearInterest();
    expect(win.events).toEqual([INTEREST_EVENT, INTEREST_EVENT]);
  });

  it('clear empties it', () => {
    recordInterest('post:a', ['x']);
    clearInterest();
    expect(readInterest()).toEqual([]);
  });

  it('reads malformed storage as empty, and drops malformed entries', () => {
    win.store.set(INTEREST_KEY, '{not json');
    expect(readInterest()).toEqual([]);
    win.store.set(
      INTEREST_KEY,
      JSON.stringify([
        { topic: 1 },
        { topic: 'ok', slugs: ['a'] },
        'x',
        { topic: 'n', slugs: [2] },
      ]),
    );
    expect(readInterest()).toEqual([{ topic: 'ok', slugs: ['a'] }]);
  });

  it('survives storage that throws (private mode, full quota)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      },
      dispatchEvent: () => true,
    });
    expect(readInterest()).toEqual([]);
    expect(() => recordInterest('post:a', ['x'])).not.toThrow();
    expect(() => clearInterest()).not.toThrow();
  });
});
```

Create `tests/unit/on-island.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ON_ISLAND_KEY, readOnIsland, writeOnIsland } from '@/lib/recent/on-island';

/* The locality answer, kept for the rest of the visit so a second homepage view can put up the
 * on-island row's placeholders before paint. Unknown (never asked, or storage refused) must read as
 * null — not as "abroad" — so the caller can tell "no answer yet" from "no". */

function fakeSession(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

describe('on-island session flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unknown until the locality has been asked', () => {
    vi.stubGlobal('window', fakeSession());
    expect(readOnIsland()).toBeNull();
  });

  it('round-trips yes and no', () => {
    const win = fakeSession();
    vi.stubGlobal('window', win);
    writeOnIsland(true);
    expect(win.store.get(ON_ISLAND_KEY)).toBe('1');
    expect(readOnIsland()).toBe(true);
    writeOnIsland(false);
    expect(readOnIsland()).toBe(false);
  });

  it('reads anything else, or storage that throws, as unknown', () => {
    vi.stubGlobal('window', fakeSession({ [ON_ISLAND_KEY]: 'yes' }));
    expect(readOnIsland()).toBeNull();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(readOnIsland()).toBeNull();
    expect(() => writeOnIsland(true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/interest.test.ts tests/unit/on-island.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the interest store**

Create `src/lib/recent/interest.ts`:

```ts
/* The guides a visitor has read, each with the tours that guide recommends, persisted in localStorage
 * (most-recent-first, deduped by guide, capped). Written by <RecordInterest> on attraction pages, blog
 * posts with their own tour list and the three topic pages; read by the homepage's first row
 * (chooseHomeRow). Device-local only, like recent views — nothing here is sent to the server, and the
 * "Clear" buttons on the homepage remove it. No 'use client': the pre-paint script reads the key. */

export const INTEREST_KEY = 'gytm:interest';
/** Same-tab change signal (storage events only fire in *other* tabs). */
export const INTEREST_EVENT = 'gytm:interest';
const MAX_TOPICS = 5;
const MAX_SLUGS = 6;

export interface Interest {
  /** One per guide: `attraction:<id>`, `post:<slug>` or `hub:<path>`. */
  topic: string;
  /** The tours that guide shows, in its order. */
  slugs: string[];
}

function isInterest(value: unknown): value is Interest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.topic === 'string' &&
    Array.isArray(v.slugs) &&
    v.slugs.every((s) => typeof s === 'string')
  );
}

export function readInterest(): Interest[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTEREST_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isInterest) : [];
  } catch {
    return [];
  }
}

export function recordInterest(topic: string, slugs: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const kept = [...new Set(slugs)].slice(0, MAX_SLUGS);
  if (!topic || kept.length === 0) return;
  try {
    const next = [{ topic, slugs: kept }, ...readInterest().filter((i) => i.topic !== topic)].slice(
      0,
      MAX_TOPICS,
    );
    window.localStorage.setItem(INTEREST_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(INTEREST_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearInterest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(INTEREST_KEY);
    window.dispatchEvent(new Event(INTEREST_EVENT));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
```

- [ ] **Step 4: Implement the session flag**

Create `src/lib/recent/on-island.ts`:

```ts
/* Whether this visit is browsing from Mauritius, as /api/planner/locality last said — kept for the rest
 * of the browser session (sessionStorage), so a second homepage view can put up the on-island row's
 * placeholders before paint instead of switching tiles after load. A yes/no, never the country.
 * No 'use client': the pre-paint script reads the key. */

export const ON_ISLAND_KEY = 'gytm:on-island';

/** true / false as last answered this session; null when never asked or storage is unavailable. */
export function readOnIsland(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(ON_ISLAND_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeOnIsland(onIsland: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ON_ISLAND_KEY, onIsland ? '1' : '0');
  } catch {
    /* storage unavailable — non-fatal */
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/interest.test.ts tests/unit/on-island.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/recent/interest.ts src/lib/recent/on-island.ts tests/unit/interest.test.ts tests/unit/on-island.test.ts
git add src/lib/recent/interest.ts src/lib/recent/on-island.ts tests/unit/interest.test.ts tests/unit/on-island.test.ts
git commit -F - <<'EOF'
feat(home): browser stores for guides read and the on-island session flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Record guide reading on the guide pages

**Files:**

- Create: `src/components/gyg/RecordInterest.tsx`
- Modify: `src/lib/content/tour-links.ts`
- Modify: `app/(site)/attractions/[slug]/page.tsx`, `app/(site)/blog/[slug]/page.tsx`, `app/(site)/dolphin-swim-mauritius/page.tsx`, `app/(site)/ile-aux-cerfs-tours/page.tsx`, `app/(site)/mauritius-catamaran-cruise/page.tsx`
- Test: `tests/unit/interest-topics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/interest-topics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_POST_TOURS, POST_TOURS, postInterestTopic } from '@/lib/content/tour-links';

/* A blog post tells us what its reader wants only when it has tours of its own. The generic fallback
 * (DEFAULT_POST_TOURS — planning posts: SIM cards, money, entry rules) shows the same three tours to
 * everyone, so recording it would put those three on every reader's homepage. */
describe('postInterestTopic', () => {
  it('names a post that has its own tours', () => {
    expect(POST_TOURS['mauritius-in-december']).toBeDefined();
    expect(postInterestTopic('mauritius-in-december')).toBe('post:mauritius-in-december');
  });

  it('is null for a post on the generic fallback', () => {
    expect(DEFAULT_POST_TOURS.length).toBeGreaterThan(0);
    expect(postInterestTopic('a-post-with-no-tours-of-its-own')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/interest-topics.test.ts`
Expected: FAIL — `postInterestTopic` is not exported.

- [ ] **Step 3: Add the helper**

In `src/lib/content/tour-links.ts`, directly after `toursForPost`:

```ts
/**
 * The topic a blog post records as the reader's interest (see RecordInterest) — or null when the post
 * has no tours of its own: the DEFAULT_POST_TOURS fallback is the same for every reader, so it says
 * nothing about what this one wants.
 */
export function postInterestTopic(slug: string): string | null {
  return POST_TOURS[slug] ? `post:${slug}` : null;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/interest-topics.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the component**

Create `src/components/gyg/RecordInterest.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { recordInterest } from '@/lib/recent/interest';

/** Records that the visitor read a guide, with the tours it shows, so the homepage's first row can
 *  lead with them (see chooseHomeRow). Renders nothing. Mirrors <RecordView>. */
export function RecordInterest({ topic, slugs }: { topic: string; slugs: string[] }) {
  // A joined key, so a new array with the same tours does not re-record on every render.
  const key = slugs.join('|');
  useEffect(() => {
    recordInterest(topic, key ? key.split('|') : []);
  }, [topic, key]);

  return null;
}
```

- [ ] **Step 6: Mount it on the five guide pages**

`app/(site)/attractions/[slug]/page.tsx` — add the import with the other component imports:

```tsx
import { RecordInterest } from '@/components/gyg/RecordInterest';
```

and inside the "tours you can book" section, replace

```tsx
            <div className="mt-5">
              <ActivityGrid activities={tours} />
            </div>
          </section>
        )}
```

(the first occurrence — the one directly under the `: tours you can book` heading) with

```tsx
            <div className="mt-5">
              <ActivityGrid activities={tours} />
            </div>
            <RecordInterest topic={`attraction:${slug}`} slugs={tours.map((a) => a.slug)} />
          </section>
        )}
```

`app/(site)/blog/[slug]/page.tsx` — add `import { RecordInterest } from '@/components/gyg/RecordInterest';` and extend the tour-links import to

```tsx
import { POST_HUBS, postInterestTopic, toursForPost } from '@/lib/content/tour-links';
```

add `const interestTopic = postInterestTopic(slug);` on the line after `const hub = POST_HUBS[p.slug];`, and in the "Book the experience" section replace

```tsx
            <div className="mt-5">
              <ActivityGrid activities={tours} />
            </div>
          </section>
        )}
```

with

```tsx
            <div className="mt-5">
              <ActivityGrid activities={tours} />
            </div>
            {interestTopic && (
              <RecordInterest topic={interestTopic} slugs={tours.map((a) => a.slug)} />
            )}
          </section>
        )}
```

`app/(site)/dolphin-swim-mauritius/page.tsx` — add `import { RecordInterest } from '@/components/gyg/RecordInterest';`; directly after the `<FeaturedTours title={t('Dolphin trips you can book')} … activities={featured} />` element add

```tsx
<RecordInterest topic="hub:/dolphin-swim-mauritius" slugs={featured.map((a) => a.slug)} />
```

`app/(site)/ile-aux-cerfs-tours/page.tsx` — add `import { RecordInterest } from '@/components/gyg/RecordInterest';`; directly after the `<FeaturedTours title={t('Île aux Cerfs trips you can book')} … activities={featured} />` element add

```tsx
<RecordInterest topic="hub:/ile-aux-cerfs-tours" slugs={featured.map((a) => a.slug)} />
```

`app/(site)/mauritius-catamaran-cruise/page.tsx` — add `import { RecordInterest } from '@/components/gyg/RecordInterest';`; directly after the `<FeaturedTours title={t('Catamaran cruises you can book')} … activities={catamarans} />` element add

```tsx
<RecordInterest topic="hub:/mauritius-catamaran-cruise" slugs={catamarans.map((a) => a.slug)} />
```

(`recordInterest` keeps the first six tours of each guide.)

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/components/gyg/RecordInterest.tsx src/lib/content/tour-links.ts tests/unit/interest-topics.test.ts "app/(site)/attractions/[slug]/page.tsx" "app/(site)/blog/[slug]/page.tsx" "app/(site)/dolphin-swim-mauritius/page.tsx" "app/(site)/ile-aux-cerfs-tours/page.tsx" "app/(site)/mauritius-catamaran-cruise/page.tsx"
git add src/components/gyg/RecordInterest.tsx src/lib/content/tour-links.ts tests/unit/interest-topics.test.ts "app/(site)/attractions/[slug]/page.tsx" "app/(site)/blog/[slug]/page.tsx" "app/(site)/dolphin-swim-mauritius/page.tsx" "app/(site)/ile-aux-cerfs-tours/page.tsx" "app/(site)/mauritius-catamaran-cruise/page.tsx"
git commit -F - <<'EOF'
feat(guides): remember which guides a visitor read, with the tours each recommends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `chooseHomeRow` — the rules

**Files:**

- Create: `src/lib/catalogue/home-row.ts`
- Modify: `src/lib/catalogue/home-tours.ts` (export `homeTile`)
- Modify: `src/lib/i18n/messages.ts` (three headings)
- Test: `tests/unit/home-row.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/home-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chooseHomeRow,
  homeRowHeading,
  mauritiusTomorrow,
  type HomeRow,
  type HomeRowInput,
} from '@/lib/catalogue/home-row';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { TourImage, TourSummary } from '@/lib/validation/tours';

/* The homepage's first row (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). Four
 * rules, first that fits wins: guides read → on the island → most booked → today's private tours. Every
 * heading must be true of every tile under it, so no row tops up with tours it does not describe. */

const photo = (id: string): TourImage => ({
  id,
  url: `https://img.test/${id}.jpg`,
  alt: null,
  position: 0,
});

const tour = (slug: string, over: Partial<TourSummary> = {}): TourSummary =>
  ({
    id: slug,
    slug,
    type: 'tour',
    title: `Tour ${slug}`,
    summary: null,
    category: 'Catamaran cruises',
    location: null,
    durationMinutes: 480,
    fromPriceEur: 90,
    fromPriceMaxGuests: null,
    fromPriceIncluded: null,
    pricingMode: 'per_person',
    minAdvanceDays: 1,
    ratingAvg: null,
    ratingCount: 0,
    heroImage: photo(slug),
    images: [],
    region: null,
    lat: null,
    lng: null,
    ...over,
  }) as TourSummary;

const TOMORROW = '2026-10-18';
const picks = (over: Partial<HomePicks> = {}): HomePicks => ({
  date: TOMORROW,
  mostBooked: [],
  freeTomorrow: [],
  ...over,
});

// Catalogue order: a…h, then three private day tours (the fallback row's category).
const ACTIVITIES = [
  ...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => tour(s)),
  tour('north-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
  tour('south-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
  tour('east-tour', { category: 'Taxi Sightseeing tours', pricingMode: 'vehicle' }),
];

const row = (input: Partial<HomeRowInput>): HomeRow =>
  chooseHomeRow({ activities: ACTIVITIES, picks: null, tomorrow: TOMORROW, ...input });
const slugs = (r: HomeRow) => r.tiles.map((x) => x.tour.slug);

describe('rule 3 — most booked (everyone else, and what the server renders)', () => {
  it('shows the most-booked tours in booked order', () => {
    const r = row({ picks: picks({ mostBooked: ['c', 'a', 'f'] }) });
    expect(r.variant).toBe('popular');
    expect(slugs(r)).toEqual(['c', 'a', 'f']);
  });

  it('shows six at most', () => {
    const r = row({ picks: picks({ mostBooked: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }) });
    expect(slugs(r)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('skips tours not in the catalogue (unpublished, the airport transfer) and photo-less ones', () => {
    const activities = ACTIVITIES.map((a) =>
      a.slug === 'b' ? { ...a, heroImage: null, images: [] } : a,
    );
    const r = chooseHomeRow({
      activities,
      tomorrow: TOMORROW,
      picks: picks({ mostBooked: ['airport-transfer', 'b', 'a', 'c', 'd'] }),
    });
    expect(slugs(r)).toEqual(['a', 'c', 'd']);
  });

  it('never tops up with unbooked tours: fewer than three falls back to the private tours', () => {
    const r = row({ picks: picks({ mostBooked: ['c', 'a'] }) });
    expect(r.variant).toBe('private');
    expect(slugs(r)).toEqual(['north-tour', 'south-tour', 'east-tour']);
  });

  it('falls back to the private tours when the picks could not be loaded', () => {
    expect(row({ picks: null }).variant).toBe('private');
  });

  it('does not care about the date — what was booked does not change at midnight', () => {
    const r = row({ picks: picks({ date: '2026-10-01', mostBooked: ['a', 'b', 'c'] }) });
    expect(r.variant).toBe('popular');
  });
});

describe('rule 2 — on the island', () => {
  it('shows tours free tomorrow, most booked first, then in catalogue order', () => {
    const r = row({
      onIsland: true,
      picks: picks({ mostBooked: ['f', 'c', 'a'], freeTomorrow: ['a', 'b', 'c', 'g'] }),
    });
    expect(r.variant).toBe('island');
    expect(slugs(r)).toEqual(['c', 'a', 'b', 'g']);
  });

  it('needs three free tours, else falls through to most booked', () => {
    const r = row({
      onIsland: true,
      picks: picks({ mostBooked: ['d', 'e', 'f'], freeTomorrow: ['a', 'b'] }),
    });
    expect(r.variant).toBe('popular');
  });

  it('treats an answer about another day as nothing free', () => {
    const r = row({
      onIsland: true,
      picks: picks({
        date: '2026-10-17',
        mostBooked: ['d', 'e', 'f'],
        freeTomorrow: ['a', 'b', 'c'],
      }),
    });
    expect(r.variant).toBe('popular');
    expect(slugs(r)).toEqual(['d', 'e', 'f']);
  });

  it('is not used for visitors abroad', () => {
    const r = row({ picks: picks({ mostBooked: ['d', 'e', 'f'], freeTomorrow: ['a', 'b', 'c'] }) });
    expect(r.variant).toBe('popular');
  });
});

describe('rule 1 — guides read', () => {
  const interest = [
    { topic: 'post:x', slugs: ['c', 'a'] },
    { topic: 'attraction:y', slugs: ['a', 'e', 'g'] },
  ];

  it('shows the tours of the guides read, newest guide first, each tour once', () => {
    const r = row({ interest });
    expect(r.variant).toBe('guides');
    expect(slugs(r)).toEqual(['c', 'a', 'e', 'g']);
  });

  it('leaves out tours already shown in Continue planning', () => {
    expect(slugs(row({ interest, continuing: ['a'] }))).toEqual(['c', 'e', 'g']);
  });

  it('needs three tours, else falls through', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b'] }],
      picks: picks({ mostBooked: ['d', 'e', 'f'] }),
    });
    expect(r.variant).toBe('popular');
  });

  it('wins over the island row', () => {
    const r = row({
      interest,
      onIsland: true,
      picks: picks({ freeTomorrow: ['d', 'e', 'f', 'h'] }),
    });
    expect(r.variant).toBe('guides');
  });

  it('on the island, puts the tours free tomorrow first', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b', 'c', 'd'] }],
      onIsland: true,
      picks: picks({ freeTomorrow: ['c', 'a'] }),
    });
    expect(slugs(r)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('keeps the guides’ order for visitors abroad', () => {
    const r = row({
      interest: [{ topic: 'post:x', slugs: ['a', 'b', 'c', 'd'] }],
      picks: picks({ freeTomorrow: ['c', 'a'] }),
    });
    expect(slugs(r)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('homeRowHeading', () => {
  it('names each row through the translator', () => {
    const t = (s: string) => `«${s}»`;
    expect(homeRowHeading('guides', t)).toBe('«Picked from the guides you’ve read»');
    expect(homeRowHeading('island', t)).toBe('«Still free tomorrow»');
    expect(homeRowHeading('popular', t)).toBe('«Most booked by our guests»');
    expect(homeRowHeading('private', t)).toBe('«Private day tours with your own driver»');
  });
});

describe('mauritiusTomorrow', () => {
  it('is the day after the Mauritius date (UTC+4, no DST)', () => {
    expect(mauritiusTomorrow(new Date('2026-10-17T19:59:59Z'))).toBe('2026-10-18'); // 23:59 in MU
    expect(mauritiusTomorrow(new Date('2026-10-17T20:00:00Z'))).toBe('2026-10-19'); // 00:00 in MU
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/home-row.test.ts`
Expected: FAIL — `@/lib/catalogue/home-row` not found.

- [ ] **Step 3: Export `homeTile` from home-tours.ts**

In `src/lib/catalogue/home-tours.ts`, add above `pickHomeTours`:

```ts
/** A tour with the photo its tile shows, or null when it has none — a tile is never shown empty. */
export function homeTile(tour: TourSummary): HomeTour | null {
  const image = tour.heroImage ?? tour.images[0];
  return image ? { tour, image } : null;
}
```

and replace the body of the loop in `pickHomeTours` with:

```ts
for (const tour of activities) {
  if (out.length >= max) break;
  if (!isSightseeingCategory(tour.category)) continue;
  const tile = homeTile(tour);
  if (tile) out.push(tile);
}
```

Run: `npx vitest run tests/unit/home-tours.test.ts` — Expected: PASS (behaviour unchanged).

- [ ] **Step 4: Write `home-row.ts`**

Create `src/lib/catalogue/home-row.ts`:

```ts
import type { TourSummary } from '@/lib/validation/tours';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { Interest } from '@/lib/recent/interest';
import { HOME_TOURS_MAX, homeTile, pickHomeTours, type HomeTour } from './home-tours';

/**
 * Which row the homepage shows under the hero, and which tours are in it
 * (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). First rule that fits wins:
 *
 *   1. guides  — the tours of the guides this visitor read (newest guide first), minus what
 *                "Continue planning" already shows; on the island, the ones free tomorrow first.
 *   2. island  — browsing from Mauritius: tours with a free seat tomorrow, most booked first.
 *   3. popular — everyone else: our most-booked tours (api_home_picks).
 *   4. private — today's row, when the picks are missing or too thin: the private day tours.
 *
 * Every heading is a claim about every tile under it, so no row tops up with tours it does not describe:
 * a row that cannot fill HOME_ROW_MIN tiles truthfully falls through to the next rule instead.
 *
 * Pure: the server calls it with no interest and no location (rules 3–4 — what Google sees); the browser
 * calls it again with both.
 */

export type HomeRowVariant = 'guides' | 'island' | 'popular' | 'private';

/** Fewer tiles than this and the row's heading would oversell it. */
export const HOME_ROW_MIN = 3;

export interface HomeRowInput {
  /** The catalogue, in catalogue order (the homepage's searchActivities result). */
  activities: readonly TourSummary[];
  /** api_home_picks, or null when it could not be loaded. */
  picks: HomePicks | null;
  /** Tomorrow in Mauritius as the caller sees it; null trusts `picks.date` (the server, at render). */
  tomorrow: string | null;
  /** Guides read, newest first (gytm:interest). */
  interest?: readonly Interest[];
  /** Slugs already shown in "Continue planning": cart, viewed, wishlist. */
  continuing?: readonly string[];
  /** Browsing from Mauritius (/api/planner/locality). */
  onIsland?: boolean;
}

export interface HomeRow {
  variant: HomeRowVariant;
  tiles: HomeTour[];
}

/** Up to HOME_TOURS_MAX tiles for these slugs, in order: each once, skipping `skip`, unknown and photo-less tours. */
function tilesFor(
  slugs: Iterable<string>,
  bySlug: ReadonlyMap<string, TourSummary>,
  skip: ReadonlySet<string> = new Set(),
): HomeTour[] {
  const out: HomeTour[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (out.length >= HOME_TOURS_MAX) break;
    if (seen.has(slug) || skip.has(slug)) continue;
    seen.add(slug);
    const tour = bySlug.get(slug);
    const tile = tour ? homeTile(tour) : null;
    if (tile) out.push(tile);
  }
  return out;
}

export function chooseHomeRow(input: HomeRowInput): HomeRow {
  const { activities, picks } = input;
  const bySlug = new Map(activities.map((a) => [a.slug, a]));
  // A cached answer read after midnight is about today, not tomorrow: then nothing counts as free.
  const freshFree =
    picks && (input.tomorrow === null || picks.date === input.tomorrow) ? picks.freeTomorrow : [];
  const free = new Set(freshFree);

  // 1. Guides read.
  const guideSlugs = [...new Set((input.interest ?? []).flatMap((i) => i.slugs))];
  const ordered = input.onIsland
    ? [...guideSlugs.filter((s) => free.has(s)), ...guideSlugs.filter((s) => !free.has(s))]
    : guideSlugs;
  const guides = tilesFor(ordered, bySlug, new Set(input.continuing ?? []));
  if (guides.length >= HOME_ROW_MIN) return { variant: 'guides', tiles: guides };

  // 2. On the island.
  if (input.onIsland && picks && free.size > 0) {
    const ranked = picks.mostBooked.filter((s) => free.has(s));
    const rest = activities.map((a) => a.slug).filter((s) => free.has(s));
    const island = tilesFor([...ranked, ...rest], bySlug);
    if (island.length >= HOME_ROW_MIN) return { variant: 'island', tiles: island };
  }

  // 3. Most booked.
  if (picks) {
    const popular = tilesFor(picks.mostBooked, bySlug);
    if (popular.length >= HOME_ROW_MIN) return { variant: 'popular', tiles: popular };
  }

  // 4. Today's row.
  return { variant: 'private', tiles: pickHomeTours(activities) };
}

/** The row's heading. Literal t() calls on purpose, so scripts/i18n-scan.mjs sees every key. */
export function homeRowHeading(variant: HomeRowVariant, t: (key: string) => string): string {
  switch (variant) {
    case 'guides':
      return t('Picked from the guides you’ve read');
    case 'island':
      return t('Still free tomorrow');
    case 'popular':
      return t('Most booked by our guests');
    case 'private':
      return t('Private day tours with your own driver');
  }
}

/** Tomorrow's date in Mauritius (UTC+4, no DST) as YYYY-MM-DD — what api_home_picks calls `date`. */
export function mauritiusTomorrow(now: Date): string {
  return new Date(now.getTime() + (4 + 24) * 3_600_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 5: Add the French headings**

In `src/lib/i18n/messages.ts`, directly after the line `'Private day tours with your own driver': 'Excursions privées à la journée, avec votre chauffeur',` add (curly apostrophes exactly as written — lookup is an exact string match):

```ts
  'Picked from the guides you’ve read': 'D’après les guides que vous avez lus',
  'Still free tomorrow': 'Encore des places demain',
  'Most booked by our guests': 'Les plus réservés par nos clients',
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/home-row.test.ts tests/unit/home-tours.test.ts tests/unit/i18n-coverage.test.ts && node scripts/i18n-scan.mjs`
Expected: PASS; the scan reports no missing French keys.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/catalogue/home-row.ts src/lib/catalogue/home-tours.ts src/lib/i18n/messages.ts tests/unit/home-row.test.ts
git add src/lib/catalogue/home-row.ts src/lib/catalogue/home-tours.ts src/lib/i18n/messages.ts tests/unit/home-row.test.ts
git commit -F - <<'EOF'
feat(home): chooseHomeRow — guides read, on the island, most booked, private-tours fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: The homepage row

**Files:**

- Create: `src/components/gyg/home/HomeToursRow.tsx`, `src/components/gyg/home/HomeToursReserve.tsx`
- Modify: `src/components/gyg/home/HomeTours.tsx` (rewrite as a server wrapper)
- Modify: `src/components/gyg/home/ContinuePlanning.tsx`
- Modify: `app/(site)/page.tsx`
- Modify: `src/lib/consent/gtag.ts`
- Modify: `src/lib/i18n/messages.ts`

No unit test for the component itself: the unit suite runs in `node` without a DOM, and what matters here (no layout shift, no flash) only shows in a real browser — Task 9 measures it. The rules it calls are covered by Task 6.

- [ ] **Step 1: Add the analytics helper**

In `src/lib/consent/gtag.ts`, append:

```ts
/**
 * Pushes a custom event onto GTM's dataLayer. Tags in the container act on it only within the visitor's
 * consent (Consent Mode), like every other tag. No-op on the server; never throws.
 */
export function pushDataLayerEvent(data: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    (window.dataLayer ??= []).push(data);
  } catch {
    // A blocked or broken container must never break the page.
  }
}
```

- [ ] **Step 2: Let the row read what "Continue planning" shows, and clear guides with it**

In `src/components/gyg/home/ContinuePlanning.tsx`:

Add to the imports:

```tsx
import { clearInterest } from '@/lib/recent/interest';
```

Add after `readSnapshot()`:

```tsx
/** Every slug "Continue planning" draws from — the first row below leaves these out (chooseHomeRow). */
export function readContinuingSlugs(): string[] {
  const snap = readSnapshot();
  return [...snap.cart.keys(), ...snap.recent, ...snap.wished];
}
```

and change the "Clear viewed" button's handler from `onClick={clearRecentViews}` to:

```tsx
            onClick={() => {
              clearRecentViews();
              // The guides read feed the row below; "clear what you looked at" means those too.
              clearInterest();
            }}
```

- [ ] **Step 3: Write the pre-paint reserve**

Create `src/components/gyg/home/HomeToursReserve.tsx`:

```tsx
import { INTEREST_KEY } from '@/lib/recent/interest';
import { ON_ISLAND_KEY } from '@/lib/recent/on-island';

/* Shared by the row (client) and its pre-paint script (server). No 'use client' here on purpose. */

export const HOME_TOURS_ID = 'home-tours';

/** If hydration never comes (a script error, a very slow phone), the real tiles come back after this. */
const PLACEHOLDER_FAILSAFE_MS = 2500;

/**
 * Runs before first paint: when this browser already holds a reason for a personal row — guides read,
 * or this visit already known to be in Mauritius — it marks the row so the server's tiles are hidden
 * behind same-size placeholders until the client has chosen. Without it a guide reader would watch
 * "Most booked" flash and then be replaced.
 */
const RESERVE_SCRIPT = `(function(){try{var el=document.getElementById('${HOME_TOURS_ID}');if(!el)return;var v=JSON.parse(localStorage.getItem('${INTEREST_KEY}')||'[]');var on=false;try{on=sessionStorage.getItem('${ON_ISLAND_KEY}')==='1'}catch(e){}if((v&&v.length)||on){el.setAttribute('data-personal','on');setTimeout(function(){el.removeAttribute('data-personal')},${PLACEHOLDER_FAILSAFE_MS})}}catch(e){}})()`;

/**
 * The pre-paint half of the row. A SERVER component on purpose: an inline script only executes when it
 * arrives in the HTML. Must sit directly after <HomeToursRow/> in the document.
 */
export function HomeToursReserve() {
  return <script dangerouslySetInnerHTML={{ __html: RESERVE_SCRIPT }} />;
}
```

- [ ] **Step 4: Write the client row**

Create `src/components/gyg/home/HomeToursRow.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from '@/components/site/LocaleLink';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { categoryHref } from '@/lib/catalogue/category-hubs';
import { homeTile, type HomeTour } from '@/lib/catalogue/home-tours';
import {
  chooseHomeRow,
  homeRowHeading,
  mauritiusTomorrow,
  type HomeRowVariant,
} from '@/lib/catalogue/home-row';
import { pushDataLayerEvent } from '@/lib/consent/gtag';
import { INTEREST_EVENT, clearInterest, readInterest } from '@/lib/recent/interest';
import { readOnIsland, writeOnIsland } from '@/lib/recent/on-island';
import { RECENT_VIEWS_EVENT } from '@/lib/recent/views';
import { homePicksSchema, type HomePicks } from '@/lib/validation/home-picks';
import { useHomeActivities } from '../HomeShowcaseContext';
import { readContinuingSlugs } from './ContinuePlanning';
import { HOME_TOURS_ID } from './HomeToursReserve';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Tiles are drawn at up to ~190 CSS px; these only reserve the square before the photo arrives. */
const TILE_SIZE = 500;
/** Past this the row stays as it is: a slow answer must not swap tiles long after reading started. */
const FETCH_BUDGET_MS = 1500;

interface Shown {
  variant: HomeRowVariant;
  slugs: string[];
}

async function getData(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  const body = (await res.json()) as { ok?: boolean; data?: unknown } | null;
  return body?.ok ? body.data : null;
}

/**
 * The homepage's first row, under the hero. The server renders "Most booked by our guests" (or today's
 * private tours) — the same HTML for everyone, which is what Google sees. In the browser, chooseHomeRow
 * may swap the tiles for the guides this visitor read or, if they are in Mauritius, the tours still free
 * tomorrow.
 *
 * FOOTPRINT: a swap must never move the page. Every tile reserves two title lines and always has a price
 * line ("On request" when there is no price); on phones the heading always reserves two lines; and a
 * row the pre-paint script marked shows same-size placeholders instead of tiles until the client has
 * chosen.
 */
export function HomeToursRow({
  serverVariant,
  serverSlugs,
  serverPicks,
}: {
  serverVariant: HomeRowVariant;
  serverSlugs: string[];
  serverPicks: HomePicks | null;
}) {
  const t = useT();
  const activities = useHomeActivities();
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState<Shown>({ variant: serverVariant, slugs: serverSlugs });
  // What the last decision knew, so a re-decision (Clear, a guide read in another tab) reuses it.
  const known = useRef<{ picks: HomePicks | null; onIsland: boolean; variant: HomeRowVariant }>({
    picks: serverPicks,
    onIsland: false,
    variant: serverVariant,
  });

  const decide = useCallback(() => {
    const row = chooseHomeRow({
      activities,
      picks: known.current.picks,
      tomorrow: mauritiusTomorrow(new Date()),
      interest: readInterest(),
      continuing: readContinuingSlugs(),
      onIsland: known.current.onIsland,
    });
    // Never swap to nothing: an empty answer keeps the tiles already on screen.
    if (row.tiles.length === 0) return;
    known.current.variant = row.variant;
    setShown({ variant: row.variant, slugs: row.tiles.map((x) => x.tour.slug) });
  }, [activities]);

  // Storage alone: a guide reader, or a visit already known to be in Mauritius, gets their row at
  // hydration — behind the placeholders the pre-paint script put up — with no network wait.
  useLayoutEffect(() => {
    known.current.onIsland = readOnIsland() === true;
    decide();
    ref.current?.removeAttribute('data-personal');
  }, [decide]);

  // Then the network: where they are browsing from, and fresh picks.
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_BUDGET_MS);
    const as = new URLSearchParams(window.location.search).get('as');
    const localityUrl = `/api/planner/locality${as ? `?as=${encodeURIComponent(as)}` : ''}`;
    Promise.all([
      getData(localityUrl, ctrl.signal),
      getData('/api/v1/activities/picks', ctrl.signal),
    ])
      .then(([locality, picks]) => {
        if (!live) return;
        const onIsland = Boolean((locality as { onIsland?: unknown } | null)?.onIsland);
        writeOnIsland(onIsland);
        known.current.onIsland = onIsland;
        const parsed = homePicksSchema.safeParse(picks);
        if (parsed.success) known.current.picks = parsed.data;
        decide();
      })
      .catch(() => {
        // Slow or failed: keep the row the visitor is already looking at.
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (live) pushDataLayerEvent({ event: 'home_row', home_row: known.current.variant });
      });
    return () => {
      live = false;
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [decide]);

  // A guide read (or "Clear") in this tab or another re-decides.
  useEffect(() => {
    const events = [INTEREST_EVENT, RECENT_VIEWS_EVENT, 'storage'];
    for (const e of events) window.addEventListener(e, decide);
    return () => {
      for (const e of events) window.removeEventListener(e, decide);
    };
  }, [decide]);

  const bySlug = new Map(activities.map((a) => [a.slug, a]));
  const tiles = shown.slugs
    .map((slug) => {
      const tour = bySlug.get(slug);
      return tour ? homeTile(tour) : null;
    })
    .filter((x): x is HomeTour => x !== null);
  if (tiles.length === 0) return null;
  const seeAll =
    shown.variant === 'private' ? categoryHref(tiles[0]!.tour.category) : '/activities';

  return (
    <section
      id={HOME_TOURS_ID}
      ref={ref}
      // The pre-paint script sets data-personal before React hydrates; that attribute is expected to differ.
      suppressHydrationWarning
      aria-labelledby="tours-heading"
      className="mx-auto max-w-shell px-6 pt-10 sm:pt-12"
    >
      <div className="flex items-end justify-between gap-4">
        <h2
          id="tours-heading"
          className="flex min-h-[3em] items-end text-[clamp(21px,2.3vw,26px)] font-extrabold tracking-[-0.02em] text-ink [[data-personal=on]_&]:invisible sm:min-h-0"
        >
          {homeRowHeading(shown.variant, t)}
        </h2>
        <div className="flex shrink-0 items-baseline gap-4">
          {shown.variant === 'guides' && (
            <button
              type="button"
              onClick={() => clearInterest()}
              aria-label={t('Clear these suggestions')}
              className="rounded-md text-[13.5px] font-semibold text-ink-muted underline decoration-ink/25 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink"
            >
              {t('Clear')}
            </button>
          )}
          <Link
            href={seeAll}
            className="text-[14px] font-bold text-teal-dark underline decoration-teal/40 decoration-2 underline-offset-4 hover:decoration-teal"
          >
            {t('See all')}
          </Link>
        </div>
      </div>

      {/* Phones: an edge-to-edge snap rail (the next tile peeks in). sm+: a plain grid. scroll-px-6
          must mirror px-6 — snapping aligns to the padding box. */}
      <div className="relative mt-5">
        <ul className="no-bar -mx-6 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto px-6 [[data-personal=on]_&]:invisible sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-6">
          {tiles.map((tile) => (
            <li key={tile.tour.slug} className="w-[44%] shrink-0 snap-start sm:w-auto">
              <HomeTourTile tour={tile.tour} image={tile.image} />
            </li>
          ))}
        </ul>
        <TilePlaceholders />
      </div>
    </section>
  );
}

function HomeTourTile({ tour, image }: HomeTour) {
  const t = useT();
  return (
    <Link href={`/activities/${tour.slug}`} className="group block rounded-2xl">
      <div className="aspect-square overflow-hidden rounded-2xl bg-teal-tint">
        <img
          src={image.url}
          alt={image.alt ?? tour.title}
          width={TILE_SIZE}
          height={TILE_SIZE}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
        />
      </div>
      {/* Always two lines tall (2 × leading-snug) and always a price line: see FOOTPRINT above. */}
      <p className="mt-3 line-clamp-2 min-h-[2.75em] text-[16px] font-extrabold leading-snug tracking-[-0.01em] text-ink decoration-2 underline-offset-4 group-hover:underline">
        {tour.title}
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">
        {tour.fromPriceEur != null ? (
          <>
            {t('from')} <Price eur={tour.fromPriceEur} className="text-[14px] font-bold text-ink" />
            {tour.pricingMode === 'vehicle' && ` ${t('per vehicle')}`}
          </>
        ) : (
          // Same 14px inline as the price, so this line is exactly as tall.
          <span className="text-[14px] font-bold text-ink">{t('On request')}</span>
        )}
      </p>
    </Link>
  );
}

/** What a marked row shows until the client has chosen: the tiles' footprint, greyed. */
function TilePlaceholders() {
  return (
    <div
      aria-hidden
      className="pointer-events-none invisible absolute inset-0 -mx-6 flex gap-4 overflow-hidden px-6 [[data-personal=on]_&]:visible sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:px-0 lg:grid-cols-6"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="w-[44%] shrink-0 sm:w-auto">
          <div className="aspect-square rounded-2xl bg-ink/[0.06]" />
          <div className="mt-3 h-4 w-11/12 rounded bg-ink/[0.06]" />
          <div className="mt-2 h-4 w-7/12 rounded bg-ink/[0.06]" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite HomeTours as the server wrapper**

Replace the whole of `src/components/gyg/home/HomeTours.tsx` with:

```tsx
import type { TourSummary } from '@/lib/validation/tours';
import type { HomePicks } from '@/lib/validation/home-picks';
import { chooseHomeRow } from '@/lib/catalogue/home-row';
import { HomeToursRow } from './HomeToursRow';
import { HomeToursReserve } from './HomeToursReserve';

/**
 * The homepage's first row (see HomeToursRow and chooseHomeRow). The page is edge-cached and identical
 * for everyone, so the server knows neither the guides a visitor read nor where they are: it renders
 * "Most booked by our guests" — or, when the picks are missing or too thin, our private day tours, the
 * row this used to be — and the browser takes it from there.
 */
export function HomeTours({
  activities,
  picks,
}: {
  activities: TourSummary[];
  picks: HomePicks | null;
}) {
  const row = chooseHomeRow({ activities, picks, tomorrow: null });
  if (row.tiles.length === 0) return null;

  return (
    <>
      <HomeToursRow
        serverVariant={row.variant}
        serverSlugs={row.tiles.map((x) => x.tour.slug)}
        serverPicks={picks}
      />
      {/* Must directly follow the row it marks. */}
      <HomeToursReserve />
    </>
  );
}
```

- [ ] **Step 6: Load the picks with the catalogue, in parallel**

In `app/(site)/page.tsx`:

Add imports:

```tsx
import { homePicks } from '@/lib/services/home-picks';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { Locale } from '@/lib/i18n/config';
```

Change `getActivities` to take the locale — replace `async function getActivities(): Promise<TourSummary[]> {` and its first line inside `try` with:

```tsx
async function getActivities(locale: Locale): Promise<TourSummary[]> {
  try {
    const { items } = await searchActivities(publicServiceContext(locale), {
```

Add below `getActivities`:

```tsx
/** The first row's shared picks. A failure renders today's private-tours row, never an error page. */
async function getPicks(locale: Locale): Promise<HomePicks | null> {
  try {
    return await homePicks(publicServiceContext(locale));
  } catch (error) {
    console.error('[home] picks fetch failed', error);
    return null;
  }
}
```

In `HomePage`, replace `const activities = await getActivities();` with:

```tsx
const locale = await getLocale();
// Together, not one after the other: each is a round trip to the database.
const [activities, picks] = await Promise.all([getActivities(locale), getPicks(locale)]);
```

and replace `<HomeTours activities={activities} />` with `<HomeTours activities={activities} picks={picks} />`. Update the doc comment above `HomePage`: replace "A first-time visitor gets our private day tours straight under the hero." with "Under the hero, every visitor gets the row chooseHomeRow picks for them (most booked by default)."

- [ ] **Step 7: Add the French for the new button strings**

In `src/lib/i18n/messages.ts`, after `'Most booked by our guests': …` add:

```ts
  'Clear these suggestions': 'Effacer ces suggestions',
```

(`'Clear'`, `'See all'`, `'On request'`, `'from'`, `'per vehicle'` already exist.)

Placeholder styling uses Tailwind arbitrary variants (`[[data-personal=on]_&]:invisible` compiles to `[data-personal=on] .x { visibility: hidden }`), not a named `group`: the tiles already use an unnamed `group` for their hover effect, and a second `group` on the section would make every tile react to hovering anywhere in the row.

- [ ] **Step 8: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit && node scripts/i18n-scan.mjs`
Expected: clean / PASS. If lint flags the `react-hooks/exhaustive-deps` rule, read the message — `decide` is the only dependency each effect needs.

- [ ] **Step 9: Commit**

```bash
npx prettier --write src/components/gyg/home/HomeToursRow.tsx src/components/gyg/home/HomeToursReserve.tsx src/components/gyg/home/HomeTours.tsx src/components/gyg/home/ContinuePlanning.tsx "app/(site)/page.tsx" src/lib/consent/gtag.ts src/lib/i18n/messages.ts
git add src/components/gyg/home/HomeToursRow.tsx src/components/gyg/home/HomeToursReserve.tsx src/components/gyg/home/HomeTours.tsx src/components/gyg/home/ContinuePlanning.tsx "app/(site)/page.tsx" src/lib/consent/gtag.ts src/lib/i18n/messages.ts
git commit -F - <<'EOF'
feat(home): first row picks guides read, still free tomorrow, or most booked — fixed footprint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Disclosure, handbook, spec touch-ups

**Files:**

- Modify: `app/(site)/cookies/page.tsx`, `src/lib/i18n/messages.ts`
- Modify: `docs/handbook/landmines.md`
- Modify: `docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md`

- [ ] **Step 1: Disclose the browser-only lists on /cookies**

In `app/(site)/cookies/page.tsx`, in the "Strictly necessary" `LegalList`, add after the "Recent searches" item:

```tsx
              <>
                <strong>{t('Recently viewed tours and guides')}</strong>
                {t(
                  ' — remembers the tours you opened and the guides you read, so the homepage can suggest tours. It stays in your browser and is never sent to us; the “Clear” buttons on the homepage remove it.',
                )}
              </>,
```

In `src/lib/i18n/messages.ts`, after `'Clear these suggestions': …` add:

```ts
  'Recently viewed tours and guides': 'Excursions et guides consultés récemment',
  ' — remembers the tours you opened and the guides you read, so the homepage can suggest tours. It stays in your browser and is never sent to us; the “Clear” buttons on the homepage remove it.':
    ' — mémorise les excursions que vous avez ouvertes et les guides que vous avez lus, pour que la page d’accueil vous suggère des excursions. Ces données restent dans votre navigateur et ne nous sont jamais envoyées ; les boutons « Effacer » de la page d’accueil les suppriment.',
```

- [ ] **Step 2: Add the landmines**

In `docs/handbook/landmines.md`, under `## Next.js / Cloudflare`, directly before `### Don't add a cached route without \`Vary: Cookie\``, insert:

```markdown
### The homepage is the same HTML for everyone — personal rows are decided in the browser

`/` is cached for every visitor, so the page itself must never read cookies, headers or the visitor's
country. The first row (`src/components/gyg/home/HomeToursRow.tsx`) renders the shared "Most booked"
row on the server and swaps to the guides-read or on-island row after hydration, using `chooseHomeRow`
(`src/lib/catalogue/home-row.ts`), localStorage, and the uncached `/api/planner/locality`. Every tile
keeps a fixed footprint (two title lines, a price line that reads "On request"), so a swap never moves
the page; a new tile field must keep that.

### A homepage row heading is a claim

"Most booked by our guests" and "Still free tomorrow" are statements of fact about every tile under
them. Never top a row up with tours the heading does not describe — `chooseHomeRow` falls through to the
next rule instead. "Most booked" comes from `api_home_picks` (confirmed + completed bookings, last 90
days, team test bookings excluded); "Still free tomorrow" from real seats, Mauritius date.
```

- [ ] **Step 3: Bring the spec in line with what was built**

In `docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md`:

- Replace the French heading `"Sélectionnés d’après les guides
que vous avez lus"` (it wraps across two lines in the file) with `"D’après les guides que vous avez lus"` — the longer one took three lines on a phone.
- Replace the testing bullet that begins `- Unit/DOM: the row's height is identical` with: `- Browser (preview pane): the row's height is identical across variants at 375 px and 1280 px, including titles of one and two lines and a tile without a price (the unit suite runs without a DOM).`
- In the Rollout section, replace `Update the homepage section of the handbook in the implementation commit.` with `Add the two homepage landmines to docs/handbook/landmines.md (the handbook has no homepage section).`
- After the "Most booked, last 90 days" fact, add the sentence: `The airport transfer is booked through its own flow and is excluded from every tour list (CATALOGUE_HIDDEN_SLUGS), so it never appears in this row; today's six are Catamaran Île aux Cerfs, Catamaran 3 Northern Islands, South Tour, Blue Cruise, North Tour and the Bénitier dolphin swim.`

- [ ] **Step 4: Run the i18n checks**

Run: `npx vitest run tests/unit/i18n-coverage.test.ts && node scripts/i18n-scan.mjs`
Expected: PASS; no missing keys.

- [ ] **Step 5: Commit**

```bash
npx prettier --write "app/(site)/cookies/page.tsx" src/lib/i18n/messages.ts docs/handbook/landmines.md docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md
git add "app/(site)/cookies/page.tsx" src/lib/i18n/messages.ts docs/handbook/landmines.md docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md
git commit -F - <<'EOF'
docs: disclose browser-only tour/guide history on /cookies; homepage-row landmines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Verify — the gate, then a real browser

- [ ] **Step 1: The full gate** (CI runs exactly these and fails fast)

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
```

Expected: all green. Stop any dev server first — never `next build` while one runs from the same checkout.

- [ ] **Step 2: Apply the function to the DEV database (not production)**

`.env.local` targets the DEV Supabase project, and `scripts/db-exec.ts` writes to whatever it targets. Confirm before writing:

```bash
grep '^NEXT_PUBLIC_SUPABASE_URL' .env.local
```

Expected: the URL contains `akhwocmxvpfqrkxywtcp` (dev). If it names any other project, STOP and ask the owner. Then:

```bash
npx tsx scripts/db-exec.ts supabase/migrations/20261017130000_home_picks.sql
```

- [ ] **Step 3: Check every variant in the preview pane**

Start the dev server with `preview_start` (`gytm-dev`), open `http://localhost:3000/`, then:

1. Default: the row heading is "Most booked by our guests" if the dev DB has ≥ 3 booked tours, else "Private day tours with your own driver". `read_network_requests` shows `/api/planner/locality` and `/api/v1/activities/picks` returning 200.
2. `http://localhost:3000/?as=island`: "Still free tomorrow" when ≥ 3 dev tours have a free seat tomorrow; otherwise the default row (correct fall-through). Reload: `sessionStorage['gytm:on-island']` is `'1'`.
3. Guide reader: open any attraction page that lists tours (e.g. `/attractions/ile-aux-cerfs`), then `/` — heading "Picked from the guides you’ve read" with that page's tours; no "Most booked" flash on reload (`data-personal` is gone after load; take a screenshot).
4. "Clear" on the guides row: the row falls back and `localStorage['gytm:interest']` is gone.
5. Height — force the worst cases rather than measuring whatever the dev data shows. With `javascript_tool`, list the catalogue (`await fetch('/api/v1/activities?pageSize=100').then((r) => r.json())`) and pick: the six tours with the SHORTEST titles; the six with the LONGEST titles; and a set of six that includes a tour with `fromPriceEur === null` (an inquiry-only air activity). For each set, write it as the only guide — `localStorage.setItem('gytm:interest', JSON.stringify([{ topic: 'post:test', slugs: SET }]))` — reload, and read `document.getElementById('home-tours').getBoundingClientRect().height`. Do all three at 1280 px, then again after `resize_window` preset `mobile` (375 px), and compare with the default row (`localStorage.removeItem('gytm:interest')`). Expected: one height per width, whatever the set. Remove `gytm:interest` when done.
6. `/fr/`: French headings; `read_console_messages` with `onlyErrors`: no hydration or runtime errors.
7. `resize_window` preset `desktop` when done.

Record what each step showed (screenshots for 1–3) in the session; any failure goes back to the owning task.

---

### Task 10: Ship (after the ~22 Oct homepage re-measure, with the owner's go-ahead)

- [ ] **Step 1:** Ask the owner for the go-ahead to push (pushing `main` deploys web, DB and cron).
- [ ] **Step 2:** `git push origin main`, then watch the release workflow; the change is not done until the `verify` job's final _Edge bundle_ step and the deploy are green.
- [ ] **Step 3:** Production checks:

```bash
curl -s https://bellemaretours.com/api/v1/activities/picks
curl -s https://bellemaretours.com/ | grep -o 'Most booked by our guests' | head -1
```

Expected: `{"ok":true,"data":{"date":…,"mostBooked":[…],"freeTomorrow":[…]}}`; the homepage HTML contains the heading.

- [ ] **Step 4:** Tell the owner the one manual step left: in GTM container `GTM-5F8BVWJL`, add a GA4 Event tag for the custom event `home_row` (parameter `home_row`) so the row's click-through can be compared by variant.

```

```
