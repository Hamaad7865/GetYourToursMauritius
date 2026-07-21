# Post-trip review requests — design

**Date:** 21 July 2026
**Status:** approved, implementing
**Scope:** the full feature — the post-trip trigger, the review-request email, the guest-safe
submission flow, admin moderation, a live Google-reviews panel, and site display integration.

---

## 1. Why

Research earlier this week (see the SEO conversation, 15–21 July) established two things:

- The owner's 1,000+ TripAdvisor reviews **cannot be imported or copied** onto a Google Business
  Profile — there is no such mechanism. Google reviews must be earned fresh, one at a time.
- Google's current policy (tightened April 2026) **bans "review gating"** — asking for a Google
  review only from customers you expect to be happy, or routing customers differently based on
  their sentiment. Violating this risks the profile being restricted or suspended.

Given both constraints, the only compliant, durable way to build review volume is: ask every
customer, the same way, after every trip — and give the owner a place to collect and moderate the
reviews that come back before anything goes public on the site.

---

## 2. The core architectural decisions

### a) Two new tables, kept separate from the existing notification machinery

`notification_outbox` already tracks the _delivery_ of the request email (reusing it end to end).
It is not extended to also carry the review content or the submission token — that's a different
concern with a different lifecycle (weeks-long validity, single-use, customer-facing).

| Table            | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `review_invites` | One row per booking. Holds the secure single-use submission token. |
| `guest_reviews`  | The actual submission: rating, text, moderation status.            |

### b) A token, not a login, authorizes submission

`POST /api/v1/bookings/:ref/reschedule` requires `requireUser()` — but this app also takes **guest
bookings** (no account). Gating review submission behind login would silently exclude every guest
customer, which is most of the target audience for this feature. Instead, the emailed link carries
a random, single-use token; the submission RPC validates it server-side, the same zero-trust
pattern the money path already uses for identity it can't get from `auth.uid()`.

The token is stored **as plaintext**, not hashed. Unlike a password, it is high-entropy (32 random
bytes, ~256 bits), single-use, and time-boxed (30 days) — the security property comes from
unpredictability and single-use, not from hashing at rest. This matches how idempotency keys are
already handled elsewhere in the app.

### c) The trigger extends the existing maintenance cron — no new infrastructure

`/api/v1/internal/maintenance` already runs every 5 minutes and does three try/caught steps
(payment reconcile → booking expiry → availability). A fourth step, `enqueueReviewInvites`, is
added at the end. It is **not** money-critical, so — unlike the first two steps — its position
relative to the others doesn't matter for correctness.

The TS function is a thin wrapper, same shape as its three siblings in
`src/lib/services/maintenance.ts`: it calls a new SQL function, `api_enqueue_review_invites()`,
which does the actual eligibility computation and the idempotent insert. This keeps the
date-sensitive logic in Postgres, consistent with how every other piece of scheduling/availability
logic in this app already works (see `docs/handbook/architecture.md` §2 — "to change how something
is priced or booked, you write SQL, not TypeScript"; the same reasoning applies to "who's eligible
for a review request").

### d) Timing: next 9am Mauritius-local after the trip ends

Per the earlier design conversation. The eligibility check **must** use the Mauritius-anchored
timestamp pattern from `20260718120000_availability_mauritius_tz.sql` — this codebase has already
shipped three separate off-by-one-day bugs (see `docs/handbook/landmines.md`) from date math that
used UTC boundaries instead.

### e) The Google link is never sentiment-gated — this is a hard invariant

Both the request email and the on-site thank-you screen show the **same** "Review us on Google"
button to every customer, regardless of what rating they give (or haven't given yet). No code path
in this feature may branch on `rating` to decide whether the Google button appears. This is the
direct, load-bearing consequence of the compliance research in §1 — treat it the same way the
money path treats "never trust a client-sent price."

### f) Google reviews are read live, never stored — Places API, not the Business Profile API

Two Google APIs can read a business's own reviews:

|                  | Places API (New) `reviews` field                                                                  | Business Profile API `reviews.list`                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Setup            | Reuses the existing `GOOGLE_MAPS_API_KEY`                                                         | New Google Cloud OAuth app + human consent flow                                                                       |
| Eligibility      | Works today                                                                                       | Requires the profile to be **verified and active for 60+ days** before you can even apply, then further approval time |
| Reviews returned | 5, Google's relevance pick                                                                        | All of them, paginated                                                                                                |
| Storage          | **Cannot be cached/stored** — Maps Platform ToS excludes review content from the cacheable fields | No such restriction                                                                                                   |
| Cost             | ~$20 / 1,000 requests (1,000/mo free, shared with the planner's existing Places usage)            | Free (quota-limited)                                                                                                  |

The Business Profile API is not viable yet: the owner's Business Profile doesn't exist, so the
60-day eligibility clock hasn't started. This spec builds the Places API path only — a **live,
fetch-on-demand, read-only** panel in the admin screen, refetched on every page load, never written
to the database. **Phase 2** (the full Business Profile API sync) is out of scope here and is
listed as a follow-up in §12 for ~60 days after the profile is verified.

### g) Display integration mirrors the existing blog pattern

`src/lib/content/blog-live.ts` already merges DB posts over the generated seed content at request
time. `guest-reviews-live.ts` does the same thing for reviews: it recomputes `reviewStats` and
`featuredReviews` by combining the scraped pool (`_reviews.gen.ts`) with `guest_reviews` rows where
`status = 'approved'`, live, on every request to `/reviews`. Nothing is baked into a generated file.

---

## 3. Data model

```sql
create table review_invites (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  activity_id uuid not null references activities (id),
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);

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
```

`booking_id unique` on both tables enforces "one invite, one review, per booking" at the database
level — the strongest possible guarantee, not just an application check.

`activity_id` on `review_invites` is denormalized at creation time — the sweep (§4) already has it
in hand from the occurrence it's checking, and it lets both the submission RPC and the review-write
page resolve "which activity is this for" from the invite row alone, no extra join needed later.

**RLS:**

- `review_invites`: no direct client access at all (anon or authenticated). Only reached through
  the `api_submit_guest_review` RPC (below), which does its own token lookup internally.
- `guest_reviews`: `is_staff()` full access (moderation). `select` for `anon, authenticated` only
  where `status = 'approved'` (public display). No direct `insert`/`update` policy for anyone —
  writes go through the RPC.

---

## 4. The submission RPC — the real security boundary

```
api_submit_guest_review(p jsonb)   -- { token, rating, name, body }
```

SECURITY DEFINER. Inside the function, in order:

1. Look up `review_invites` by `token`; if missing, `used_at is not null`, or `expires_at < now()`,
   raise `invalid_or_expired_token`.
2. Insert into `guest_reviews` with `status = 'pending'`, using `booking_id` and `activity_id`
   resolved from the invite row — **never** from client input.
3. Mark the invite `used_at = now()` in the same transaction (atomic — no race where two requests
   both see an unused token).

Grants follow the same explicit discipline as every other public-facing RPC in this codebase:

```sql
revoke execute on function api_submit_guest_review(jsonb) from public;
grant  execute on function api_submit_guest_review(jsonb) to anon, authenticated;
```

The route layer (`POST /api/v1/reviews/submit`, edge) adds a coarse IP rate limit
(`rateLimit(req, 'reviews:submit', 5)`) on top — the token's single-use property is the real
guard; the rate limit just blunts brute-force token guessing.

---

## 5. The email

New `notification_outbox.template` value: `review_request` (the column is plain `text`, no enum
migration needed). Rendered via a new `src/lib/email/review-request.ts`, styled identically to
`booking-confirmation.ts` (same header/footer, plain-text fallback).

Content: _"How was your {activity title}?"_, a one-line thank-you, then two equal-weight buttons —
**Review us on our site** (`${SITE.url}/reviews/write?token=...`) and **Review us on Google**
(`SITE.profiles.googleReview` — see §9, this needs a real value from the owner before launch).

---

## 6. The submission page

`app/(site)/reviews/write/page.tsx`, edge, no auth required. Server-side, resolves the token to
`{ activityTitle, tripDate }` for display context (a lightweight read, separate from the submit
RPC) — if the token is invalid/expired/used, shows a friendly "this link has expired" state rather
than a raw error.

Form: star rating (required) + text (required, same 5-character floor as the DB constraint).
Submits to `POST /api/v1/reviews/submit`. On success, shows a thank-you screen that repeats the
Google review button (§2e — unconditionally, same for every rating).

---

## 7. Admin moderation screen

`app/(site)/admin/reviews/page.tsx` + `AdminReviews.tsx`, following the existing admin-screen
pattern (`AdminBlog.tsx` is the closest sibling — list + status tabs + detail actions).

- **Your queue**: pending / approved / rejected tabs. Each row: stars, name, activity, trip date,
  body text, Approve / Reject buttons. `is_staff()` only — the `seo` role does not get this screen
  (it's customer-facing content, not SEO content, per the existing role boundary in
  `docs/handbook/architecture.md`).
- **Google reviews (live)**: a read-only panel that calls a small internal endpoint wrapping the
  existing `src/lib/maps/google-places.ts` client for the business's own `place_id`, fetched fresh
  on every page load. No new table, no persistence.

---

## 8. Display integration

`src/lib/content/guest-reviews-live.ts` (mirrors `blog-live.ts`):

- `loadReviewStats()` — merges `REVIEW_STATS` (scraped) with a live `count`/`avg(rating)` over
  `guest_reviews where status = 'approved'`, recomputing `total`, `average`, and the histogram.
- `loadFeaturedReviews()` — merges `FEATURED_REVIEWS` with recently-approved `guest_reviews` rows,
  mapped into the existing `FeaturedReview` shape (`source: 'site'`, `url: null`).

`/reviews/page.tsx` swaps its static imports for these async loaders — the same one-line change
`/blog/page.tsx` already went through. The `AggregateRating` JSON-LD on that page (and anywhere
else `reviewStats` feeds structured data) is recalculated from the merged total automatically.

---

## 9. Owner setup required before this can go live

- Create and verify the Google Business Profile (already planned, tracked separately).
- Once verified, get the direct review link from **Read reviews → Get more reviews** in Business
  Profile Manager, and set it as `SITE.profiles.googleReview` in `src/lib/seo/site.ts` (a one-line
  code change + redeploy, matching how `SITE.phone`/`SITE.email` already work — no new env var).
- Re-run `supabase/catch-up.sql` after this migration ships (standard process).

---

## 10. Testing plan

Integration (pglite, real Postgres):

- `api_submit_guest_review` rejects a missing/expired/already-used token.
- A valid token succeeds exactly once; the second attempt with the same token fails.
- `anon` cannot `select` a `pending` or `rejected` guest_reviews row (RLS).
- `anon` cannot call anything on `review_invites` directly.
- Only `is_staff()` can update `guest_reviews.status`.
- `api_enqueue_review_invites()`'s 9am-Mauritius eligibility boundary: an occurrence ending at
  23:50 Mauritius time must become eligible only after the _following_ day's 9am — not that same
  night, and not a UTC-shifted day. This is exactly the class of bug that has hit this codebase
  three times before (`docs/handbook/landmines.md`), so it gets a dedicated pglite test, not just
  incidental coverage from testing the happy path.

Unit:

- `guest-reviews-live.ts` merge logic — DB rows correctly recomputed into `ReviewStats`.
- The review-request email renders with both buttons present and identically worded regardless of
  no rating being known yet (it's sent before any review exists).

`tests/unit/edge-runtime.test.ts` automatically covers the two new API routes once they declare
`export const runtime = 'edge'` — no extra test needed there.

---

## 11. Rollout (matches `docs/handbook/database.md`'s standard recipe)

1. New migration, timestamped after the current latest.
2. Mirror into `supabase/catch-up.sql`.
3. `npm run seed:gen && npm run setup:sql`.
4. Add `api_submit_guest_review` (and any other new RPC) to the `ALLOWED` set in `tests/db/rpc.ts`.
5. Hand-edit `src/lib/supabase/types.ts` for `review_invites` and `guest_reviews`.
6. Owner re-runs `catch-up.sql` on production before the code deploys.

---

## 12. Out of scope (this pass) — explicit follow-ups, not forgotten

- **Phase 2: full Business Profile API sync.** Revisit once the Google Business Profile has been
  verified and active for 60+ days (see §2f). At that point the owner can apply for API access and
  this gets a proper full-history sync instead of the 5-review live panel.
- Re-sending the request if the 30-day invite link expires unused.
- Editing or deleting a submitted review as the customer.
- Photo uploads on a review.
- Per-activity review breakdowns on the public site (only the site-wide aggregate is in scope,
  per the confirmed design decision).
