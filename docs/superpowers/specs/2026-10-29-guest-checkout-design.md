# Guest checkout — design

Date: 2026-10-29, built 2026-10-30. **Status: built, ships switched off.** The owner told us to go with
the recommendation on all seven decisions. Migration `20261030120000_guest_checkout_schema.sql`. The
logic is `src/lib/services/guest.ts`.

## As built: what changed from the design below

The body of this document is the design as reviewed. Where the build differs, this section wins.

**The logic is TypeScript, not plpgsql (owner's instruction, 2026-10-30).** The design's new SQL
functions became service functions. The migration is schema only: one column, one table, no function.

| Design                      | Built                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `api_book_guest`            | `assertGuestBookingAllowed()`, called by the route just before the normal `api_book` |
| `api_guest_link_target`     | `guestLinkTarget()`                                                                  |
| `api_adopt_guest_booking`   | `adoptGuestBooking()`, a compare-and-swap update on `bookings.user_id`               |
| `api_claim_guest_bookings`  | `claimGuestBookings()` behind `POST /api/v1/account/claim-guest-bookings`            |
| `api_reset_guest_link`      | `resetGuestLink()` behind `POST /api/v1/admin/bookings/{ref}/guest-link/reset`       |
| `api_request_guest_link`    | `requestGuestLink()`                                                                 |
| `api_purge_anonymous_users` | `purgeAnonymousUsers()`, through the auth admin API                                  |
| `is_anonymous_user()`       | `auth.admin.getUserById()` in the service                                            |

Consequences:

- **The caps have no lock.** They read, then book, so two simultaneous requests can overrun a cap by
  one. They are abuse limits; capacity and pricing are still in `api_book` and `create_hold`.
- **Ownership moves are compare-and-swap** (`update ... where user_id = <the owner we read>`), so a
  concurrent move cannot be overwritten and a real account's booking can never be taken.
- Reuses `quote_owner_for_email` through the service-role client, so the confirmed, exactly-one-account
  rule still has one home.

**Other changes:**

- **No new secret is required.** `GUEST_LINK_SECRET` is optional and falls back like
  `PAYMENT_LINK_SECRET`. Set it only to rotate links on their own.
- **Turnstile keys are read at request time** (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), so the
  site key needs no rebuild. On production the guest form stays hidden until both exist, so turning the
  switch on too early changes nothing.
- **Refusing a guest is 403 `account_required`**, not 401.
- **A guest session that cannot start falls back to the account dialog**, with a message. Anonymous
  sign-ins switched off, or the per-IP limit on a shared connection, can never strand a visitor.
- **No new funnel events.** Guests log `step_2_signed_out` and `pay_clicked`, so
  `api_log_checkout_event` was left alone. Tell guest from account by the booking owner's `is_anonymous`.
- **`AuthProvider`'s `user` is null for a guest**, so every existing surface treats a guest as signed
  out by default. Only surfaces that work for a guest read `session` or `isGuest`.
- **The purge runs hourly**, 15 deletes a run, to stay inside a Worker's subrequest budget.
- **The claim runs once per tab per account, and on every real sign-in**, not on every page load.
- **`/open` also sets the language cookie** for a French booking when the browser has none, because
  `/bookings` has no `/fr` URL.
- **The save-to-account banner asks for the email only.** Supabase refuses a password on an anonymous
  user until the address is confirmed; "Forgot password" adds one later.
- **Bug fixed on the way:** `POST /bookings` built its context with no locale, so all 347 web bookings
  were stored as `en`, including those made from French pages. A booking now stores the checkout's language.

**Not verified end to end:** the live anonymous sign-in. It is off on both Supabase projects and is the
owner's to enable, so the production smoke test in §12 is the first real run of that one step. Everything
around it is proven: the logic against real Postgres, the routes, and the UI in a browser up to and
including the fallback when anonymous sign-in is refused. The planned Playwright guest spec was not
written, for the same reason: it cannot run until a project has anonymous sign-ins on.

**Accepted gap:** a guest who edits details after a Pay attempt leaves the old unpaid booking counting
toward the cap for up to 30 minutes, so three corrections in that window would be refused until one expires.

## In one paragraph

Let a visitor book and pay on bellemaretours.com without creating an account. They get a **guest
session**: a Supabase anonymous sign-in, created when they tap Pay. The server sees an ordinary
JWT whose user is flagged `is_anonymous`, so that user owns the booking and every existing owner check
keeps working. **`api_create_payment`'s identity check and `api_book`'s service-role-only grant do not
change.** Every booking email carries a **signed manage link**. On another device, one tap moves the
booking into a guest session there. A guest who later sets a password keeps the same user id, so their
bookings come with them. A guest who signs in to an existing account gets their _paid_ guest
bookings through the rule quotes already use: the account's **confirmed email** must match the
booking's email. Abuse is bounded in four ways:

- caps per guest identity, per email and per IP, in a new `api_book_guest` wrapper that leaves
  `api_book` untouched;
- Cloudflare Turnstile on guest booking creation;
- a purge of unused anonymous users;
- a database kill switch that turns guest checkout off without a deploy.

## Why

Funnel for the four weeks from 28 Sep to 25 Oct 2026, from the main session's diagnosis:

- 556 checkout holds → **146 bookings created (26%)** → 102 paid (70% of created).
- About 90% of people who create an account go on to book, a median of about 4 minutes later.
- About 80% of web bookings come from an account created within the hour.
- So the loss happens **before account creation**. Either step ① (pickup) or step ② (the account wall)
  causes it. The step events added in `20261029120000_checkout_step_events.sql` will tell the two
  apart. This design is the lever for step ②.
- What the step ② wall costs today:
  - email sign-up needs a confirmation link;
  - the logs show `invalid_credentials` → sign-up → 429 `over_email_send_rate_limit` ×3 →
    `email_not_confirmed` before people get in;
  - most checkout openers never even open the account box.

Quick fixes to the account box (open in create-account mode, copy, friendly errors) are being made
separately. Guest checkout removes the wall instead of softening it.

## Goal and non-goals

**Goal.** A visitor completes step ② with name, email, phone and country, taps Pay and pays, without
creating an account, confirming an email address, or seeing a password field. Afterwards, the same
person can do everything an account holder can with that booking. That covers the confirmation page,
paying a pending booking, the invoice and voucher, cancelling, rescheduling (including weather moves),
adding a late pickup, paying a balance and changing tour. They can do it on the device they booked on
or, via the emailed link, on any other.

**Non-goals.**

- **Changing pricing, capacity, holds or settlement.** `api_book`, `create_booking`, `create_hold`,
  `create_payment` and `append_payment_event` keep their winning bodies.
- **Making the booking ref a credential.** The codebase already says a public booking ref is not a
  bearer credential (`api_create_payment`'s guard comment), and an email address is not secret. So
  "ref + email" can only _trigger_ emailing a link to the address already stored on the booking. It
  never shows booking data on screen. See [Find my booking](#5-find-my-booking-ref--email).
- **Guest quotes.** They already work through their own link token, and nothing here changes them.
- **Saved cards.** That feature is not built.

## Owner decisions needed

| #   | Question                                                                                                                                                                                                                          | Recommendation                                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Turn on **Supabase anonymous sign-ins**? This is a project-wide switch in the dashboard.                                                                                                                                          | **Yes.** If not, fall back to [Option A](#option-a--a-signed-booking-link-is-the-guests-credential), which costs far more and carries more risk.                  |
| 2   | At step ②, make **"Continue as guest" the main action**, with "Sign in" and "Continue with Google" as secondary actions?                                                                                                          | **Yes.** The data says the wall is where people are lost.                                                                                                         |
| 3   | Run **Cloudflare Turnstile** (usually invisible) on guest booking creation from launch day?                                                                                                                                       | **Yes.** It is the only control that makes scripted guest identities cost something. The alternative is launching without it and adding it after the first abuse. |
| 4   | When someone signs in with a confirmed email, **automatically add the _paid_ guest bookings made with that address** to their account?                                                                                            | **Yes.** It is the same rule, and the same accepted risk (a typo'd address that belongs to a real account), as `quote_owner_for_email` for quotes.                |
| 5   | **"Latest device wins"**: opening the manage link on a new device moves the booking into that device's guest session. The first device then sees "opened on another device", and its own copy of the link moves the booking back. | **Yes.** Every owner check stays single-owner. The alternative, shared ownership, would mean editing every `user_id = auth.uid()` check.                          |
| 6   | Starting abuse limits ([table](#7-abuse-limits)).                                                                                                                                                                                 | Accept the defaults, then review after 2 weeks.                                                                                                                   |
| 7   | Privacy notice: say that guest bookings are kept against the email address, and that the booking emails contain a private link.                                                                                                   | Needed before launch.                                                                                                                                             |

## The three blocks, and what happens to each

Guest booking is blocked on purpose in three places today. Under the recommendation (Option B),
**two of the three do not move at all**.

| Block today                                                                                                                                                    | Recommended (B)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why it stays safe                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. `POST /api/v1/bookings` calls `requireUser`.** An anonymous caller gets a 401.                                                                            | `requireUser` **stays**. An anonymous Supabase JWT is a valid JWT (role `authenticated`, `sub` = the anonymous user's id, claim `is_anonymous: true`), so it passes. A new `AuthUser.isAnonymous` flag routes the guest branch. That branch checks, in order: the kill switch, a guest rate-limit bucket, Turnstile, then `api_book_guest` instead of `api_book`. A caller with no token still gets the 401, as today. With the kill switch off, an anonymous caller gets 401 `account_required`.                  | The route still books through the service-role client and still passes the **JWKS-verified** id as `actorUserId`. No client-sent id is trusted, as today.                                                         |
| **2. `api_create_payment` requires the booking owner** (`is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid())`, inside `create_payment`). | **Unchanged.** The guest's booking is owned by their anonymous user id, so `v_booking.user_id = auth.uid()` holds for the guest's own session and fails for anyone else's. There is no new entry point into `create_payment`. `api_create_quote_payment` stays the **only** one that skips the identity check.                                                                                                                                                                                                     | The single-flight lease, the reuse window and the FX pin live in the one `create_payment` body, and nothing new calls it.                                                                                         |
| **3. `api_book`'s anon grant is revoked.**                                                                                                                     | **Stays revoked.** `api_book` remains `service_role`-only, and its winning body (`20261025120000_transfer_first_leg_date_guard.sql`) is **not redefined**. The guest caps live in a new service-role wrapper, `api_book_guest(p)`, which checks them and then calls `api_book(p)`. The **null-actor path is not used by Option B**: every guest booking has a non-null actor, the anonymous user. The F23 replay guard therefore takes its owned-booking branch: a replay from a different identity → `forbidden`. | The `create or replace` of `api_book` is the edit that has reverted security fixes twice. Not making it is the safest change available. Only Option A would rely on `api_book`'s null-actor + email-match branch. |

## Options considered

### Option A — a signed booking link is the guest's credential

This extends the quote module's pattern. Quotes already have exactly this kind of ownerless customer:

- an emailed link token, stored as its SHA-256 (`quotes.token_hash`);
- an `/open` route that moves the token into a path-scoped httpOnly cookie;
- a service-role wrapper (`api_create_quote_payment`) that skips the payment identity check because
  the route verified the token;
- a claim on sign-up by confirmed email.

For web bookings, this would mean:

- `api_book` called with a **null actor**. The booking has `user_id is null`, like a quote booking,
  and F23's email-match branch guards replays.
- An `api_create_guest_payment` wrapper calling `create_payment(p, false)` after the route verifies a
  booking token.
- A guest variant of **every post-booking read and write**, each behind a token check in its route:
  - `GET /bookings/{ref}`, invoice, voucher;
  - payment create and payment **sync** (quote guests have no sync today; their confirmation waits on
    the webhook or the cron);
  - cancel, reschedule, the pickup request and pickup payment;
  - balance and instalments, the change-of-tour payment, hold release.

  `api_cancel_booking`, `api_reschedule_booking`, `api_request_pickup` and the rest check
  `user_id = auth.uid()` inside SQL. Each would need either a new identity-skipping wrapper or a
  `p_enforce_caller_identity` flag added by **redefining the function**, which is the most dangerous
  edit in this codebase (`database.md`).

- A second credential beside the JWT on about ten `/api/v1` routes. Web would carry it in a cookie and
  mobile in a header. `/api/v1/payments` and `/payments/sync` take the ref in the body, not the path,
  so a ref-scoped cookie cannot reach them. They would need new ref-scoped twins.
- Claim on sign-up: generalise `api_claim_quote_bookings` to `source = 'web'`.

**Pros.** No Supabase configuration change, no anonymous users to clean up, and a house pattern.
**Cons.** Ten or so identity bypasses, each one wrong check away from letting anyone with a ref act on
a booking. The JWT-first API story breaks, because a route would accept a non-JWT credential. And the
guest flow would differ from the account flow on every screen, which doubles the regression surface.
**This is the fallback if the owner declines decision 1.**

### Option B — a guest session via Supabase anonymous sign-in, plus an emailed manage link (recommended)

The guest's browser calls `supabase.auth.signInAnonymously()` when they tap Pay. From then on it holds
an ordinary Supabase session (`supabase-js` 2.108 in this repo supports it), so the existing code path
runs unchanged:

- book, pay, the widget, sync, the confirmation page;
- `/account/bookings`, invoice, voucher, cancel, reschedule, pickup, balance, change of tour.

What is new is small:

- one wrapper around `api_book`, for the caps;
- a manage link plus one **adopt** endpoint, for cross-device access;
- one claim RPC, a copy of the quote claim's rules for web bookings;
- a purge of unused anonymous users;
- a classification of which routes are open to guests and which need a real account.

**Pros.** No change to the money-path SQL. `/api/v1` stays JWT-first, and a mobile app does the same
anonymous sign-in. Guests and account holders share one code path after step ②. Guests also get
`/payments/sync` for an instant confirmation, which quote guests lack.

**Cons.**

- A project-wide auth switch: anyone with the public anon key can mint an `authenticated` JWT that has
  no email. They gain nothing a free Google account does not already give them. The difference is that
  it can be scripted (see [risks](#security-risks)).
- An anonymous-user lifecycle to run.
- An audit of every route and RLS policy that assumes "authenticated" means "has an account".

### Option C — a passwordless account at step ② (6-digit email code)

Use `signInWithOtp`, then an in-page code box: a real account, but no password.

It still sends the guest to their inbox in the middle of checkout, which is the step the data points
at. Every attempt is also a Supabase auth email, the very sender that is already returning
`over_email_send_rate_limit` at checkout.

A variant: create the account silently from the typed email with `auth.admin.createUser`. That makes
accounts for addresses nobody has proven they own, and someone else's address could be typed. It also
cannot book as a guest against an existing account's address without revealing that the account
exists, which is an enumeration oracle. **Rejected.** Code sign-in may still be worth offering as a
nicer _sign-in_, but it is not guest checkout.

### Comparison

|                                 | A — signed link                                      | **B — guest session**                                                     | C — email code                                   |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------ |
| Removes the account wall        | Yes                                                  | **Yes**                                                                   | Partly: the inbox round-trip remains             |
| Money-path SQL changed          | New identity-skipping wrappers, some by redefinition | **None.** One wrapper around `api_book` for caps                          | None                                             |
| `/api/v1` stays JWT-first       | No: a second credential on ~10 routes                | **Yes.** Only `/adopt` also takes the link proof                          | Yes                                              |
| Post-booking surfaces           | Each needs a guest variant                           | **Work unchanged**                                                        | Unchanged                                        |
| Supabase configuration          | None                                                 | Enable anonymous sign-ins; raise their per-IP limit                       | OTP template; email rate limit already being hit |
| New lifecycle                   | None                                                 | Purge unused anonymous users                                              | None                                             |
| The likeliest way it goes wrong | One of ~10 bypasses checks the wrong thing           | An account-only feature forgets `requireAccount`, so a guest can reach it | Still loses people at the inbox                  |

## Recommended design (Option B)

### 1. Checkout, step ②

- **No real-account session** (no session at all, or a leftover anonymous one), with the kill switch
  on: step ② shows the details form directly (full name,
  **email**, phone, country, and the transfer extras), with a main **Continue** button. Above the form
  sits one line: "Have an account? **Sign in** · **Continue with Google**". Sign-in opens
  `AuthDialog`, as today. Google is a redirect, and the existing draft restore brings the guest back to
  their step.
- The email field is **editable** whenever the session is anonymous or absent. Today it is read-only
  and filled from `user?.email`. `opCustomer.email` must take the typed address, because `user.email`
  is null for an anonymous user. A client-side **typo suggester** offers corrections such as
  `gmial.com` → `gmail.com` and `hotmial.com` → `hotmail.com`. It needs no backend, and a wrong
  address is the main way a guest loses their confirmation.
- **The anonymous session is created lazily, at `pay()`**, only when there is no session. That keeps
  the number of anonymous users close to the number of guest Pay taps, not the number of checkout
  visits. The call can start as soon as the step ② form is valid, to hide its ~300 ms. If it fails, the
  error reads "We couldn't start your booking — please try again" and the button stays usable.
- Step ③ replaces "Signed in as {email}" with "Booking as a guest — we'll send your confirmation to
  {email}".
- Any new or changed string passed to `t(...)` needs its key in `src/lib/i18n/messages.ts` in the same
  commit (an exact match, including `’` and `—`).
- Step events extend `checkout_funnel_events` (`20261029120000`) with `step_2_guest` (the guest form
  was shown) and `guest_session_failed`. `pay_clicked` then covers guest taps too, and its comment
  ("Pay tapped while signed in") must change.
  - Adding an event label means another `create or replace` of `api_log_checkout_event`. Base it on the
    winning body, which today is `20261029120000`, or whatever sorts last when this is built.

### 2. Identity: what the server sees

- `verifyAccessToken` adds `isAnonymous: payload.is_anonymous === true` to `AuthUser`. `requireUser`
  is unchanged.
- A new `requireAccount(req)` throws 403 `account_required` when `isAnonymous` is true. Every route
  that means "a person with an account" uses it.
- **A classification test** lists every route under `app/api/v1` that calls `requireUser`, and labels
  each one `guest-ok` or `account-only`. It fails when a route is not listed, or when an account-only
  route does not call `requireAccount`, in the same way the `runtime = 'edge'` test works. Starting
  classification:
  - **guest-ok:** `bookings` (GET and POST), `bookings/[ref]` and everything under it, `bookings/pending`,
    `holds/[id]`, `holds/[id]/release`, `payments`, `payments/sync`, `notifications/*` (own rows only).
  - **account-only:**
    - `account/profile`, `account/export`, `account/delete`, `account/reviews`;
    - `wishlist`, `saved-cards`, `activities/[slug]/reviews` (the write path);
    - `reviews/google-live`, `seo/*`, `admin/*`;
    - every quote route that calls `requireUser` (those are staff routes; a guest's quote link does not
      call `requireUser`).

    The implementer re-checks each one. "Account-only" here means "a guest has no reason to call it".

- Database side, two helpers:
  - `is_anonymous_caller()` reads the `is_anonymous` claim from `auth.jwt()` (false when absent), for
    any policy that must exclude guests;
  - `is_anonymous_user(uuid)` is a security-definer function that reads `auth.users.is_anonymous`,
    and is the authoritative check inside definer functions.
- `AuthProvider`:
  - **skips the lazy `profiles` insert** for anonymous users. A row would be harmless, because
    `enforce_profile_role` forces `customer`, but it is noise. The only foreign key that points at
    `profiles(id)` for a booking, `booking_change_requests.created_by`, is written only by staff RPCs.
  - exposes `isGuest`;
  - runs the new guest claim after `api_claim_quote_bookings`, **for non-anonymous sessions only**.
- Header, account menu and `/account`:
  - a guest sees "Guest" instead of an email;
  - `/account` shows their bookings, plus "Save your bookings to an account";
  - profile, privacy and wishlist ask them to create an account first.

### 3. Booking and paying, in the session

```
step ② form valid  (no session yet)
Pay tapped
  └─ no session → supabase.auth.signInAnonymously()            ← user is_anonymous = true
POST /api/v1/bookings   Authorization: Bearer <anonymous JWT>
     body: … customer.email = typed address, turnstileToken
  route: requireUser → isAnonymous
         → kill switch on?           else 401 account_required
         → rateLimit 'bookings:guest'
         → Turnstile siteverify      (when configured)
         → api_book_guest(p + actorUserId)   ← caps, then api_book(p), untouched
POST /api/v1/payments   Bearer <anonymous JWT>
         → api_create_payment → create_payment: v_booking.user_id = auth.uid() ✓
/bookings/{ref}/pay → Peach widget → /payments/sync (Bearer ✓) → append_payment_event (unchanged)
/bookings/{ref}     → confirmation (the session owns the booking ✓)
```

**`api_book_guest(p)`** (security definer, `service_role` only):

1. Requires `p.actorUserId` to be non-null and `is_anonymous_user(actorUserId)`; otherwise
   `forbidden`. Real accounts keep calling `api_book` directly, so the wrapper can never weaken an
   account booking.
2. Takes `pg_advisory_xact_lock(hashtext('guest-book:' || <email count key>))` so that two concurrent
   requests cannot both pass the per-email cap.
3. Counts, **leaving out any booking whose `idempotency_key` equals `p.idempotencyKey`**, so a
   legitimate retry is never refused:
   - live unpaid bookings (`payment_pending`) owned by this identity;
   - bookings this identity created in the last 24 hours;
   - live unpaid web bookings for this email count key whose owner is anonymous.

   Over any cap → `guest_booking_limit`. `mapDbError` maps it to a 429: "You already have unpaid
   bookings open — finish paying for one, or wait 30 minutes and try again."

4. `return api_book(p);`. The wrapper's owner is the function owner, so calling the service-role-only
   `api_book` from it works (the same arrangement as `api_create_payment` → `create_payment`).

The **email count key** is `quote_email_key(email)` with a `+tag` stripped from the local part. It is
used **for counting only**, and never for the claim match. The claim uses `quote_email_key` exactly,
because both sides of that match must normalise the same way (`20260909000000` §6c-bis).

**Turnstile** runs in managed (usually invisible) mode on step ②. Only the anonymous branch of
`POST /bookings` requires a token. A token lasts 300 seconds and works once:

- the price-changed "Tap Pay again" path reuses the existing booking ref and makes no second create,
  so it needs no new token;
- a create that fails on the network calls `turnstile.reset()`.

`TURNSTILE_SECRET_KEY` unset means the check is skipped, which suits `next dev` and sandbox. If the
owner chooses decision 3, production must fail closed instead (`isProductionLikeRuntime()`), like the
other production config throws: an anonymous create with no key configured is refused.
`challenges.cloudflare.com` must be added to the CSP that middleware sets.

### 4. After booking: the manage link

Every surface a guest needs, and how they reach it:

| Surface                                                                                               | Same device                                  | Other device                                         | Change needed                                                                           |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Confirmation `/bookings/{ref}` (`BookingConfirmation.tsx`)                                            | The session owns it                          | Manage link → tap → adopt                            | Guest banner ("Save to an account"); show the email; the `?link=1` interstitial (below) |
| Pay `/bookings/{ref}/pay`, "Pay now" (`ResumePaymentButton`), `/payments/sync`                        | Bearer owner check passes                    | After adopt                                          | One line in `/api/v1/payments` (save card, below); the rest of the payment code: none   |
| Invoice and voucher PDFs                                                                              | `/invoice`, `/voucher` with Bearer           | After adopt; also attached to the confirmation email | None                                                                                    |
| Cancel → refund                                                                                       | `/cancel` with Bearer                        | After adopt                                          | None. The refund is still made by hand in Peach                                         |
| Reschedule and weather-disruption emails (`booking-change.ts`)                                        | —                                            | Email → manage link → adopt                          | The link builder                                                                        |
| Late pickup (`pickup.ts` reminders at 48 h and 24 h), balance and instalments, change-of-tour payment | Bearer owner checks                          | Email → manage link → adopt                          | The link builder                                                                        |
| Review requests                                                                                       | Their own single-use token (`guest_reviews`) | Same                                                 | None                                                                                    |
| Checkout-recovery email (switched off)                                                                | Links to the activity page, not the booking  | —                                                    | None, but see [risks](#security-risks) (unverified addresses)                           |
| Status emails rendered in `src/lib/notifications/resend.ts`                                           | —                                            | Their `bookingUrl`                                   | The link builder                                                                        |

**The token.** It is derived, not stored:

```
token = hex( HMAC-SHA256( GUEST_LINK_SECRET,
                          "bmt-guest-link:v1:" || bookings.id || ":" || version ) )   -- 64 hex chars
```

- **Derived, because the emails are sent later.** Quotes can store a hash because they mint and send
  in one request. A guest booking's emails go out days or weeks later from the notification drain: the
  48-hour pickup reminder, a weather move, a balance reminder. The drain needs the raw token again,
  and a derived token can be recomputed at any send. A database leak exposes no tokens, and only Pages
  holds the secret (the drain renders emails in Pages: `/api/v1/internal/notifications/drain`).
- It is keyed on the booking's **uuid**, never the public ref.
- `version` comes from the new `booking_guest_links` table, where a missing row means 1. Staff can
  bump it with **Reset guest link** in the booking drawer, which kills every earlier link.
- It never expires on its own, because the booking emails must keep working until the trip, and for
  the invoice after it. The version is the revocation.
- It is verified in constant time with the `^[0-9a-f]{64}$` shape check of `quoteTokenMatches`.
  `GUEST_LINK_SECRET_PREVIOUS` is also accepted during a rotation.
- The secret goes into the `env.ts` Zod schema. Unset on a production-like runtime, guest links are
  not minted, emails fall back to the plain `/bookings/{ref}` link, and `/adopt` refuses.

**The link builder.** `bookingLink(ref)` lives in the email layer and asks one service-role read,
`api_guest_link_target`, whether the booking is guest-owned:

- **guest-owned** (`source = 'web'`, owner null or anonymous) →
  `${SITE.url}/api/v1/bookings/{ref}/open?t={token}`;
- otherwise → `${SITE.url}/bookings/{ref}`, as today.

It is used by `booking-confirmation.ts`, `pickup.ts`, `booking-change.ts` and the `resend.ts` renders.
The builder already knows the booking's locale (the drain renders the email in it), so it adds
`&l=fr` for a French booking. That keeps `/open` free of any database read.

**Save card must stay off for guests.** `POST /api/v1/payments` offers Peach's "save card" opt-in and
passes `userId` whenever `user.role === 'authenticated'`, which is also true for an anonymous user. A
guest would be offered card storage tied to an identity the purge deletes after 30 days. The condition
becomes `user.role === 'authenticated' && !user.isAnonymous`, for both `saveCard` and `userId`. Nothing
else in the payment routes reads the user: `/payments/sync` compares `booking.user_id` with `user.id`,
which holds for the anonymous owner.

**`GET /api/v1/bookings/{ref}/open?t=…`** does no database read and no write:

1. Checks the shape of the ref (a booking-ref regex, like `quoteRefLooksValid`) and of the token.
2. Sets the cookie `bmt_guest_link=<t>` with `Path=/api/v1/bookings/{ref}/adopt`, `Max-Age=1800`,
   `HttpOnly`, `Secure` and `SameSite=Lax`. The token never reaches a page URL that GTM or Clarity
   could export, which is the reasoning in `src/lib/quotes/link-cookie.ts`.
3. 302 → `/bookings/{ref}?link=1`, under the French prefix when `l=fr`. Any other value of `l` is
   ignored.

**Adoption needs a tap. This is a hard rule.** Link scanners fetch emailed URLs: Microsoft's 104.47.x
IPs already hit `/verify`, and some scanners run JavaScript. If the booking page signed in anonymously
and adopted on load, a scanner would create an anonymous user and pull the booking off the guest's own
device. So `/bookings/{ref}?link=1` without ownership shows an interstitial: "Booking BMT… — **View
my booking**". Only the click does the following:

- no session → `signInAnonymously()`, then `POST /api/v1/bookings/{ref}/adopt` with Bearer; the
  browser attaches the cookie;
- **anonymous** session → the same POST;
- **real account** session → the [claim](#6-claiming-guest-bookings). It succeeds when the account's
  confirmed email matches the booking's and the booking is paid. Otherwise the page says: "This
  booking isn't linked to your account. Sign in with the email address it was booked with to add it,
  or sign out to open it as a guest." The page shows nothing about the booking itself. No other branch
  puts a guest booking into a real account, so a forwarded email cannot move a booking into a
  stranger's account.

**When adopt refuses**, the page must not just say "invalid link". The most common late click is an
old email link to a booking the guest has since saved to an account (6a) or that was claimed (6b), and
adopt then gives its single 404. The page says: "We can't open this booking here. If you've added it to
an account, sign in to see it. Otherwise, use **Find my booking** to get a fresh link."

**`POST /api/v1/bookings/{ref}/adopt`** (Bearer, **anonymous callers only**):

1. `rateLimit 'bookings:adopt'` (10 per 10 minutes per IP).
2. Reads the token from the cookie on web, or from the body `{ token }` on mobile.
3. Reads `api_guest_link_target(ref)` → `{ bookingId, version, guestOwned }`, and verifies the HMAC.
4. Calls `api_adopt_guest_booking({ ref, userId })` (service role, JWKS-verified id).
5. **Every refusal is one 404, `not_found`.** That covers an unknown ref, a bad token, a booking
   that is not guest-owned, an erased booking, a quote, and a caller that is not anonymous. A split
   between 403 and 404 would let callers probe which refs exist, as in the quote routes.
6. Clears the cookie.

**`api_adopt_guest_booking(p)`** (definer, `service_role` only) locks the booking `for update` and
refuses unless all of these hold:

- `source = 'web'`;
- the owner is null or `is_anonymous_user(owner)`;
- `customer_email` is not the erasure sentinel `deleted@privacy.invalid`;
- the target user exists **and** is anonymous.

It then sets `bookings.user_id`, and nothing else. No other table is keyed to the owner of a live
booking:

- payments, pickup requests and change requests key on `booking_id`;
- the consumed hold's `created_by` is never read again;
- in-app bell notifications already sent stay with the previous identity. That is accepted.

It is idempotent when the caller already owns the booking.

### 5. Find my booking (ref + email)

There is a `/bookings/find` page with a ref field and an email field, backed by
`POST /api/v1/bookings/lookup`:

- It always answers **202**: "If that matches a booking, we've emailed a link to the address on
  it." It never confirms that a booking exists.
- A link goes out only when **all** of these hold:
  - the ref exists;
  - `quote_email_key(stored) = quote_email_key(typed)`;
  - the booking is guest-owned.
- `api_request_guest_link(p)` (definer, `service_role`) inserts one `notification_outbox` row with
  template `guest_booking_link`, sent to the **stored** address, never the typed one. Its idempotency
  key is the booking plus the hour. The outbox is write-locked to clients (§6d), so the RPC is the
  writer.
- Rate limits: 5 per hour per IP and 3 per day per booking.
- Account-owned bookings get no email. The constant 202 hides that too. The page also says "Booked
  with an account? Sign in."

### 6. Claiming guest bookings

**a) Same browser: the guest saves their booking to an account.** From the confirmation banner or
`/account`, Supabase's own conversion of an anonymous user:

1. `supabase.auth.updateUser({ email })`. Supabase sends a confirmation through the send-email hook,
   which already renders `email_change`.
2. After the guest clicks it, `updateUser({ password })`. A Google option, `linkIdentity`, needs manual
   linking enabled and is a follow-up.

The **user id does not change**, so the bookings are already theirs and there is nothing to claim. If
the address already has an account, Supabase refuses, and the banner says "You already have an account
— sign in and we'll add your bookings." That leads to (b). This conversion email is subject to the same
send limit that bites at checkout today. It is optional and happens after payment, so a failure costs
the account, never the booking.

**b) Signing in to an existing account.** A new `api_claim_guest_bookings(p)` (definer, granted to
`authenticated`) runs from `AuthProvider` on every sign-in, next to `api_claim_quote_bookings`. It is
best-effort and never blocks the session. Its rules **reuse the quote helpers without redefining
them**:

- The caller must not be anonymous (`unauthorized` / returns 0). With no `auth.uid()` → `unauthorized`,
  as in the quote claim.
- The address comes from the caller's **own** `auth.users` row, never from the payload.
- `quote_owner_for_email(address) = auth.uid()` must hold: a **confirmed** account and **exactly one**.
  Unconfirmed or ambiguous claims nothing.
- The bookings must have `source = 'web'` and an owner that is null or anonymous. A booking owned by a
  real account can never move.
- `quote_email_key` is applied to **both** sides of the comparison.
- **Only money-bearing statuses** are claimed: `confirmed`, `completed`, `refund_pending`, `refunded`,
  and `cancelled` with money on the ledger. Never `payment_pending`, `expired`, `failed` or an unpaid
  cancellation. Otherwise anyone could plant an unpaid "Pay now" booking in a stranger's account by
  typing the stranger's email. A paid one costs the attacker the price of the booking. It also brings
  nothing new: the address owner already received that booking's confirmation, with the guest's details.
- It returns `{ claimed: n }`, and the client shows a toast: "We added 1 booking made with this email
  to your account."

**c) What happens to an unpaid guest booking when the guest signs in mid-checkout.** The anonymous
session is replaced, and the stashed ref becomes unreadable for the new user. `Checkout.tsx`'s existing
definitive-miss path drops the ref and rotates the idempotency key, so a fresh booking is made under the
account. The orphaned booking expires within 30 minutes. No change is needed, but the e2e plan below
covers it.

The rule in one line: **the link moves a guest booking between guest sessions; only a confirmed
mailbox moves it into an account.**

### 7. Abuse limits

**Capacity squatting already happens without guest checkout.** Holds are anonymous today. The
Continue button posts `/api/v1/holds` with no auth header, limited to `holds:create` 30 per minute per
IP, each hold lasting 30 minutes. A script can already hold the last seat of any departure without an
account. A guest booking keeps a seat for the same window: the maintenance sweep expires an unpaid
booking 30 minutes after it was created. So guest checkout adds no new way to squat. It adds **volume,
through cheap identities**, and **a direct path to Peach**. The limits are aimed at those two:

| Limit                                          | Where                             | Starting value                          | What it is for                                                                                                           |
| ---------------------------------------------- | --------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Anonymous sign-ins per IP                      | Supabase → Auth → Rate limits     | Raise the default to about 100 per hour | Supabase's own brake on minting identities. Raised because hotel Wi-Fi and mobile CGNAT share one IP                     |
| Guest booking creates per IP                   | Route, `bookings:guest`           | 10 per hour                             | Identities are cheap, so the IP is the limit that binds                                                                  |
| All booking creates per IP                     | Route, `bookings:create` (exists) | 15 per minute, unchanged                | —                                                                                                                        |
| Live unpaid bookings per guest identity        | `api_book_guest`                  | 3                                       | —                                                                                                                        |
| Bookings per guest identity per 24 h           | `api_book_guest`                  | 10                                      | —                                                                                                                        |
| Live unpaid guest bookings per email count key | `api_book_guest` (advisory lock)  | 3                                       | Stops loops and careless scripts only. Throwaway addresses walk around it, which is why the IP and Turnstile limits bind |
| Turnstile                                      | Route, anonymous creates          | On (decision 3)                         | The one control that makes a scripted identity cost something                                                            |
| Live Peach sessions per booking                | `create_payment` lease (exists)   | One, unchanged                          | —                                                                                                                        |
| Unpaid booking lifetime                        | Maintenance sweep (exists)        | 30 minutes, unchanged                   | —                                                                                                                        |
| Adopt, lookup                                  | Routes                            | 10 per 10 minutes, 5 per hour, per IP   | Brute force is pointless against 256 bits, but the routes are cheap to call                                              |

**Card testing** is the usual abuse of a new guest checkout: stolen card numbers are tried against
small merchants with little friction. Today the account wall, with its email confirmation, protects the
site by accident. Removing it needs four replacements:

- Turnstile;
- the per-IP cap, which means at most 10 guest Peach sessions per IP per hour;
- Peach's own 3-D Secure and risk rules: the owner should confirm with Peach that 3-D Secure is enforced
  for MUR and EUR charges;
- a watch query in the runbook: guest bookings per hour that expired after a widget `first_input`. An
  automatic owner alert is a follow-up.

**Email.** Nothing is emailed to the customer for an unpaid booking, because the confirmation fires on
`confirmed`. So guest checkout cannot be used to mail arbitrary addresses without paying.

- The checkout-recovery email (switched off by default) would reach unverified guest addresses, but at
  most once per 30 days per address. That is acceptable. Note it if the owner turns recovery on.
- Find-my-booking mails only the stored address, under rate limits.

**Anonymous users.** `api_purge_anonymous_users(p)` (definer, `service_role`) runs at the **end** of
the maintenance chain, after the existing purges. It never moves the reconcile → expire → materialise
order. It deletes up to 500 per run of `auth.users` rows where all of these hold:

- `is_anonymous`;
- `created_at < now() - interval '30 days'`;
- **no booking references the user.**

Bookings would survive the deletion anyway: `bookings.user_id` is `on delete set null`, and the link
still works because it is keyed on the booking. But keeping owners makes adopt and claim simpler.

Other foreign keys to `auth.users`, checked against the migrations:

- `profiles`, `wishlists`, `notifications` and `saved_cards` cascade;
- `chat_sessions`, `audit_logs.actor_id`, `reviews`, `quotes.created_by` and the documents tables are
  set to null;
- `booking_holds.created_by` has no foreign key. The ids it leaves behind belong to holds that expired
  weeks earlier and are never reused.

**Prerequisite to verify on production:** the function owner may `DELETE` from `auth.users`. If not,
the maintenance route calls `auth.admin.deleteUser` for each id through the service-role client.
Expected volume is roughly the number of guest Pay taps, a few hundred a month.

**Kill switch.** `business_settings.guest_checkout_enabled_at` (NULL = off). The checkout page reads it
server-side, as it already reads `charge_currency`, and so does the route: an anonymous caller with
the switch off gets 401 `account_required`. With the switch off, the client treats a leftover
**anonymous session as signed out**: a returning guest still has one in localStorage after a rollback,
so both the step ② gate and the `pay()` guard key on "is there a real-account session", never on "is
there a session". Otherwise they would see the details form and then hit the 401 at Pay. **It ships
off.** Like `checkout_recovery_enabled_at`, any
team member can write it through `business_settings`' staff policy. That is accepted, because it
changes who may book, not what anyone pays. The owner flips it in SQL.

### 8. RLS

- **`bookings`: no change.** `bookings_select` (`user_id = auth.uid() or is_staff()`) already gives the
  anonymous owner their own row and nobody else's. There is **no customer UPDATE policy** on
  `bookings`: the original `bookings_insert` was dropped in `20260615121000`, and the only policies left
  are select-own and `bookings_staff`. So a guest cannot rewrite `customer_email`, or anything else,
  through PostgREST. That matters, because the claim and the link both trust that column.
- **New `booking_guest_links`:**
  - RLS on, staff read;
  - writes **revoked from `public, anon, authenticated`** (the §6d pattern);
  - the only writer is the definer `api_reset_guest_link`;
  - added to `LOCKS` in `tests/integration/admin-roles.test.ts`.
- **The audit (part of the implementation).** Anonymous users are `authenticated`. List every policy
  that names `authenticated` or `public`, and every function that `authenticated` can execute, and
  classify each as guest-ok or account-only:

  ```sql
  select tablename, policyname, cmd, roles, qual, with_check from pg_policies
   where schemaname = 'public' and (roles && '{authenticated,public}');
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
  ```

  Found while writing this, all fine for a guest:
  - `profiles_insert` is own-row only, and the role is forced to `customer`;
  - the old open `reviews_insert` was already dropped (F12, `20260617120100`);
  - wishlists, notifications and saved cards are own-row only;
  - `api_claim_quote_bookings` reads an email the anonymous user does not have, so it returns 0;
  - `api_update_profile` and the self-erase in `api_erase_user` touch only the caller.

  Anything that should not serve guests gets `and not is_anonymous_caller()`.

### 9. API, and the mobile story

| Route                                          | Change                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/bookings`                        | The anonymous branch (kill switch, `bookings:guest`, Turnstile, `api_book_guest`). The header comment ("SIGNED-IN ONLY …") is rewritten |
| `GET /api/v1/bookings/{ref}/open`              | **New.** No auth and no database access. Sets the link cookie and redirects                                                             |
| `POST /api/v1/bookings/{ref}/adopt`            | **New.** Bearer (anonymous) plus the link proof, from the cookie or `{ token }`                                                         |
| `POST /api/v1/bookings/lookup`                 | **New.** No auth; always 202                                                                                                            |
| `POST /api/v1/account/claim-guest-bookings`    | Optional. The browser calls the RPC directly, as the quote claim does; a route only if mobile wants one                                 |
| `POST /api/v1/payments`                        | `saveCard` and `userId` only when `!user.isAnonymous` (see §4). Otherwise unchanged                                                     |
| `payments/sync`, `bookings/{ref}/*`, `holds/*` | **None**                                                                                                                                |
| Account-only routes (see §2)                   | `requireAccount`                                                                                                                        |
| `openapi.json`                                 | New request and response schemas → `npm run openapi:write`                                                                              |

**Every `/api/v1` route still identifies its caller by a Supabase JWT in `Authorization: Bearer`.**
The one non-JWT credential, the link token, is an extra _proof_ accepted by `/adopt` alone, and that
route still requires a Bearer. A mobile app:

1. calls `signInAnonymously()`, which is in Supabase's Swift, Kotlin and Flutter SDKs;
2. sends the same Bearer to the same routes;
3. opens the emailed `/api/v1/bookings/{ref}/open?t=` URL as a universal or app link, and POSTs `/adopt`
   with `{ token }`.

No route accepts a cookie as identity.

### 10. Client changes (list)

- **`Checkout.tsx`:**
  - the step ② guest form and editable email;
  - `opCustomer.email` takes the typed address;
  - lazy `signInAnonymously` in `pay()`;
  - the Turnstile widget and token;
  - step ③ copy;
  - the step events;
  - the `if (!session) return openAuth('signin')` guard in `pay()`, and the step ② gate, become "no
    **real-account** session and the kill switch is off". A leftover anonymous session counts as
    signed out (§7, kill switch).
- **`AuthProvider.tsx`:** skip the profile insert for anonymous users; `isGuest`; the guest claim, for
  non-anonymous sessions only.
- **`AuthDialog.tsx`:** no change in behaviour. Signing in from a guest session replaces it, and claim
  (b) picks up paid bookings. Signing up from a guest session creates a new user, and claim (b) runs
  after confirmation. The _save to account_ flow (6a) is the path that keeps the id.
- **`BookingConfirmation.tsx`:** the `?link=1` interstitial, the guest banner, the masked email, and
  "opened on another device" when a link-adopted booking has left this session.
- Header and account menu, `/account`, `/account/bookings`: the guest states.
- Email builders: `bookingLink()`.
- `src/lib/http/auth.ts`: `isAnonymous` and `requireAccount`.
- `src/lib/config/env.ts`: `GUEST_LINK_SECRET`, `GUEST_LINK_SECRET_PREVIOUS`, `TURNSTILE_SECRET_KEY`.
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is a build-time repository variable.
- `src/lib/i18n/messages.ts`: every new string; run `node scripts/i18n-scan.mjs`.
- The analytics recipe in the main session's funnel notes: **"accounts created" must exclude
  `auth.users.is_anonymous`**. A converted hold's `created_by` can now be an anonymous user, so
  "signed-in hold" means "converted hold by any identity", not "account".

### 11. Migrations

**One file, schema only:** `supabase/migrations/20261030120000_guest_checkout_schema.sql`. It adds
`business_settings.guest_checkout_enabled_at` and the `booking_guest_links` table (RLS on with no
policies, all grants revoked from `public, anon, authenticated`). It defines and redefines no function.
It is additive, so the code running today is unaffected by it.

**Owner verification after applying it on production** (read-only):

```sql
select has_table_privilege('authenticated', 'booking_guest_links', 'SELECT');  -- false
select has_table_privilege('anon', 'booking_guest_links', 'INSERT');           -- false
select has_table_privilege('service_role', 'booking_guest_links', 'UPDATE');   -- true
select guest_checkout_enabled_at from business_settings;                       -- null (off)
select policyname, cmd, roles, qual from pg_policies where tablename = 'bookings';
-- expect exactly bookings_select (own or staff) and bookings_staff: NO customer UPDATE policy.
```

### 12. Owner runbook: the order matters

**To release the code** (the site behaves exactly as it does today afterwards):

1. **Apply the migration** in the SQL editor, run the verification queries above, then **insert its
   ledger row**:

   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('20261030120000', 'guest_checkout_schema')
   on conflict (version) do nothing;
   ```

2. **`git push origin main`**, and wait for CI, including the _Edge bundle_ step.

**To turn guest checkout on, whenever you choose:**

3. **Cloudflare → Turnstile → add a widget** for bellemaretours.com, in Managed mode. Put the keys in
   the Pages environment as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, then redeploy. Without them
   the guest form stays hidden on production.
4. **Supabase → Authentication → Sign In / Providers → "Allow anonymous sign-ins": on.** Under Rate
   limits, raise anonymous sign-ins to about 100 per hour. Keep **"Confirm email" on**: the claim depends
   on it (confirmed on production 2026-10-30), and switching it off would turn claim-by-email into a way
   to take over bookings.
5. **`update business_settings set guest_checkout_enabled_at = now();`**
6. **Smoke test:**
   1. From a private window on a phone, make a guest booking with a small real card.
   2. Open the confirmation email on a second device and tap "View my booking".
   3. Refund in Peach.
   4. Check that the booking's owner is `is_anonymous`, the payment settled, and the outbox row was
      sent.

**Rollback** is `update business_settings set guest_checkout_enabled_at = null;`. Step ② shows the
account gate again at the next page load. Existing guest bookings, their sessions, links, payments and
emails keep working, because they run on code paths that never read the switch: links, adopt, claim,
pay and sync. Do **not** use "disable anonymous sign-ins" as the rollback. Guests already holding a
link would lose the anonymous sign-in that `/adopt` needs on a new device. Turn it off only after the
switch has been off long enough that no guest booking is still upcoming.

### 13. Docs to update when built

- `docs/handbook/architecture.md` §3: "The one customer who has no account — quotes" becomes two
  kinds. Quote guests are ownerless and token-authorised. Web guests are an anonymous owner, with a
  link to adopt.
- `docs/handbook/landmines.md`, new entries:
  - "an anonymous JWT passes `requireUser` — use `requireAccount`";
  - "a GET on an emailed link must never mutate (scanners)";
  - "never turn off Supabase email confirmation: claim-by-email becomes takeover";
  - "`api_book_guest` wraps; never fold its caps into `api_book`".
- `docs/handbook/operations.md`: the kill switch, Reset guest link, the card-testing watch query, the
  purge.
- `docs/handbook/database.md` Roles: `is_anonymous`.
- The funnel memory: exclude `is_anonymous` from "accounts created".

## Security risks

| #   | Risk                                                                              | Severity         | Mitigation                                                                                                                                                                                  | Residual                                                                                                                                   |
| --- | --------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Scripted anonymous identities in bulk                                             | Medium           | Supabase per-IP limit; `bookings:guest` per IP; per-identity and per-email caps; Turnstile; the purge                                                                                       | A distributed botnet with Turnstile solvers. The same exposure as free Google accounts, at higher volume                                   |
| R2  | **Card testing** through the Peach widget                                         | High             | Turnstile; 10 guest sessions per IP per hour; 3-D Secure (confirm with Peach); the watch query; the kill switch                                                                             | Fees and Peach risk flags before the owner notices. An automatic alert is a follow-up                                                      |
| R3  | Capacity squatting                                                                | Medium           | It already exists at the hold layer. Guest bookings hold seats no longer (30 minutes); there are caps                                                                                       | A pre-existing gap at `/holds` (see follow-ups)                                                                                            |
| R4  | The manage link leaks: a forwarded email, a screenshot, a mail scanner            | Medium           | GET `/open` does nothing but set the cookie. Adopt needs a tap and a Bearer. The token is never in a page URL. Links cannot move a booking into a real account. Reset guest link revokes    | Whoever holds the link can manage that one booking, the same model as a quote link                                                         |
| R5  | Adopt or claim takes a booking from a real account                                | High             | Both refuse unless the owner is null or anonymous; a text-pin test; `source = 'web'` only                                                                                                   | —                                                                                                                                          |
| R6  | Claim to the wrong person through a typo'd address that belongs to a real account | Low              | Confirmed accounts only, exactly one match, paid bookings only                                                                                                                              | Accepted: the same rule as quotes. The confirmation email already went to that person                                                      |
| R7  | Claim with an unconfirmed address                                                 | High             | `quote_owner_for_email` is confirmed-only, and the shim keeps `email_confirmed_at`. Runbook: never turn off "Confirm email"                                                                 | Only if the dashboard setting is changed. It goes on the landmines page                                                                    |
| R8  | Enumerating refs or addresses                                                     | Medium           | `/lookup` always answers 202; `/adopt` gives one 404 for every refusal; no step ② message reveals an existing account                                                                       | —                                                                                                                                          |
| R9  | An anonymous JWT reaches an account-only feature                                  | Medium           | `requireAccount`; the classification test; the RLS and function-grant audit                                                                                                                 | A future route that skips the test (the test exists to catch exactly that)                                                                 |
| R10 | Money-path regression                                                             | High             | No money-path function is redefined; the PGlite tests prove the anonymous owner passes and a stranger fails `create_payment`; `setup-sql-executes` keeps proving anon cannot reach the RPCs | —                                                                                                                                          |
| R11 | A typo'd guest email: no confirmation, no link                                    | Medium (support) | The typo suggester; the address shown on the confirmation page; the same-device session still works                                                                                         | A guest on a borrowed device who typed the wrong address. The owner can fix it from `/admin`; a self-serve email correction is a follow-up |
| R12 | GDPR: guest data with no account                                                  | Low              | Anonymous users hold no PII; the booking holds it, as for quotes. The admin's erase-by-email already covers guests. The purge. The privacy notice                                           | —                                                                                                                                          |
| R13 | Polluted analytics ("accounts created" counts anonymous users)                    | Low              | Recipe updated to exclude `is_anonymous`                                                                                                                                                    | —                                                                                                                                          |
| R14 | An anonymous user's session is lost (cleared storage) mid-payment                 | Low              | The webhook and the cron settle without the session; the manage link arrives with the confirmation                                                                                          | —                                                                                                                                          |

## Test plan

**Test-infrastructure changes first:**

- `tests/db/auth-shim.sql` gains `is_anonymous boolean not null default false` on `auth.users`.
- `tests/db/rpc.ts` and `tests/db/book.ts` special-case `api_book`: they switch to `service_role`
  and inject `actorUserId` from the current claims. `api_book_guest` needs the same treatment.
  Without it, every test that books as the anonymous user fails with permission denied before it
  reaches a cap.
- A `signInAnonymous(db)` helper sets claims `{ sub, role: 'authenticated', is_anonymous: true }` and
  inserts the matching `auth.users` row.

**Integration (PGlite), `tests/integration/guest-checkout.test.ts`:**

- _The money path is unchanged._
  - An anonymous-owned booking made through `api_book_guest`.
  - `api_create_payment` under that identity's claims passes. Under another anonymous identity, or
    another account → `forbidden`. With no `sub` → `forbidden`.
  - `append_payment_event` confirms it exactly as it does an account booking.
- _Grants._
  - `anon` and `authenticated` cannot execute `api_book`, `api_book_guest`, `api_adopt_guest_booking`,
    `api_guest_link_target`, `api_request_guest_link` or `api_purge_anonymous_users`.
  - `authenticated` can execute `api_claim_guest_bookings`.
  - Extend `setup-sql-executes.test.ts`'s assertions that anon cannot reach the money RPCs to cover
    these.
- _`api_book_guest`._
  - Refuses a real-account actor and a null actor.
  - Each cap fires: per identity, per 24 h, and per email, including case, whitespace and `+tag`
    variants.
  - A replay with the same idempotency key is not counted and returns the same booking.
  - F23 still refuses a replay from a different anonymous identity.
- _Adopt._
  - null owner → moves; anonymous owner → moves.
  - Refused for: a real-account owner, `source = 'quote'`, the erasure sentinel, and a target user that
    is not anonymous.
  - Idempotent.
- _Claim._
  - A single confirmed account claims an anonymous-owned **paid** web booking, with a trimmed or
    differently-cased address.
  - `payment_pending`, `expired`, `failed` and unpaid cancelled bookings are **not** claimed.
  - An unconfirmed account and two confirmed accounts on the same address both get 0.
  - An anonymous caller gets 0 / `unauthorized`.
  - Bookings owned by a real account and quote bookings are untouched.
- _Purge._
  - Deletes old anonymous users with no bookings.
  - Keeps those with bookings, young ones, and every non-anonymous user.
  - Cascades their profile and wishlist rows.
- _Reset link_ bumps the version, and only for staff. _Request link_ queues one outbox row, to the
  stored address, deduplicated within the hour.
- _Locks._ `booking_guest_links` joins `LOCKS` in `admin-roles.test.ts`, as a `describeLocks` drift
  test. PGlite has no default grants, so the test must `grant all` first (the landmine).
- _Text pins_, in the style of `resolved-function-bodies.test.ts`, so a later migration forked from a
  stale copy fails CI:
  - `api_book_guest` asserts `is_anonymous_user`;
  - adopt and claim refuse non-anonymous owners and require `source = 'web'`;
  - claim goes through `quote_owner_for_email` and the money-bearing status list.
- `catch-up-parity` and `setup-sql-parity` cover the mirror and the regeneration.

**Unit:**

- The token: deterministic; sensitive to version and booking; accepts the previous secret; rejects a
  malformed token; compares in constant time.
- `/open`:
  - touches **no database**: a mocked client asserts zero calls;
  - sets exactly the cookie attributes from §4 (`HttpOnly`, `Secure`, `SameSite=Lax`, the adopt
    `Path`, `Max-Age=1800`);
  - rejects a ref or token of the wrong shape;
  - redirects to the right target.
- `/adopt`:
  - takes the token from the cookie or the body;
  - one 404 shape for every refusal;
  - a real-account caller → 404, so the page takes the claim branch;
  - rate-limited.
- `verifyAccessToken` parses `is_anonymous`; `requireAccount` refuses anonymous users.
- `POST /api/v1/payments` with an anonymous caller passes `saveCard: false` and no `userId` to
  `createPaymentLink`.
- `/open` with `l=fr` redirects under the French prefix, and ignores any other `l`.
- **Route classification:** every `requireUser` route is listed, and account-only routes call
  `requireAccount`.
- `bookingLink()`: guest-owned → the `/open` URL with a token; account-owned → plain. Each email
  template (`booking-confirmation`, `pickup`, `booking-change`, the `resend.ts` renders) carries it.
- `POST /bookings` anonymous branch:
  - switch off → 401 `account_required`;
  - a bad or missing Turnstile token when configured → 403;
  - production with no Turnstile key → refuses.
- i18n coverage and the `runtime = 'edge'` test cover the new strings and routes automatically.

**E2E (Playwright, `next dev`, stub payments).** The stub's webhook confirms anything, so these prove
the _flow_. The PGlite suite proves the money.

1. A guest books and pays without an account, and the confirmation shows the guest banner.
2. Reload mid-pay → the same booking is rehydrated, with no duplicate.
3. Open the manage link in a fresh browser context. The interstitial appears and **nothing is adopted
   without the click**. After the click the booking shows, and the first context then says "opened on
   another device".
4. **Scanner simulation:** a headless page loads the `/open` URL, runs its scripts and never clicks.
   The booking's owner is unchanged.
5. A guest saves to an account in the same browser (stub email confirmation) → the booking is in
   My trips under the same id.
6. A guest pays, then signs in to an existing confirmed account with the same email → the booking is
   claimed and the toast shows.
7. Switch off → step ② shows today's account gate. That includes a returning guest whose anonymous
   session is still in localStorage: they see the gate, never the details form followed by a 401.
8. Signing in mid-checkout with an unpaid guest booking → a fresh booking under the account, and
   nothing breaks.

**Manual, production (owner):** the smoke test in the runbook, plus the watch queries for the first
week: guest bookings per hour, anonymous users per day, and expired-after-`first_input` per hour.

## Measurement and rollout

- **The baseline comes first.** The step events from `20261029120000` (`step_1`,
  `step_2_signed_out`, `auth_opened`, `pay_clicked`, …) should collect 1 to 2 weeks before the switch
  is flipped. That shows how much of the loss is step ① and how much is step ②. If step ① dominates,
  guest checkout will help less than hoped, and the pickup step deserves attention first.
- **Primary metric:** holds → bookings created, against **26%** (146 / 556, 28 Sep – 25 Oct). Holds
  are overstated by cart lines and re-holds, so compare like with like, on the same definition. Target
  ≥ 35% over the first 4 weeks after the switch.
- **Guard metrics:**
  - bookings → paid stays ≥ 65% (it is 70% today);
  - no rise in chargebacks, `refund_pending` oversells or support contacts about lost confirmations;
  - anonymous users per day below about 3 × guest bookings per day.
- **Kill criteria:** flip the switch off on a card-testing pattern (clusters of guest bookings with
  declined or abandoned widgets from a few IPs), on any chargeback tied to a guest booking, or on an
  unexplained spike in anonymous users.
- **Report the guest share of bookings**, and the share of guests who later save to an account or
  claim. Saved accounts are a second, slower win: repeat bookings and reviews.

## Follow-ups (not in this design's first build)

- Self-serve **email correction** for a guest who typo'd. A definer RPC, allowed only to the anonymous
  owner, at most twice, resending the confirmation. It is deferred because it can turn the site into a
  relay for the confirmation PDF, so it needs its own limits.
- **Merge on sign-in for a different address.** Before signing in, capture the anonymous session's
  JWT, then hand it to a server route that verifies it is anonymous and moves its bookings to the new
  account. This is Supabase's recommended anonymous → existing-account pattern. The link already
  covers the common case.
- **Hold squatting hardening** at `/api/v1/holds`: a cap per IP on active holds. The gap predates this
  design.
- A staff tool to reassign a booking's owner, for the rare guest whose account email differs from the
  booking email.
- `linkIdentity` (Google) in the save-to-account flow.
- An automatic owner alert on the card-testing pattern.

## Open questions for the owner

1. Decisions 1–7 above.
2. Peach: is 3-D Secure enforced on every MUR and EUR charge, and are their fraud rules on for this
   merchant? This must be confirmed before Turnstile is waived, if it is waived.
3. Should guests be allowed to self-cancel exactly as account holders are? The design assumes yes, and
   the refund is by hand either way.

## File map (for the implementation plan)

| Area           | Files                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQL            | `supabase/migrations/<ts>_guest_checkout.sql` (new); a small `<ts>_checkout_guest_events.sql` (new, `api_log_checkout_event`); `supabase/catch-up.sql`; `supabase/setup.sql` (generated); `supabase/backfill-migration-ledger.sql`                                                                                                                                       |
| Server         | `src/lib/http/auth.ts`; `app/api/v1/bookings/route.ts`; `app/api/v1/bookings/[ref]/open/route.ts`, `…/adopt/route.ts`, `app/api/v1/bookings/lookup/route.ts` (new); `src/lib/services/bookings.ts`; `src/lib/services/errors.ts` + `mapDbError`; `src/lib/config/env.ts`; the guest-link token module (new, beside `src/lib/quotes/token.ts`); maintenance route (purge) |
| Email          | `src/lib/email/booking-confirmation.ts`, `pickup.ts`, `booking-change.ts`; `src/lib/notifications/resend.ts` (+ `guest_booking_link`)                                                                                                                                                                                                                                    |
| Client         | `src/components/checkout/Checkout.tsx`; `src/components/auth/AuthProvider.tsx`; `src/components/gyg/detail/BookingConfirmation.tsx`; header/account menu; `app/(site)/account/*`; `app/(site)/bookings/find/page.tsx` (new); `src/lib/i18n/messages.ts`                                                                                                                  |
| Types and spec | `src/lib/supabase/types.ts`; `src/lib/validation/booking.ts` (`turnstileToken`, lookup/adopt schemas); `openapi.json` (generated)                                                                                                                                                                                                                                        |
| Tests          | `tests/db/auth-shim.sql`; `tests/db/rpc.ts` (`ALLOWED`); `tests/integration/guest-checkout.test.ts` (new); `admin-roles.test.ts` (`LOCKS`); `resolved-function-bodies.test.ts`; `setup-sql-executes.test.ts`; route-classification unit test (new); e2e guest spec (new)                                                                                                 |
| Docs           | `docs/handbook/architecture.md`, `landmines.md`, `operations.md`, `database.md`                                                                                                                                                                                                                                                                                          |
