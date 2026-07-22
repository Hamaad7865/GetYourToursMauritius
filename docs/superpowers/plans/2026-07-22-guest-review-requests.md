# Post-Trip Review Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a trip ends, automatically email the customer a review request (on-site + Google, never sentiment-gated); let them submit a review without an account via a single-use token; hold it in an admin moderation queue; on approval, publish it both on the site-wide `/reviews` page and — new value discovered during planning — mirror it into the existing per-activity `reviews` table so the specific tour's own rating benefits too; and show a live, read-only panel of the business's actual Google reviews in the same admin screen.

**Architecture:** New `review_invites` (secure token) + `guest_reviews` (moderation queue) tables. A 4th step on the existing 5-minute maintenance cron finds trips that ended before "yesterday, 9am Mauritius time" and enqueues invites + emails. Submission goes through a SECURITY DEFINER RPC that validates the token server-side — no login required. Approval is a SECURITY DEFINER RPC that atomically publishes to `guest_reviews`, mirrors into `reviews` (feeding `activities.rating_avg`), and recomputes the aggregate. Google's own reviews are fetched live (never cached, per Google's ToS) using the existing Places API key, in a read-only admin panel.

**Tech Stack:** Next.js 15 edge routes, Supabase Postgres (plpgsql RPCs, RLS), Zod validation, Resend email, existing Google Places API (New) client pattern, Vitest + PGlite integration tests.

**Deviation from the approved spec** (`docs/superpowers/specs/2026-07-21-guest-review-requests-design.md`), discovered during this planning pass — call this out to the user when the plan is presented: the codebase already has a per-activity `reviews` table + `api_submit_review`/`api_my_reviews` RPCs (booking-gated, **login required**, auto-published, no moderation — see `supabase/migrations/20260742000000_reviews.sql`). It powers `activities.rating_avg`/`rating_count` shown on activity detail pages via `ReviewList.tsx`. It cannot serve guest bookings and has no moderation gate, so it is **not** a substitute for this feature — but on approval, this plan mirrors the guest review into that same `reviews` table (with `user_id = null`, an already-supported case per that migration's own comment) so the specific activity's rating benefits too, not just the site-wide `/reviews` page stat the spec originally scoped. This is purely additive — nothing about the approved design (timing, token security, moderation queue, non-gated Google linking, live 4.8/5 recalculation) changes.

---

## File Structure

| File                                                   | Responsibility                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `supabase/migrations/20260822000000_guest_reviews.sql` | New tables, RLS, 3 RPCs, grants                                             |
| `supabase/catch-up.sql`                                | Mirror of the above (append)                                                |
| `src/lib/supabase/types.ts`                            | Hand-added Row/Insert types for the 2 new tables                            |
| `tests/db/rpc.ts`                                      | New RPC names added to `ALLOWED`                                            |
| `src/lib/validation/reviews.ts` (NEW)                  | Zod schema for the submit payload                                           |
| `src/lib/services/reviews.ts` (NEW)                    | Thin `callRpc` wrappers (submit / moderate / enqueue invites)               |
| `src/lib/email/review-request.ts` (NEW)                | Email renderer, mirrors `booking-confirmation.ts` style                     |
| `src/lib/services/notifications.ts`                    | Add `enrichReviewRequest` + dispatch branch                                 |
| `src/lib/services/maintenance.ts`                      | Add `enqueueReviewInvites` wrapper                                          |
| `app/api/v1/internal/maintenance/route.ts`             | Add step 4                                                                  |
| `app/api/v1/reviews/submit/route.ts` (NEW)             | Public, rate-limited submission endpoint                                    |
| `app/(site)/reviews/write/page.tsx` (NEW)              | Server component: resolves token → context                                  |
| `src/components/site/ReviewWriteForm.tsx` (NEW)        | Client component: the form + thank-you screen                               |
| `src/lib/maps/google-own-reviews.ts` (NEW)             | Live, uncached Places API fetch of the business's own reviews               |
| `app/api/v1/reviews/google-live/route.ts` (NEW)        | Staff-gated wrapper around the above                                        |
| `src/lib/admin/reviews.ts` (NEW)                       | Browser-client data layer for the admin screen                              |
| `src/components/admin/AdminReviews.tsx` (NEW)          | Moderation queue + live Google panel                                        |
| `app/(site)/admin/reviews/page.tsx` (NEW)              | Route wrapper (mirrors `admin/leads/page.tsx`)                              |
| `src/components/admin/AdminShell.tsx`                  | Add the nav entry                                                           |
| `src/lib/content/guest-reviews-live.ts` (NEW)          | Merges approved guest reviews into `reviewStats`/`featuredReviews`          |
| `src/lib/seo/jsonld.ts`                                | `reviewsPageJsonLd` takes `stats` as a parameter instead of a static import |
| `app/(site)/reviews/page.tsx`                          | Swap static imports for the async live loaders                              |

---

## Task 1: Migration — tables, RLS, RPCs, grants

**Files:**

- Create: `supabase/migrations/20260822000000_guest_reviews.sql`
- Test: `tests/integration/guest-reviews.test.ts` (written in Task 4, run against this migration)

- [ ] **Step 1: Write the migration**

```sql
-- Post-trip review requests: a guest-safe (no-login) submission flow gated by a single-use token,
-- with admin moderation before anything is public. On approval, the review is also mirrored into
-- the existing per-activity `reviews` table (user_id = null, an already-supported case — see
-- 20260742000000_reviews.sql) so the specific activity's rating_avg/rating_count benefits too, not
-- just the site-wide /reviews page. See docs/superpowers/specs/2026-07-21-guest-review-requests-design.md.

create table review_invites (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  activity_id uuid not null references activities (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);
create index review_invites_token_idx on review_invites (token);

create table guest_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  activity_id uuid not null references activities (id),
  customer_name text not null,
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) >= 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by uuid references profiles (id)
);
create index guest_reviews_status_idx on guest_reviews (status, submitted_at);

alter table review_invites enable row level security;
alter table guest_reviews enable row level security;

-- No anon/authenticated policy on review_invites at all — reached only through the token-gated RPC
-- below (SECURITY DEFINER bypasses RLS). Staff can see it for support/debugging.
create policy review_invites_staff on review_invites for all using (is_staff()) with check (is_staff());

create policy guest_reviews_staff on guest_reviews for all using (is_staff()) with check (is_staff());
create policy guest_reviews_public_read on guest_reviews for select using (status = 'approved');
-- No insert/update policy for anon/authenticated — writes go through the RPCs below.

-- ── api_submit_guest_review ─────────────────────────────────────────────────────────────────────
-- The real security boundary: the token (not auth.uid(), which guests don't have) proves the caller
-- is the actual customer. Single-use — used_at is set atomically in the same transaction as the
-- insert, so two concurrent requests with the same token can't both succeed.
create or replace function api_submit_guest_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(p ->> 'token', '');
  v_rating int := (p ->> 'rating')::int;
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_body text := nullif(btrim(p ->> 'body'), '');
  v_invite review_invites;
  v_review guest_reviews;
begin
  if v_token is null then
    raise exception 'invalid_or_expired_token';
  end if;
  if v_rating is null or v_rating < 1 or v_rating > 5 then
    raise exception 'invalid_request: rating must be 1..5';
  end if;
  if v_name is null then
    raise exception 'invalid_request: name is required';
  end if;
  if v_body is null or char_length(v_body) < 5 then
    raise exception 'invalid_request: body must be at least 5 characters';
  end if;

  select * into v_invite from review_invites where token = v_token for update;
  if v_invite is null or v_invite.used_at is not null or v_invite.expires_at < now() then
    raise exception 'invalid_or_expired_token';
  end if;

  insert into guest_reviews (booking_id, activity_id, customer_name, rating, body)
  values (v_invite.booking_id, v_invite.activity_id, v_name, v_rating, v_body)
  returning * into v_review;

  update review_invites set used_at = now() where id = v_invite.id;

  return jsonb_build_object(
    'id', v_review.id, 'status', v_review.status, 'submittedAt', v_review.submitted_at
  );
end;
$$;

-- ── api_moderate_guest_review ───────────────────────────────────────────────────────────────────
-- Staff-only (checked in-body, since SECURITY DEFINER bypasses RLS). Approve is atomic: publish the
-- guest_reviews row, mirror it into `reviews` (user_id null — an already-supported case), and
-- recompute the activity's rating_avg/rating_count with the SAME logic api_submit_review already
-- uses, so the two insertion paths can never leave the aggregate inconsistent.
create or replace function api_moderate_guest_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_action text := p ->> 'action';
  v_review guest_reviews;
begin
  if not is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_action not in ('approve', 'reject') then
    raise exception 'invalid_request: action must be approve or reject';
  end if;

  select * into v_review from guest_reviews where id = v_id for update;
  if v_review is null then
    raise exception 'not_found';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'invalid_request: review is not pending';
  end if;

  update guest_reviews
     set status = case when v_action = 'approve' then 'approved' else 'rejected' end,
         moderated_at = now(),
         moderated_by = auth.uid()
   where id = v_id
  returning * into v_review;

  if v_action = 'approve' then
    insert into reviews (activity_id, user_id, author, rating, text, created_at)
    values (v_review.activity_id, null, v_review.customer_name, v_review.rating, v_review.body, v_review.submitted_at);

    update activities a
       set rating_count = sub.cnt,
           rating_avg = case when sub.cnt = 0 then null else round(sub.avg, 1) end
      from (select count(*)::int cnt, avg(rating)::numeric avg from reviews where activity_id = v_review.activity_id) sub
     where a.id = v_review.activity_id;
  end if;

  return jsonb_build_object('id', v_review.id, 'status', v_review.status);
end;
$$;

-- ── api_enqueue_review_invites ──────────────────────────────────────────────────────────────────
-- Service-role only (the maintenance cron). Finds confirmed bookings whose LAST-ending occurrence
-- item crossed "the following day, 9am Mauritius time" and has no invite yet, then creates the
-- invite + the review-request notification in one pass. Mauritius-anchored per
-- docs/handbook/landmines.md — this class of bug has hit this codebase three times before.
create or replace function api_enqueue_review_invites()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_candidate record;
  v_token text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_candidate in (
    with last_occurrence as (
      select bi.booking_id, so.ends_at, ao.activity_id,
             row_number() over (partition by bi.booking_id order by so.ends_at desc) as rn
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
      join activity_options ao on ao.id = bi.activity_option_id
    )
    select b.id as booking_id, b.customer_email, b.customer_name,
           a.id as activity_id, a.title as activity_title, lo.ends_at
    from bookings b
    join last_occurrence lo on lo.booking_id = b.id and lo.rn = 1
    join activities a on a.id = lo.activity_id
    where b.status = 'confirmed'
      and b.customer_email is not null
      and not exists (select 1 from review_invites ri where ri.booking_id = b.id)
      and ((lo.ends_at at time zone 'Indian/Mauritius')::date + 1 + time '09:00')
            at time zone 'Indian/Mauritius' <= now()
  )
  loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    insert into review_invites (booking_id, activity_id, token)
    values (v_candidate.booking_id, v_candidate.activity_id, v_token);

    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_candidate.customer_email, 'review_request',
      jsonb_build_object(
        'token', v_token,
        'activityTitle', v_candidate.activity_title,
        'customerName', v_candidate.customer_name
      ),
      v_candidate.booking_id,
      'review_request:' || v_candidate.booking_id
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_submit_guest_review(jsonb) from public;
revoke execute on function api_moderate_guest_review(jsonb) from public;
revoke execute on function api_enqueue_review_invites() from public;
grant execute on function api_submit_guest_review(jsonb) to anon, authenticated;
grant execute on function api_moderate_guest_review(jsonb) to authenticated;
grant execute on function api_enqueue_review_invites() to service_role;
```

- [ ] **Step 2: Run the full test suite to confirm the migration applies cleanly**

Run: `npm test -- tests/integration/`
Expected: all existing integration tests still PASS (the new migration file is picked up automatically by `tests/db/pglite.ts`, which applies every file in `supabase/migrations/` in filename order — no test references the new tables yet, so this just proves the SQL itself is valid).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260822000000_guest_reviews.sql
git commit -m "feat(db): guest_reviews + review_invites — schema, RLS, moderation RPCs"
```

---

## Task 2: Mirror into catch-up.sql + regenerate the fresh-install bundle

**Files:**

- Modify: `supabase/catch-up.sql` (append)
- Modify: `supabase/setup.sql` (regenerated, do not hand-edit)

- [ ] **Step 1: Append the migration to the end of `supabase/catch-up.sql`**

Open `supabase/catch-up.sql`, go to the end of the file, and append:

```sql
-- ---- 20260822000000_guest_reviews.sql ----
```

followed by the **exact same SQL** from Task 1 Step 1 (the whole file, verbatim — this is what production actually receives; see `docs/handbook/database.md`).

- [ ] **Step 2: Regenerate the fresh-install bundle**

Run: `npm run seed:gen && npm run setup:sql`
Expected: `supabase/setup.sql` is rewritten (git diff shows the new migration's SQL appended inside the bundle).

- [ ] **Step 3: Run the parity guards**

Run: `npx vitest run tests/integration/catch-up-parity.test.ts tests/integration/setup-sql-parity.test.ts tests/integration/setup-sql-executes.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/catch-up.sql supabase/setup.sql
git commit -m "chore(db): mirror guest_reviews migration into catch-up.sql, regen setup.sql"
```

---

## Task 3: Type definitions + RPC allowlist

**Files:**

- Modify: `src/lib/supabase/types.ts`
- Modify: `tests/db/rpc.ts`

- [ ] **Step 1: Add the Row/Insert types**

In `src/lib/supabase/types.ts`, near the other hand-authored table types (alongside `SeoMetaRow` etc.), add:

```ts
type ReviewInvitesRow = {
  id: string;
  booking_id: string;
  activity_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};
type ReviewInvitesInsert = {
  id?: string;
  booking_id: string;
  activity_id: string;
  token: string;
  created_at?: string;
  expires_at?: string;
  used_at?: string | null;
};

type GuestReviewsRow = {
  id: string;
  booking_id: string;
  activity_id: string;
  customer_name: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
};
type GuestReviewsInsert = {
  id?: string;
  booking_id: string;
  activity_id: string;
  customer_name: string;
  rating: number;
  body: string;
  status?: 'pending' | 'approved' | 'rejected';
  submitted_at?: string;
  moderated_at?: string | null;
  moderated_by?: string | null;
};
```

Then register both in the `Tables` map (next to `seo_meta: TableDef<SeoMetaRow, SeoMetaInsert>;`):

```ts
review_invites: TableDef<ReviewInvitesRow, ReviewInvitesInsert>;
guest_reviews: TableDef<GuestReviewsRow, GuestReviewsInsert>;
```

- [ ] **Step 2: Add the new RPC names to the test allowlist**

In `tests/db/rpc.ts`, add to the `ALLOWED` set (near `api_seo_meta` / `api_list_posts`):

```ts
  'api_submit_guest_review',
  'api_moderate_guest_review',
  'api_enqueue_review_invites',
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no output, exit 0).

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/types.ts tests/db/rpc.ts
git commit -m "chore(db): register guest_reviews tables + new RPCs for tests"
```

---

## Task 4: Integration tests (PGlite, real Postgres)

**Files:**

- Create: `tests/integration/guest-reviews.test.ts`

- [ ] **Step 1: Write the test file**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

const STAFF = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
const CUSTOMER = 'd2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('guest review requests: token submission + moderation', () => {
  let db: TestDb;
  let activityId: string;
  let bookingId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff'), ($2, 'customer')`, [
      STAFF,
      CUSTOMER,
    ]);
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ($1, 'guest-review-tour', 'activity', 'Guest Review Tour', 'Sightseeing tours', 'published', 'per_person')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
         values ('BMT-GR-1', 'confirmed', 'Alex Guest', 'alex@example.com', 5000, 'EUR')
         returning id`,
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('rejects submission with no token, an unknown token, and validates fields', async () => {
    await db.as(null);
    await expect(
      call(db, 'api_submit_guest_review', { rating: 5, name: 'Alex', body: 'Great trip!' }),
    ).rejects.toThrow('invalid_or_expired_token');
    await expect(
      call(db, 'api_submit_guest_review', {
        token: 'not-a-real-token',
        rating: 5,
        name: 'Alex',
        body: 'Great trip!',
      }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('a valid token succeeds exactly once — the second attempt fails', async () => {
    await db.asOwner();
    const token = 'test-token-abc123';
    await db.pg.query(
      `insert into review_invites (booking_id, activity_id, token) values ($1, $2, $3)`,
      [bookingId, activityId, token],
    );

    await db.as(null); // guest — no session at all
    const first = await call<{ id: string; status: string }>(db, 'api_submit_guest_review', {
      token,
      rating: 5,
      name: 'Alex Guest',
      body: 'Fantastic day out, would book again!',
    });
    expect(first.status).toBe('pending');

    await expect(
      call(db, 'api_submit_guest_review', {
        token,
        rating: 1,
        name: 'Someone else',
        body: 'trying to reuse the token',
      }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('an expired token is rejected', async () => {
    await db.asOwner();
    const token = 'expired-token-xyz';
    await db.pg.query(
      `insert into review_invites (booking_id, activity_id, token, expires_at)
       values ($1, $2, $3, now() - interval '1 day')`,
      [bookingId, activityId, token],
    );
    await db.as(null);
    await expect(
      call(db, 'api_submit_guest_review', { token, rating: 4, name: 'X', body: 'too late' }),
    ).rejects.toThrow('invalid_or_expired_token');
  });

  it('anon cannot select a pending review, and cannot touch review_invites at all', async () => {
    await db.as(null);
    const pending = await db.pg.query(`select * from guest_reviews where status = 'pending'`);
    expect(pending.rows).toHaveLength(0);
    await expect(db.pg.query(`select * from review_invites`)).rejects.toThrow();
  });

  it('only staff can moderate, and approving mirrors into reviews + recomputes the activity rating', async () => {
    const pendingRow = await db
      .asOwner()
      .then(() =>
        db.pg.query<{ id: string }>(
          `select id from guest_reviews where status = 'pending' limit 1`,
        ),
      );
    const reviewId = pendingRow.rows[0]!.id;

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      call(db, 'api_moderate_guest_review', { id: reviewId, action: 'approve' }),
    ).rejects.toThrow('forbidden');

    await db.as({ sub: STAFF, role: 'authenticated' });
    const result = await call<{ status: string }>(db, 'api_moderate_guest_review', {
      id: reviewId,
      action: 'approve',
    });
    expect(result.status).toBe('approved');

    const mirrored = await db.pg.query<{ user_id: string | null; rating: number }>(
      `select user_id, rating from reviews where activity_id = $1`,
      [activityId],
    );
    expect(mirrored.rows).toHaveLength(1);
    expect(mirrored.rows[0]!.user_id).toBeNull();
    expect(mirrored.rows[0]!.rating).toBe(5);

    const activity = await db.pg.query<{ rating_avg: string; rating_count: number }>(
      `select rating_avg, rating_count from activities where id = $1`,
      [activityId],
    );
    expect(activity.rows[0]!.rating_count).toBe(1);
    expect(Number(activity.rows[0]!.rating_avg)).toBe(5);

    // Public can now read the approved review.
    await db.as(null);
    const approved = await db.pg.query(`select * from guest_reviews where status = 'approved'`);
    expect(approved.rows).toHaveLength(1);
  });

  it('re-moderating an already-decided review is rejected', async () => {
    await db.asOwner();
    const row = await db.pg.query<{ id: string }>(
      `select id from guest_reviews where status = 'approved' limit 1`,
    );
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      call(db, 'api_moderate_guest_review', { id: row.rows[0]!.id, action: 'reject' }),
    ).rejects.toThrow('invalid_request');
  });
});

describe('api_enqueue_review_invites: the Mauritius-anchored eligibility boundary', () => {
  let db: TestDb;
  let activityId: string;
  let optionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status, pricing_mode)
         values ($1, 'tz-boundary-tour', 'activity', 'TZ Boundary Tour', 'Sightseeing tours', 'published', 'per_person')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [activityId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  async function bookingEndingAt(endsAt: string, statusExtra = ''): Promise<string> {
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (ref, status, customer_name, customer_email, total_minor, currency)
         values ($1, 'confirmed', 'Tester', $2, 5000, 'EUR') returning id`,
        [
          `BMT-TZ-${Math.random().toString(36).slice(2, 8)}`,
          `tester-${statusExtra || Date.now()}@example.com`,
        ],
      )
    ).rows[0]!.id;
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
         values ($1, (select operator_id from activities where id = $2), $3::timestamptz - interval '2 hours', $3::timestamptz, 10, 'open')
         returning id`,
        [optionId, activityId, endsAt],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 5000, 5000)`,
      [bookingId, occId, optionId],
    );
    return bookingId;
  }

  it('does NOT enqueue an invite for a trip that ended late tonight, Mauritius time', async () => {
    await db.asOwner();
    // "Now" in the test DB is real wall-clock time; simulate a trip ending 1 hour ago (definitely
    // before the next day's 9am Mauritius boundary) — must NOT be eligible yet.
    await bookingEndingAt(`now() - interval '1 hour'`);
    const count = await call<number>(db, 'api_enqueue_review_invites', {});
    const invites = await db.pg.query(`select * from review_invites`);
    expect(count).toBe(0);
    expect(invites.rows).toHaveLength(0);
  });

  it('DOES enqueue an invite for a trip that ended more than a day ago', async () => {
    await db.asOwner();
    await bookingEndingAt(`now() - interval '2 days'`);
    const count = await call<number>(db, 'api_enqueue_review_invites', {});
    expect(count).toBe(1);
    const invites = await db.pg.query(`select token from review_invites`);
    expect(invites.rows).toHaveLength(1);
    const outbox = await db.pg.query(
      `select template, payload from notification_outbox where template = 'review_request'`,
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.payload).toMatchObject({ activityTitle: 'TZ Boundary Tour' });
  });

  it('is idempotent — a second run enqueues nothing new for the same bookings', async () => {
    await db.asOwner();
    const count = await call<number>(db, 'api_enqueue_review_invites', {});
    expect(count).toBe(0);
  });

  it('anon/authenticated cannot call it directly', async () => {
    await db.as(null);
    await expect(call(db, 'api_enqueue_review_invites', {})).rejects.toThrow('forbidden');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/integration/guest-reviews.test.ts`
Expected: all PASS. If any fail, fix the migration from Task 1 (not the test) and re-run — this is the real verification that the SQL behaves as designed.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/guest-reviews.test.ts
git commit -m "test(db): guest review token flow, moderation, and the Mauritius eligibility boundary"
```

---

## Task 5: Validation schema + service layer

**Files:**

- Create: `src/lib/validation/reviews.ts`
- Create: `src/lib/services/reviews.ts`

- [ ] **Step 1: Write the Zod schema**

```ts
// src/lib/validation/reviews.ts
import { z } from 'zod';

export const submitGuestReviewInputSchema = z.object({
  token: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(5).max(2000),
});
export type SubmitGuestReviewInput = z.infer<typeof submitGuestReviewInputSchema>;
```

- [ ] **Step 2: Write the service wrappers**

```ts
// src/lib/services/reviews.ts
import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import type { SubmitGuestReviewInput } from '@/lib/validation/reviews';

const submitResultSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  submittedAt: z.string(),
});
export type SubmitGuestReviewResult = z.infer<typeof submitResultSchema>;

/** Submit a review via a one-time invite token — no login required (guest bookings included). */
export async function submitGuestReview(
  ctx: ServiceContext,
  input: SubmitGuestReviewInput,
): Promise<SubmitGuestReviewResult> {
  const data = await callRpc(ctx, 'api_submit_guest_review', input);
  return submitResultSchema.parse(data);
}

/**
 * Note: there is deliberately NO `moderateGuestReview` wrapper here. Moderation is staff-only and
 * happens from the admin screen, a 'use client' React component with no `Request`/service-role
 * credentials to build a ServiceContext from — like every other admin screen in this codebase
 * (AdminLeads, vehicle-pricing), it calls the RPC directly through the browser Supabase client under
 * RLS (see Task 12). Adding an unused server-side wrapper here would be dead code.
 */

/** Service-role sweep: enqueue review-request invites for trips that ended before the eligibility
 *  boundary. Returns the number of invites created. Called by the maintenance cron. */
export async function enqueueReviewInvites(ctx: ServiceContext): Promise<number> {
  const data = await callRpc(ctx, 'api_enqueue_review_invites', {});
  return z.number().int().parse(data);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation/reviews.ts src/lib/services/reviews.ts
git commit -m "feat: guest review service layer (submit, enqueue invites)"
```

---

## Task 6: The review-request email

**Files:**

- Create: `src/lib/email/review-request.ts`
- Test: `tests/unit/review-request-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/review-request-email.test.ts
import { describe, expect, it } from 'vitest';
import { renderReviewRequestEmail } from '@/lib/email/review-request';

const GOOGLE_URL = 'https://g.page/r/test-review-link/review';

describe('renderReviewRequestEmail', () => {
  it('includes both buttons, worded identically regardless of any known rating', () => {
    const email = renderReviewRequestEmail({
      customerName: 'Alex Guest',
      activityTitle: 'Dolphin Swim',
      siteReviewUrl: 'https://bellemaretours.com/reviews/write?token=abc123',
      googleReviewUrl: GOOGLE_URL,
    });
    expect(email.subject).toContain('Dolphin Swim');
    expect(email.html).toContain('Review us on our site');
    expect(email.html).toContain('Review us on Google');
    expect(email.html).toContain('https://bellemaretours.com/reviews/write?token=abc123');
    expect(email.html).toContain(GOOGLE_URL);
    expect(email.text).toContain(GOOGLE_URL);
  });

  it('escapes a hostile activity title so it cannot break out of the HTML', () => {
    const email = renderReviewRequestEmail({
      customerName: 'X',
      activityTitle: '<script>alert(1)</script>',
      siteReviewUrl: 'https://bellemaretours.com/reviews/write?token=x',
      googleReviewUrl: GOOGLE_URL,
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/unit/review-request-email.test.ts`
Expected: FAIL — `Cannot find module '@/lib/email/review-request'`.

- [ ] **Step 3: Write the renderer**

```ts
// src/lib/email/review-request.ts
import { escapeHtml } from './booking-confirmation';

/**
 * Post-trip review-request email. Mirrors booking-confirmation.ts's email-safe construction
 * (inline styles only, table layout, ~600px width). The two buttons are ALWAYS both present and
 * identically worded — this feature must never branch on a rating to decide whether the Google
 * button appears (Google's anti-gating policy; see the design spec §2e). No I/O, no Date.now().
 */

const ACCENT = '#0E8C92';
const INK = '#1f2937';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

export interface ReviewRequestInput {
  customerName: string;
  activityTitle: string;
  siteReviewUrl: string;
  googleReviewUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function button(href: string, label: string): string {
  return `
              <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;margin:0 8px 8px 0;">
                <tr>
                  <td style="border-radius:6px;background:${ACCENT};">
                    <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>`;
}

export function renderReviewRequestEmail(input: ReviewRequestInput): RenderedEmail {
  const operator = 'Belle Mare Tours';
  const activity = escapeHtml(input.activityTitle);
  const name = escapeHtml(input.customerName);

  const subject = `How was your ${input.activityTitle}?`;

  const html = `<!-- ${operator} review request -->
<div style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td style="background:${ACCENT};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${operator}
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px 0;color:${INK};font-size:22px;">How was your ${activity}?</h1>
              <p style="margin:0 0 20px 0;color:${MUTED};font-size:14px;line-height:1.5;">
                Hi ${name}, thanks for touring with us. If you have a minute, we'd love to hear how it went — it helps other travellers find us too.
              </p>
              ${button(input.siteReviewUrl, 'Review us on our site')}
              ${button(input.googleReviewUrl, 'Review us on Google')}
              <p style="margin:20px 0 0 0;color:${MUTED};font-size:13px;line-height:1.6;">
                Thanks again for choosing ${operator}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f9fafb;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
              ${operator}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  const text = [
    `Hi ${input.customerName},`,
    '',
    `How was your ${input.activityTitle}? If you have a minute, we'd love to hear how it went.`,
    '',
    `Review us on our site: ${input.siteReviewUrl}`,
    `Review us on Google: ${input.googleReviewUrl}`,
    '',
    `Thanks again for choosing ${operator}.`,
  ].join('\n');

  return { subject, html, text };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/unit/review-request-email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/review-request.ts tests/unit/review-request-email.test.ts
git commit -m "feat(email): review-request template — two equal-weight, non-gated buttons"
```

---

## Task 7: Wire the email into the notification drain

**Files:**

- Modify: `src/lib/services/notifications.ts`
- Modify: `src/lib/seo/site.ts`

- [ ] **Step 1: Add the placeholder Google review link to SITE**

In `src/lib/seo/site.ts`, inside the `profiles` object (next to `google:`), add:

```ts
    /** The direct "leave a review" link from Business Profile Manager → Read reviews → Get more
     *  reviews. Placeholder until the owner grabs the real one — see docs/handbook/operations.md. */
    googleReview: 'https://g.page/r/REPLACE_ME/review',
```

- [ ] **Step 2: Add the enrichment function**

In `src/lib/services/notifications.ts`, add this function near `enrichOwnerDateChanged` (after its closing brace, before `export interface DrainResult`):

```ts
/**
 * Review-request email. Payload-only — the enqueue sweep already embedded activityTitle and
 * customerName at insert time (mirroring enrichOwnerDateChanged's no-DB-load pattern), so this is a
 * pure, synchronous render. The Google button is ALWAYS present — see renderReviewRequestEmail.
 */
function enrichReviewRequest(message: NotificationMessage): void {
  const p = message.payload;
  const token = typeof p.token === 'string' ? p.token : '';
  const activityTitle = typeof p.activityTitle === 'string' ? p.activityTitle : 'your trip';
  const customerName =
    typeof p.customerName === 'string' && p.customerName ? p.customerName : 'there';
  const email = renderReviewRequestEmail({
    customerName,
    activityTitle,
    siteReviewUrl: `${SITE.url}/reviews/write?token=${encodeURIComponent(token)}`,
    googleReviewUrl: SITE.profiles.googleReview,
  });
  message.subject = email.subject;
  message.html = email.html;
  message.text = email.text;
}
```

- [ ] **Step 3: Import the renderer and wire the dispatch branch**

Add the import near the top of `src/lib/services/notifications.ts`:

```ts
import { renderReviewRequestEmail } from '@/lib/email/review-request';
```

In `drainNotifications`, extend the `if/else if` chain (right after the `owner_date_changed` branch):

```ts
      } else if (message.template === 'owner_date_changed') {
        enrichOwnerDateChanged(message);
      } else if (message.template === 'review_request') {
        enrichReviewRequest(message);
      }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/notifications.ts src/lib/seo/site.ts
git commit -m "feat(email): dispatch review_request through the notification drain"
```

---

## Task 8: Extend the maintenance cron

**Files:**

- Modify: `src/lib/services/maintenance.ts`
- Modify: `app/api/v1/internal/maintenance/route.ts`

- [ ] **Step 1: Add the wrapper to maintenance.ts**

In `src/lib/services/maintenance.ts`, add near `materializeAvailability`:

```ts
import { enqueueReviewInvites as enqueueReviewInvitesRpc } from './reviews';

/** Re-exported under the maintenance module's naming convention (the internal route imports every
 *  step from here). Not money-critical, so — unlike the payment/expiry steps — its position in the
 *  maintenance sequence doesn't matter for correctness. */
export async function enqueueReviewInvites(ctx: ServiceContext): Promise<number> {
  return enqueueReviewInvitesRpc(ctx);
}
```

- [ ] **Step 2: Add step 4 to the maintenance route**

In `app/api/v1/internal/maintenance/route.ts`, add the import:

```ts
import {
  runBookingMaintenance,
  materializeAvailability,
  reconcilePaymentsPending,
  enqueueReviewInvites,
} from '@/lib/services/maintenance';
```

Add a 4th step after the `slotsCreated` block (before the `erroredJobs` computation):

```ts
// 4) Post-trip review requests — not money-critical, so position doesn't matter for correctness.
let reviewInvitesCreated: number | { errored: true } = { errored: true };
try {
  reviewInvitesCreated = await enqueueReviewInvites(ctx);
} catch (err) {
  log('review invites sweep', err);
}
```

Update the `erroredJobs` array to include the new step:

```ts
const erroredJobs = [
  ...(failedJob(payments) || paymentsErroredCount > 0 ? ['payments'] : []),
  ...(failedJob(result) ? ['bookingMaintenance'] : []),
  ...(failedJob(slotsCreated) ? ['availability'] : []),
  ...(failedJob(reviewInvitesCreated) ? ['reviewInvites'] : []),
];
```

Update both `jsonError` and `jsonOk` calls to include the new field:

```ts
if (erroredJobs.length > 0) {
  return jsonError(
    503,
    'maintenance_partial_failure',
    `Maintenance job(s) failed: ${erroredJobs.join(', ')} — see server logs`,
    { ...result, slotsCreated, payments, reviewInvitesCreated, erroredJobs },
  );
}
return jsonOk({ ...result, slotsCreated, payments, reviewInvitesCreated });
```

- [ ] **Step 3: Check the maintenance-order test still passes**

Run: `npx vitest run tests/unit/maintenance-route-order.test.ts`
Expected: PASS — the new step is appended after the existing three, so their relative order (the one that test actually guards) is untouched.

- [ ] **Step 4: Typecheck + full unit/integration suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/maintenance.ts app/api/v1/internal/maintenance/route.ts
git commit -m "feat(cron): 4th maintenance step — enqueue post-trip review invites"
```

---

## Task 9: Public submission API route

**Files:**

- Create: `app/api/v1/reviews/submit/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { submitGuestReview } from '@/lib/services/reviews';
import { submitGuestReviewInputSchema } from '@/lib/validation/reviews';
import { jsonOk } from '@/lib/http/envelope';

export const runtime = 'edge';

/**
 * POST /api/v1/reviews/submit — guest-safe review submission (no login). The token, not auth.uid(),
 * proves the caller is the actual customer; api_submit_guest_review validates it server-side and is
 * single-use. Rate-limited to blunt brute-force token guessing — the token's own entropy and
 * single-use property are the real guard. Called via a service-role context because
 * api_submit_guest_review is granted to anon/authenticated directly (no user identity needed), the
 * same pattern as api_create_hold.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'reviews:submit', 5);
  const input = await parseJsonBody(req, submitGuestReviewInputSchema);
  const ctx = serviceRoleRpcContext();
  const result = await submitGuestReview(ctx, input);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
```

- [ ] **Step 2: Confirm the edge-runtime test picks it up**

Run: `npx vitest run tests/unit/edge-runtime.test.ts`
Expected: PASS (the test globs every `app/api/**/route.ts` file — no separate registration needed).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/reviews/submit/route.ts
git commit -m "feat(api): POST /api/v1/reviews/submit — guest-safe, token-gated"
```

---

## Task 10: Live Google reviews (read-only, never cached)

**Files:**

- Create: `src/lib/maps/google-own-reviews.ts`
- Create: `app/api/v1/reviews/google-live/route.ts`

- [ ] **Step 1: Write the uncached Places fetch**

```ts
// src/lib/maps/google-own-reviews.ts
import { ProviderError } from '@/lib/services/errors';

/**
 * Fetches the business's own Google reviews via Places API (New) Place Details. Deliberately
 * UNCACHED — unlike the rest of src/lib/maps/google-places.ts, Google Maps Platform's Places API
 * caching policy excludes review text/author data from the cacheable fields, so this must be
 * fetched live on every call, never persisted. Capped at 5 reviews (Google's own relevance pick;
 * there is no sort/pagination control on this field). See the design spec §2f for why the fuller
 * Business Profile API sync is deferred until the profile is 60+ days verified.
 */

const DETAILS_BASE = 'https://places.googleapis.com/v1/places/';
const REVIEW_FIELDS = 'id,displayName,rating,userRatingCount,reviews';

export interface OwnGoogleReview {
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number;
  text: string | null;
  relativeTime: string | null;
  googleMapsUri: string | null;
}

export interface OwnGoogleReviewsResult {
  rating: number | null;
  userRatingCount: number | null;
  reviews: OwnGoogleReview[];
}

interface RawReview {
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
  authorAttribution?: { displayName?: string; photoUri?: string; uri?: string };
  googleMapsUri?: string;
}

interface RawPlaceDetails {
  rating?: number;
  userRatingCount?: number;
  reviews?: RawReview[];
}

/** Live fetch — no cache layer. Throws ProviderError on a non-2xx response. */
export async function fetchOwnGoogleReviews(
  placeId: string,
  apiKey: string,
): Promise<OwnGoogleReviewsResult> {
  const res = await fetch(`${DETAILS_BASE}${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': REVIEW_FIELDS },
  });
  if (!res.ok) throw new ProviderError(`Places Details HTTP ${res.status}`);
  const data = (await res.json()) as RawPlaceDetails;
  return {
    rating: data.rating ?? null,
    userRatingCount: data.userRatingCount ?? null,
    reviews: (data.reviews ?? []).map((r) => ({
      authorName: r.authorAttribution?.displayName ?? 'Google user',
      authorPhotoUrl: r.authorAttribution?.photoUri ?? null,
      rating: r.rating ?? 0,
      text: r.text?.text ?? null,
      relativeTime: r.relativePublishTimeDescription ?? null,
      googleMapsUri: r.googleMapsUri ?? null,
    })),
  };
}
```

- [ ] **Step 2: Write the staff-gated route**

```ts
// app/api/v1/reviews/google-live/route.ts
import { apiHandler, parseQuery } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { getServerEnv } from '@/lib/config/env';
import { fetchOwnGoogleReviews } from '@/lib/maps/google-own-reviews';
import { z } from 'zod';

export const runtime = 'edge';

const querySchema = z.object({ placeId: z.string().min(1) });

/**
 * GET /api/v1/reviews/google-live?placeId=... — staff-only. Needs a server-only API key
 * (GOOGLE_MAPS_API_KEY is not NEXT_PUBLIC), so it can't be called directly from the browser like
 * most admin data — this thin route is the exception. No DB write, no persistence.
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser(req);
  if (user.role !== 'admin' && user.role !== 'staff') {
    return jsonError(403, 'forbidden', 'Staff only');
  }
  const { placeId } = parseQuery(req, querySchema);
  const env = getServerEnv();
  const apiKey = env.GOOGLE_MAPS_API_KEY ?? env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return jsonError(503, 'not_configured', 'Google Maps API key is not configured');
  const result = await fetchOwnGoogleReviews(placeId, apiKey);
  return jsonOk(result);
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
```

- [ ] **Step 3: Typecheck + edge-runtime test**

Run: `npm run typecheck && npx vitest run tests/unit/edge-runtime.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/maps/google-own-reviews.ts app/api/v1/reviews/google-live/route.ts
git commit -m "feat: live (uncached) Google reviews fetch for the admin panel"
```

---

## Task 11: The submission page

**Files:**

- Create: `app/(site)/reviews/write/page.tsx`
- Create: `src/components/site/ReviewWriteForm.tsx`
- Modify: `src/lib/admin/reviews.ts` — n/a here; token-context lookup is a NEW small public read, added below

- [ ] **Step 1: Add a token-context lookup helper**

Add this to `src/lib/services/reviews.ts` (same file as Task 5's wrappers):

```ts
const inviteContextSchema = z
  .object({ activityTitle: z.string(), tripDate: z.string().nullable() })
  .nullable();
export type InviteContext = z.infer<typeof inviteContextSchema>;
```

This needs a matching read. Since `review_invites` has no public RLS policy at all (by design — see Task 1), add a tiny public RPC for this ONE read, in a **new migration** `supabase/migrations/20260823000000_review_invite_context.sql`:

```sql
-- A minimal, public, token-gated read so the write-a-review page can show "Reviewing: X, on Y" before
-- submission — separate from api_submit_guest_review so a page LOAD never marks a token used.
create or replace function api_review_invite_context(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := nullif(p ->> 'token', '');
  v_invite review_invites;
  v_title text;
  v_starts_at timestamptz;
begin
  if v_token is null then
    return null;
  end if;
  select * into v_invite from review_invites where token = v_token;
  if v_invite is null or v_invite.used_at is not null or v_invite.expires_at < now() then
    return null;
  end if;
  select a.title into v_title from activities a where a.id = v_invite.activity_id;
  select min(so.starts_at) into v_starts_at
    from booking_items bi join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_invite.booking_id;
  return jsonb_build_object('activityTitle', v_title, 'tripDate', v_starts_at);
end;
$$;

revoke execute on function api_review_invite_context(jsonb) from public;
grant execute on function api_review_invite_context(jsonb) to anon, authenticated;
```

Mirror it into `supabase/catch-up.sql` (append), then:

Run: `npm run seed:gen && npm run setup:sql`

Add `'api_review_invite_context'` to `tests/db/rpc.ts`'s `ALLOWED` set.

Now add the service wrapper in `src/lib/services/reviews.ts`:

```ts
/** Public, token-gated read for the write-a-review page — does NOT consume the token (only
 *  api_submit_guest_review does that). Returns null for any invalid/expired/used token. */
export async function getReviewInviteContext(
  ctx: ServiceContext,
  token: string,
): Promise<InviteContext> {
  const data = await callRpc(ctx, 'api_review_invite_context', { token });
  return inviteContextSchema.parse(data);
}
```

- [ ] **Step 2: Write the client form component**

```tsx
// src/components/site/ReviewWriteForm.tsx
'use client';

import { useState } from 'react';
import { IconStar } from '@/components/ui/icons';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

export function ReviewWriteForm({
  token,
  activityTitle,
  googleReviewUrl,
}: {
  token: string;
  activityTitle: string;
  googleReviewUrl: string;
}) {
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError('Pick a star rating.');
      return;
    }
    if (body.trim().length < 5) {
      setError('A few words about your trip helps other travellers.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/reviews/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, rating, name, body }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? 'Could not submit your review.');
      }
      setDone(true);
    } catch (err) {
      setError(errMessage(err, 'Could not submit your review — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center">
        <h2 className="text-xl font-extrabold text-ink">Thank you!</h2>
        <p className="mt-2 text-sm text-ink/70">
          Your review has been sent to our team. Enjoyed the experience? We&apos;d love a Google
          review too — it takes a minute and really helps.
        </p>
        <a
          href={googleReviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          Review us on Google
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink/10 bg-white p-6">
      <h1 className="text-xl font-extrabold text-ink">Reviewing: {activityTitle}</h1>
      <div className="mt-4 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} out of 5 stars`}
            className="p-0.5"
          >
            <IconStar
              width={28}
              height={28}
              className={n <= rating ? 'text-gold-light' : 'text-ink/15'}
            />
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm font-bold text-ink" htmlFor="review-name">
        Your name
      </label>
      <input
        id="review-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      <label className="mt-4 block text-sm font-bold text-ink" htmlFor="review-body">
        Your review
      </label>
      <textarea
        id="review-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        minLength={5}
        maxLength={2000}
        rows={5}
        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-5 rounded-full bg-teal px-6 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit review'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
// app/(site)/reviews/write/page.tsx
import { InfoPage } from '@/components/site/InfoPage';
import { ReviewWriteForm } from '@/components/site/ReviewWriteForm';
import { publicServiceContext } from '@/lib/http/context';
import { getReviewInviteContext } from '@/lib/services/reviews';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export default async function ReviewWritePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const context = token ? await getReviewInviteContext(publicServiceContext(), token) : null;

  if (!token || !context) {
    return (
      <InfoPage eyebrow="Review" title="This link has expired">
        <p className="text-sm text-ink/70">
          This review link is no longer valid — it may have already been used or has expired. Thanks
          for your interest in leaving a review!
        </p>
      </InfoPage>
    );
  }

  return (
    <InfoPage eyebrow="Review" title="Tell us about your trip">
      <ReviewWriteForm
        token={token}
        activityTitle={context.activityTitle}
        googleReviewUrl={SITE.profiles.googleReview}
      />
    </InfoPage>
  );
}
```

- [ ] **Step 4: Typecheck + edge-runtime test + full local build**

Run: `npm run typecheck && npx vitest run tests/unit/edge-runtime.test.ts && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260823000000_review_invite_context.sql supabase/catch-up.sql supabase/setup.sql tests/db/rpc.ts src/lib/services/reviews.ts src/components/site/ReviewWriteForm.tsx "app/(site)/reviews/write/page.tsx"
git commit -m "feat: guest-safe review submission page (no login required)"
```

---

## Task 12: Admin data layer

**Files:**

- Create: `src/lib/admin/reviews.ts`

- [ ] **Step 1: Write the browser-client data layer**

```ts
// src/lib/admin/reviews.ts
import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Admin data layer for the review moderation queue. Reads go straight through the browser client
 * (RLS: is_staff() full access to guest_reviews — see the migration). The moderation ACTION goes
 * through the RPC, not a direct .update(), because approving must atomically mirror into `reviews`
 * and recompute the activity's rating — see api_moderate_guest_review.
 */

export interface GuestReviewRow {
  id: string;
  activityTitle: string;
  customerName: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
}

export async function loadGuestReviews(): Promise<GuestReviewRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('guest_reviews')
    .select('id, customer_name, rating, body, status, submitted_at, activities(title)')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    activityTitle:
      (r as { activities: { title: string } | null }).activities?.title ?? 'Unknown activity',
    customerName: r.customer_name,
    rating: r.rating,
    body: r.body,
    status: r.status,
    submittedAt: r.submitted_at,
  }));
}

export async function moderateReview(id: string, action: 'approve' | 'reject'): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_moderate_guest_review', {
    p: { id, action },
  });
  if (error) throw error;
}

export interface GoogleReviewRow {
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number;
  text: string | null;
  relativeTime: string | null;
  googleMapsUri: string | null;
}

export interface GoogleReviewsResult {
  rating: number | null;
  userRatingCount: number | null;
  reviews: GoogleReviewRow[];
}

/** Live fetch through the staff-gated API route (needs the server-only maps key). Never cached. */
export async function loadGoogleReviewsLive(placeId: string): Promise<GoogleReviewsResult> {
  const {
    data: { session },
  } = await getBrowserSupabase().auth.getSession();
  const res = await fetch(`/api/v1/reviews/google-live?placeId=${encodeURIComponent(placeId)}`, {
    headers: session ? { authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) throw new Error('Could not load Google reviews.');
  return (await res.json()) as GoogleReviewsResult;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/admin/reviews.ts
git commit -m "feat(admin): data layer for the review moderation queue"
```

---

## Task 13: Admin screen component

**Files:**

- Create: `src/components/admin/AdminReviews.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/admin/AdminReviews.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  loadGuestReviews,
  moderateReview,
  loadGoogleReviewsLive,
  type GuestReviewRow,
  type GoogleReviewsResult,
} from '@/lib/admin/reviews';
import { IconStar } from '@/components/ui/icons';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar
          key={i}
          width={14}
          height={14}
          className={i <= n ? 'text-gold-light' : 'text-ink/15'}
        />
      ))}
    </span>
  );
}

const STATUS_STYLE: Record<GuestReviewRow['status'], string> = {
  pending: 'bg-gold-light/20 text-gold',
  approved: 'bg-teal/10 text-teal-dark',
  rejected: 'bg-coral/10 text-coral',
};

/** The business's own Google place_id — the geo CID in SITE.profiles.google resolves to the same
 *  listing but Places API needs the place_id form. Set once the owner's place_id is known. */
const BUSINESS_PLACE_ID = 'REPLACE_WITH_PLACE_ID';

export function AdminReviews() {
  const [reviews, setReviews] = useState<GuestReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GuestReviewRow['status'] | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  const [google, setGoogle] = useState<GoogleReviewsResult | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await loadGuestReviews();
        if (active) setReviews(rows);
      } catch (err) {
        if (active) setError(errMessage(err, 'Could not load reviews.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await loadGoogleReviewsLive(BUSINESS_PLACE_ID);
        if (active) setGoogle(result);
      } catch (err) {
        if (active) setGoogleError(errMessage(err, 'Could not load Google reviews.'));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      await moderateReview(id, action);
      setReviews((rows) =>
        rows.map((r) =>
          r.id === id ? { ...r, status: action === 'approve' ? 'approved' : 'rejected' } : r,
        ),
      );
    } catch (err) {
      setError(errMessage(err, 'Could not update this review.'));
    } finally {
      setBusy(null);
    }
  }

  const shown = filter === 'all' ? reviews : reviews.filter((r) => r.status === filter);
  const pendingCount = reviews.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Reviews</h1>
        {pendingCount > 0 && (
          <span className="rounded-full bg-gold-light/20 px-2.5 py-1 text-[12px] font-bold text-gold">
            {pendingCount} pending
          </span>
        )}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold text-ink">Your queue</h2>
        <div className="mb-4 flex gap-2">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${
                filter === f ? 'bg-teal text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              {f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {error && <p className="mb-3 text-sm text-coral">{error}</p>}
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((r) => (
              <article key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Stars n={r.rating} />
                    <span className="text-sm font-bold text-ink">{r.customerName}</span>
                    <span className="text-xs text-ink-muted">· {r.activityTitle}</span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink/80">{r.body}</p>
                {r.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy === r.id}
                      onClick={() => decide(r.id, 'approve')}
                      className="rounded-full bg-teal px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy === r.id}
                      onClick={() => decide(r.id, 'reject')}
                      className="rounded-full bg-ink/5 px-4 py-1.5 text-[12.5px] font-bold text-ink-muted hover:bg-ink/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink">Google reviews (live)</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Fetched fresh from Google each time you open this page — not stored.
        </p>
        {googleError && <p className="text-sm text-coral">{googleError}</p>}
        {!google && !googleError && <p className="text-sm text-ink-muted">Loading…</p>}
        {google && (
          <>
            <p className="mb-3 text-sm text-ink/80">
              {google.rating ?? '—'} average · {google.userRatingCount ?? 0} total reviews on Google
            </p>
            <div className="flex flex-col gap-3">
              {google.reviews.map((r, i) => (
                <article key={i} className="rounded-xl border border-ink/10 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{r.authorName}</span>
                    <Stars n={r.rating} />
                  </div>
                  {r.text && <p className="mt-2 text-sm text-ink/80">{r.text}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                    <span>{r.relativeTime}</span>
                    {r.googleMapsUri && (
                      <a
                        href={r.googleMapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        View on Google
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AdminReviews.tsx
git commit -m "feat(admin): moderation queue + live Google reviews panel"
```

---

## Task 14: Admin route + nav entry

**Files:**

- Create: `app/(site)/admin/reviews/page.tsx`
- Modify: `src/components/admin/AdminShell.tsx`

- [ ] **Step 1: Write the route wrapper**

Check `app/(site)/admin/leads/page.tsx` first to confirm the exact wrapper shape, then mirror it:

```tsx
// app/(site)/admin/reviews/page.tsx
import { AdminReviews } from '@/components/admin/AdminReviews';

export const runtime = 'edge';

export default function AdminReviewsPage() {
  return <AdminReviews />;
}
```

- [ ] **Step 2: Add the nav entry**

In `src/components/admin/AdminShell.tsx`, add an icon import (use the existing `IconStar` already imported elsewhere in the admin, or `IconTrendUp` if a star icon isn't already in the shell's import list — check the existing `import { ... } from '@/components/ui/icons'` block first and reuse what's there if `IconStar` isn't already imported there).

Add to the `NAV` array, after `{ href: '/admin/leads', label: 'Leads', icon: IconUsers },`:

```ts
  // Customer-submitted content awaiting approval — deliberately NOT seo-flagged (guest_reviews RLS
  // is is_staff()-only; the seo role has no access, matching Tours' pricing/availability panels).
  { href: '/admin/reviews', label: 'Reviews', icon: IconStar },
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/(site)/admin/reviews/page.tsx" src/components/admin/AdminShell.tsx
git commit -m "feat(admin): wire up /admin/reviews route + nav entry"
```

---

## Task 15: Site-wide display integration

**Files:**

- Create: `src/lib/content/guest-reviews-live.ts`
- Test: `tests/unit/guest-reviews-live.test.ts`
- Modify: `src/lib/seo/jsonld.ts`
- Modify: `app/(site)/reviews/page.tsx`

The merge arithmetic (recomputing an average/histogram) is split into pure, exported functions with
no I/O — mirroring the "pure mappers exported for unit tests" pattern already used in
`src/lib/maps/google-places.ts`. `callRpc`/`publicServiceContext` are not mocked anywhere in this
codebase's test suite (DB-touching code is tested via real Postgres in `tests/integration/`
instead), so keeping the actual arithmetic pure and separate is what makes it testable at all
without introducing a new, inconsistent mocking approach just for this file.

- [ ] **Step 1: Write the module**

```ts
// src/lib/content/guest-reviews-live.ts
import { reviewStats as seedStats, featuredReviews as seedReviews } from './reviews';
import type { ReviewStats, FeaturedReview } from './reviews';
import { publicServiceContext } from '@/lib/http/context';
import { callRpc } from '@/lib/services/rpc';

/**
 * Live review stats: the scraped TripAdvisor/Google pool (`_reviews.gen.ts`) merged with APPROVED
 * guest_reviews rows, recomputed on every request — mirrors blog-live.ts's DB-over-seed pattern. On
 * any DB error the scraped stats still render (the page can never go down with the database).
 */

export interface DbApprovedReview {
  rating: number;
  body: string;
  customerName: string;
  submittedAt: string;
}

/** Pure — no I/O. Recomputes the combined average/histogram from the scraped seed + approved DB
 *  rows. Exported for unit testing; the async loader below is the only I/O boundary. */
export function mergeReviewStats(seed: ReviewStats, db: DbApprovedReview[]): ReviewStats {
  if (db.length === 0) return seed;
  const combinedCount = seed.total + db.length;
  const scrapedSum = seed.average * seed.total;
  const dbSum = db.reduce((s, r) => s + r.rating, 0);
  const histogram = { ...seed.histogram };
  for (const r of db) {
    const key = String(r.rating);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return {
    ...seed,
    total: combinedCount,
    average: Math.round(((scrapedSum + dbSum) / combinedCount) * 10) / 10,
    histogram,
  };
}

/** Pure — no I/O. Newest DB reviews first, then the scraped pool. Exported for unit testing. */
export function mergeFeaturedReviews(
  seed: FeaturedReview[],
  db: DbApprovedReview[],
): FeaturedReview[] {
  const mapped: FeaturedReview[] = db.map((r, i) => ({
    id: `guest-${i}`,
    source: 'site',
    rating: r.rating,
    title: null,
    text: r.body,
    author: r.customerName,
    authorLocation: null,
    date: r.submittedAt.slice(0, 10),
    url: null,
  }));
  return [...mapped, ...seed];
}

async function loadApprovedGuestReviews(): Promise<DbApprovedReview[]> {
  const data = await callRpc(publicServiceContext(), 'api_list_approved_guest_reviews', {});
  return Array.isArray(data) ? (data as DbApprovedReview[]) : [];
}

export async function loadReviewStats(): Promise<ReviewStats> {
  try {
    return mergeReviewStats(seedStats, await loadApprovedGuestReviews());
  } catch {
    return seedStats;
  }
}

export async function loadFeaturedReviews(): Promise<FeaturedReview[]> {
  try {
    return mergeFeaturedReviews(seedReviews, await loadApprovedGuestReviews());
  } catch {
    return seedReviews;
  }
}
```

- [ ] **Step 2: Write the unit test for the pure merge functions**

```ts
// tests/unit/guest-reviews-live.test.ts
import { describe, expect, it } from 'vitest';
import {
  mergeReviewStats,
  mergeFeaturedReviews,
  type DbApprovedReview,
} from '@/lib/content/guest-reviews-live';
import type { ReviewStats, FeaturedReview } from '@/lib/content/reviews';

const SEED_STATS: ReviewStats = {
  total: 100,
  average: 4.8,
  tripadvisor: { rating: 4.8, count: 60 },
  google: { rating: 4.7, count: 40 },
  histogram: { '5': 80, '4': 15, '3': 5 },
};

describe('mergeReviewStats', () => {
  it('returns the seed unchanged when there are no approved DB reviews', () => {
    expect(mergeReviewStats(SEED_STATS, [])).toEqual(SEED_STATS);
  });

  it('folds DB reviews into the total, average and histogram', () => {
    const db: DbApprovedReview[] = [
      { rating: 5, body: 'Great!', customerName: 'A', submittedAt: '2026-07-20T00:00:00Z' },
      { rating: 3, body: 'Okay', customerName: 'B', submittedAt: '2026-07-21T00:00:00Z' },
    ];
    const merged = mergeReviewStats(SEED_STATS, db);
    expect(merged.total).toBe(102);
    expect(merged.histogram['5']).toBe(81);
    expect(merged.histogram['3']).toBe(6);
    // (100*4.8 + 5 + 3) / 102 = 4.784.. → rounded to 1dp
    expect(merged.average).toBe(4.8);
  });
});

describe('mergeFeaturedReviews', () => {
  it('puts DB reviews first, newest given order preserved, then the seed pool', () => {
    const seed: FeaturedReview[] = [
      {
        id: 's1',
        source: 'tripadvisor',
        rating: 5,
        title: null,
        text: 'Seed review',
        author: 'Seed Author',
        authorLocation: null,
        date: '2026-01-01',
        url: null,
      },
    ];
    const db: DbApprovedReview[] = [
      {
        rating: 4,
        body: 'Loved it',
        customerName: 'New Guest',
        submittedAt: '2026-07-22T00:00:00Z',
      },
    ];
    const merged = mergeFeaturedReviews(seed, db);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.author).toBe('New Guest');
    expect(merged[0]!.source).toBe('site');
    expect(merged[1]!.author).toBe('Seed Author');
  });
});
```

Run: `npx vitest run tests/unit/guest-reviews-live.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Add the public listing RPC**

Add to the SAME migration file from Task 11 (`supabase/migrations/20260823000000_review_invite_context.sql`) — append below `api_review_invite_context`:

```sql
-- Public feed for the /reviews page merge (guest-reviews-live.ts). Approved only — RLS on
-- guest_reviews already restricts anon to approved rows, but the RPC makes the intent explicit and
-- returns exactly the shape the merge needs, capped so the page can't be made to load thousands.
create or replace function api_list_approved_guest_reviews(p jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rating', rating, 'body', body, 'customerName', customer_name, 'submittedAt', submitted_at
  ) order by submitted_at desc), '[]'::jsonb)
  from (select * from guest_reviews where status = 'approved' order by submitted_at desc limit 50) g;
$$;

revoke execute on function api_list_approved_guest_reviews(jsonb) from public;
grant execute on function api_list_approved_guest_reviews(jsonb) to anon, authenticated;
```

Mirror into `catch-up.sql`, then:

Run: `npm run seed:gen && npm run setup:sql`

Add `'api_list_approved_guest_reviews'` to `tests/db/rpc.ts`'s `ALLOWED` set.

- [ ] **Step 4: Change `reviewsPageJsonLd` to take stats as a parameter**

In `src/lib/seo/jsonld.ts`, remove the static import:

```ts
// DELETE this line:
import { reviewStats } from '@/lib/content/reviews';
```

Change the function signature and body:

```ts
export function reviewsPageJsonLd(
  stats: { average: number; total: number },
  reviews: { author: string; rating: number; text: string; date: string | null }[],
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    '@id': `${SITE.url}/#operator`,
    name: SITE.operator,
    url: SITE.url,
    sameAs: [...SAME_AS],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: String(stats.average),
      reviewCount: String(stats.total),
      bestRating: '5',
    },
    review: reviews.map((r) => ({
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5' },
      author: { '@type': 'Person', name: r.author },
      reviewBody: r.text,
      ...(r.date ? { datePublished: r.date } : {}),
    })),
  };
}
```

- [ ] **Step 5: Swap the imports and the call site in `/reviews/page.tsx`**

In `app/(site)/reviews/page.tsx`, change:

```ts
import { featuredReviews, reviewStats } from '@/lib/content/reviews';
```

to:

```ts
import { loadFeaturedReviews, loadReviewStats } from '@/lib/content/guest-reviews-live';
```

Change the component to be async and load both, then pass `stats` into `reviewsPageJsonLd`:

```tsx
export default async function ReviewsPage() {
  const [reviewStats, featuredReviews] = await Promise.all([loadReviewStats(), loadFeaturedReviews()]);
  const histTotal = Object.values(reviewStats.histogram).reduce((a, b) => a + b, 0) || 1;
  const jsonld = reviewsPageJsonLd(
    reviewStats,
    featuredReviews.slice(0, 12).map((r) => ({ author: r.author, rating: r.rating, text: r.text, date: r.date })),
  );
  // ...rest of the function body is unchanged — it already only reads `reviewStats`/`featuredReviews`
  // as local names, which now come from the awaited values above instead of the static import.
```

(The rest of the JSX body already references `reviewStats`/`featuredReviews`/`histTotal`/`jsonld` by these exact names — no other line in the file needs to change.)

- [ ] **Step 6: Run the full test suite, typecheck, and build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: all PASS. If any existing test imported `reviewsPageJsonLd` with the old 1-argument signature, update that call site the same way as Step 4.

- [ ] **Step 7: Verify in the browser**

Start the dev server, sign in as staff, approve a test guest review via `/admin/reviews`, then load `/reviews` and confirm the new review appears in the list and the headline total/average reflects it. Also load the reviewed activity's own detail page and confirm the review appears there too (via the existing, untouched `ReviewList.tsx` — proving the `reviews` table mirror in Task 1 works end-to-end).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260823000000_review_invite_context.sql supabase/catch-up.sql supabase/setup.sql tests/db/rpc.ts src/lib/content/guest-reviews-live.ts src/lib/seo/jsonld.ts "app/(site)/reviews/page.tsx"
git commit -m "feat: merge approved guest reviews into the site-wide /reviews page + JSON-LD"
```

---

## Task 16: Full gate, handbook update, final commit

**Files:**

- Modify: `docs/handbook/operations.md` (owner-facing: how to promote/manage this)

- [ ] **Step 1: Add an operations entry**

In `docs/handbook/operations.md`, add a row to the "What you can change yourself" table:

```
| Approve or reject a customer review    | **Reviews**                                             |
```

And add a short troubleshooting note near the cron section:

```markdown
## Customer reviews aren't coming in

Same root cause as the other post-trip jobs: **the background job is dead.** Review-request emails
are only sent by the same 5-minute maintenance sweep that reconciles payments and expires holds — if
it's down, nothing else in this list is broken, but no review requests go out either. Check it the
same way as in [Nothing is emailing anyone](#nothing-is-emailing-anyone).

One more thing worth knowing: **every submitted review sits in the Reviews queue until you approve
it** — nothing a customer writes appears on the site automatically, by design.
```

- [ ] **Step 2: Run the complete local gate**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build`
Expected: all PASS. If `format:check` fails, run `npm run format` and re-check (see `docs/handbook/gytm-ci-gate` memory — this is the step most commonly forgotten).

- [ ] **Step 3: Push and watch CI**

```bash
git push origin main
```

Then watch the GitHub Actions run to completion — its final step (`pages:build`, the Cloudflare edge bundle) is the only place this can be verified; it cannot be run locally on Windows.

- [ ] **Step 4: Tell the owner the two manual steps**

Once CI is green, remind the owner (does not block the deploy, but the feature is inert without these):

1. Re-run `supabase/catch-up.sql` on production (adds the new tables + RPCs).
2. Replace the two placeholders with real values and redeploy:
   - `SITE.profiles.googleReview` in `src/lib/seo/site.ts` (the `g.page/r/.../review` link from _Read reviews → Get more reviews_).
   - `BUSINESS_PLACE_ID` in `src/components/admin/AdminReviews.tsx` (the Google Places `place_id` for Belle Mare Tours — resolvable via a one-off Place Details text search on "Belle Mare Tours, Quatre Cocos" if not already known).

- [ ] **Step 5: Final commit (docs only, if not already included above)**

```bash
git add docs/handbook/operations.md
git commit -m "docs: reviews queue + the two owner setup steps for guest review requests"
git push origin main
```
