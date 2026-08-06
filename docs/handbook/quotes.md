# Quotes — an itemised offer a guest with no account can pay

[← Handbook](../HANDBOOK.md)

---

A **quote** is an offer the owner drafts in `/admin/quotes`, emails to a guest with a public link, and
that the guest pays through the **existing** Peach checkout — so it lands in the ledger and fires the
confirmation email and the VAT invoice like any other booking. Nothing on the money path downstream of
the conversion was changed to make this work.

The one thing that makes this module unlike every other flow in the app: **the guest has no account.**
There is no session to check, no `auth.uid()` to compare against, and the bookings RLS policy
(`user_id = auth.uid() or is_staff()`) can match neither branch. Every unusual decision below follows
from that single fact.

## Where the code lives

| File                                                          | What it owns                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `supabase/migrations/20260909000000_quotes.sql`               | Tables, enums, RLS, `api_convert_quote`, `api_claim_quote_bookings` |
| `supabase/migrations/20260911000000_quote_checkout_entry.sql` | `api_create_quote_payment` — the ownerless booking's way in         |
| `src/lib/quotes/token.ts`                                     | Mint / hash / constant-time compare of the link token               |
| `src/lib/quotes/link-cookie.ts`                               | Where the raw token may and may not appear                          |
| `src/lib/quotes/resolve.ts`                                   | `resolveQuoteForToken` — the authorization for the public page      |
| `src/lib/quotes/totals.ts`, `validity.ts`                     | Line maths; the "is this offer still open?" rule                    |
| `src/lib/admin/quotes.ts`                                     | Staff load / save / withdraw / send                                 |
| `src/lib/email/quote.ts`                                      | The guest email (guest-facing fields only)                          |
| `app/api/v1/quotes/[ref]/open,pay,receipt`                    | Public routes, authenticated by the **link token**                  |
| `app/api/v1/admin/quotes/send`                                | Staff route — the only writer of `quotes.token_hash`                |

Three tables: `quotes` (the draft + the link material), `quote_items` (the lines) and
`booking_custom_items` (the durable home for a priced booking line that has **no** session occurrence).
The last one is deliberately not `booking_items`: that table's NOT NULL occurrence + option are
load-bearing for capacity, the day sheet and the voucher, and relaxing them would force every existing
reader to handle a null occurrence — on the money path.

---

## 1. The lifecycle

`quote_status` is `('draft', 'sent', 'accepted', 'expired', 'cancelled')`.

```
  saveQuote                 POST /admin/quotes/send            POST /quotes/{ref}/pay
     │                              │                                   │
     ▼                              ▼                                   ▼
  ┌───────┐   mints token,      ┌──────┐    api_convert_quote      ┌──────────┐
  │ draft │ ──stores its hash──►│ sent │ ──mints ONE booking, ────►│ accepted │
  └───────┘   emails the guest  └──────┘   sets converted_at       └──────────┘
      │                            │                                   │
      └──────── cancelQuote ───────┴───────────────────────────────────┘
                     ▼
               ┌───────────┐        valid_until < today  →  unopenable, unchargeable
               │ cancelled │                                (see "expired" below)
               └───────────┘
```

**draft** — created by `saveQuote`. It is not payable and not openable: `token_hash` is still null, so
`resolveQuoteForToken` returns null, and `api_convert_quote`'s status whitelist is `('sent',
'accepted')`.

**sent** — `POST /api/v1/admin/quotes/send` is the only thing that can turn a draft into an offer a
guest can act on, because it is the only writer of `token_hash`. It refuses to email an offer nobody
could act on: a lapsed `valid_until`, no lines, a zero or negative total. Sendable statuses are `draft`
and `sent` — a **re-send** is allowed and mints a **fresh** token, which silently kills the previously
emailed link (see §2).

**accepted** — written by `api_convert_quote`, at **pay** time, together with `booking_id` and
`converted_at`. Conversion at pay rather than at send is the reason an unaccepted quote holds no
capacity at all (§4).

**cancelled** — `cancelQuote`, the operator withdrawing the offer. Guarded: it refuses once the guest
has paid ("cancel or refund the booking instead"), and refuses while the converted booking is still
live, because withdrawing the offer would not stop a charge in flight.

**expired** — read this one carefully: **nothing writes this status.** There is no sweep and no cron
that sets it. It exists in the enum, and `api_convert_quote` refuses it if it is ever set by hand, but
expiry in practice is the **date**, `valid_until < current_date`, checked in three places that
deliberately agree:

- `api_convert_quote` → `quote_expired` (the charge is refused);
- `resolveQuoteForToken` → the public page will not open;
- `assertQuoteStillValid` → the editor refuses to save one, and the send route re-checks immediately
  before rendering the email, because a quote drafted Friday and sent Monday passed the first check
  and is dead by the second.

All three compare in **UTC**, matching Postgres's `current_date` on Supabase, so a guard and the charge
it predicts cannot disagree for a few hours a day. The comparison is `<`, not `<=`: an offer valid
_until_ today is payable all day.

Both the "withdrawn" and "lapsed" refusals on the public page stop applying once `converted_at` is set
— after conversion there IS something to show, and that page is the only record a guest with no account
can see.

---

## 2. The link token

The token is a **bearer credential**: whoever holds it can read a named guest's offer and start a
payment for it.

- `mintQuoteToken()` = 32 random bytes as 64 lowercase hex characters.
- Only its **SHA-256** is stored, in `quotes.token_hash`. The raw token exists solely in the emailed
  URL, so a database read — or a leaked backup — cannot mint a working link.
- `quoteTokenMatches` compares in constant time and **fails closed**: a null stored hash is never a
  match, and a token that is not 64 hex characters is rejected before hashing.
- `token_hash` holds exactly **one** hash. A re-send overwrites it, so the link in the earlier email
  stops working. That is also why an already-accepted quote is refused rather than re-sent.

**The emailed link is not the page.** It is `GET /api/v1/quotes/{ref}/open?t=…`, which sets an
httpOnly cookie and 302s to a clean `/quotes/{ref}`. The reason is that two pieces of instrumentation
export a rendered page's URL verbatim: GTM's `page_location` (the container always loads, and denied
consent still sends cookieless pings) and `client-error-report.ts`, which posts
`window.location.href` into `error_logs`. A raw token in a rendered URL would reach both. An `/api/`
route renders no HTML, is outside the middleware matcher and never loads GTM.

**Two cookies, not one, and neither is `Path=/`.** The page (`/quotes/{ref}`) and the pay route
(`/api/v1/quotes/{ref}/pay`) share no URL prefix, and `Path=/` would attach the credential to every
request for every asset on the site. Cookies key on name + domain + **path**, so the two coexist.
`HttpOnly; Secure; SameSite=Lax`, two hours. `Lax` is load-bearing: the guest returns from Peach's
hosted 3-D Secure step as a top-level GET from another site, and `Strict` would withhold the cookie
exactly then. `SameSite=Lax` is also what makes the cookie-authenticated POST safe from a cross-site
form — such a POST simply arrives without the cookie.

**No existence oracle.** `resolveQuoteForToken` collapses _every_ refusal — unknown ref, wrong token,
never-sent draft, withdrawn offer, lapsed validity, a total with no lines behind it — into a single
`null`, and the routes answer all of them with the same **404**. `quotes.ref` is the path segment of a
link that gets forwarded and pasted into chats; a 401-for-wrong-token / 404-for-unknown-ref split would
tell an attacker which refs exist.

**The page read bypasses RLS.** The staff policies are `to authenticated` only, so the guest's read
runs through the service-role client. `resolveQuoteForToken` **is** the authorization — nothing stands
behind it. It selects guest-facing columns only; `internal_notes` and `token_hash` live on the same row
and are never selected. `renderQuoteEmail` takes the same stance.

---

## 3. One booking per quote — and the re-arm branch

Two columns carry this, and a constraint (`quote_converted_shape`) makes writing one without the other
impossible:

- `quotes.booking_id` — **UNIQUE**, the schema-level half of "one quote can never mint two payable
  bookings";
- `quotes.converted_at` — the conversion record a foreign key cannot clear.

**The guard reads `converted_at`, never `booking_id`.** `booking_id` is `on delete set null`, and
bookings _are_ hard-deleted: `api_erase_user` deletes every unpaid booking outright, which silently
reverts `booking_id` to null and would make a converted quote look unconverted. `converted_at` survives
that; the UNIQUE stays as the second line of defence.

`api_convert_quote` takes `select … for update` on the quote row, so two guests clicking Pay at the
same instant serialise here instead of both reading an unconverted quote.

### Why "converts once" means one _payable_ booking at a time

The minted booking is `payment_pending`, and `run_booking_maintenance` expires such a booking 30
minutes after it was created. A guest who converts and then leaves to fetch their card would come back
to a booking `api_create_payment` refuses, attached to a quote that refuses to convert again — payable
by nobody, fixable only by hand-editing production. That is the **cancelled-checkout trap** this repo
already fixed once.

So when `converted_at` is set, the linked booking is inspected inside the same lock, and the quote
**re-arms** only if that booking is:

1. **dead** — status `expired`/`cancelled`/`failed`, booking-level `payment_state` `pending`/`failed`;
2. **never took a cent** — no `payments` row with `paid_minor > 0`, `refunded_minor > 0`, a status of
   `paid`/`partially_refunded`/`refunded`, or a `settlement_review_at` quarantine. (The first and last
   are shapes the booking-level projection cannot see: an underpayment and a wrong-currency
   settlement.)
3. **cannot take one** — no `provider_checkout_id` newer than **30 minutes** and no live
   `checkout_claimed_until`. A dead booking is not a dead checkout: a Peach session stays completable
   ~30 minutes after it was _minted_ while the booking expires 30 minutes after it was _created_, and
   re-arming in that gap would leave two payable sessions for one quote.

The money is read **under the `payments` row locks**, in `append_payment_event`'s own lock order, so a
settlement in flight serialises here rather than being read stale. `bookings` is deliberately not also
locked — `api_create_payment` locks bookings→payments, so adding payments→bookings here would close a
deadlock cycle on the money path.

On a re-arm the dead booking's **active holds are released first**, otherwise one quote reserves two
sets of seats and the guest's own abandoned attempt sells the trip out from under them.

Everything else keeps refusing with `quote_already_converted` — **including** the case where the linked
booking is gone (`booking_id` null after an erasure). Never soften that into "no booking, so mint one".

Every guard raises a snake_case **token**, not a sentence, because `mapDbError` matches tokens on word
boundaries and anything else falls through to a 500 "Database error":
`quote_not_found`, `quote_already_converted`, `quote_cancelled`, `quote_expired`,
`quote_not_convertible`, `quote_total_mismatch`, `quote_seats_unavailable`.

---

## 4. A free-text line holds no capacity; a catalogue line does

This is an owner's decision, recorded so nobody rediscovers it as a bug.

**A `custom` line reserves nothing.** It is free text with its own date/time, it lands in
`booking_custom_items`, and it has no occurrence and no resource model to consume. Quoting "private
catamaran charter, 23 Aug" does **not** stop the website selling that same boat on the 23rd. The
operator sees the clash on the calendar and resolves it by hand. Do not "fix" this by quietly making
custom lines take a hold — capacity is counted in occurrence units, and a free-text line has no
occurrence to count against.

**A `catalogue` line is the opposite.** It names a real occurrence + option, and it takes its seat the
same way every other booking does — `create_hold` plus a `booking_items` row — **inside
`api_convert_quote`'s own transaction**, not in the pay route. That placement is the whole point: a
hold taken from the route is a second transaction, so a departure that sold out in between would leave
a converted quote and a payable booking with no seat behind it. In the function, a refusal takes the
booking, its custom lines and `converted_at` back with it, and the guest sees a refusal instead of a
charge.

Details worth knowing before you touch that loop:

- **Units, not people.** Lines sharing an occurrence are aggregated into **one** hold whose quantity
  equals the sum of their quantities — two `Adult` + `Child` lines on one boat are three seats on one
  trip, not two reservations. `used_capacity()` and `append_payment_event`'s oversell re-check both
  count that way.
- The hold is **attached to the booking**. A detached hold is counted _against_ the guest by
  `append_payment_event`'s oversell re-check — their own reservation blocking their own confirmation.
- A quoted departure **can sell out** before the guest accepts, because nothing is reserved at draft or
  send time. `create_hold`'s refusal is re-raised as `quote_seats_unavailable` → a 409 that says the
  date is gone, please message us — deliberately not the cart's "pick another date", which a quote
  guest cannot do.
- Two catalogue shapes **fail closed** with `quote_not_convertible`: a **private or vehicle** option
  (its pool counts trips, not heads, so a six-guest line is one unit and a `pax`, not six) and a line
  whose option is not its occurrence's own. Both are the next thing to teach the conversion if the
  editor ever offers them — deliberately, with a test.
- `create_booking`'s per-booking **guests-per-trip cap is deliberately not reused**: the operator chose
  the departure and the party size, and the pool is still enforced by `create_hold`, so no other guest
  can be oversold. Revisit the day quotes are drafted by anyone but staff.

**The price is checked twice, on two different axes.** The pay route re-prices catalogue lines against
the live price list and refuses (409) before anything is minted, so a catalogue change between drafting
and paying can never silently charge a different figure. Independently, `api_convert_quote` re-derives
`sum(quote_items.subtotal_minor)` and refuses `quote_total_mismatch` unless it equals
`quotes.total_minor` — the charge and the itemisation must agree, or nothing is minted. `currency` is
CHECKed to EUR in the schema for the same reason: the ledger pins `payments.currency = 'EUR'`, so a
quote stored as MUR would be shown and emailed as MUR and then charged in EUR.

---

## 5. How a paid quote booking gets an owner

The bookings policy is `using (user_id = auth.uid() or is_staff())`, and `null = auth.uid()` evaluates
to NULL, not true. A quote booking is the first ownerless booking in this schema, so left alone it
would be invisible to **every** customer forever — including the guest who paid, whose confirmation
email links to `/bookings/{ref}`.

**At conversion**, `api_convert_quote` sets `user_id` from `quote_owner_for_email(customer_email)`,
which answers with **the single confirmed account** holding that address, or null:

- case-insensitive and trimmed, through `quote_email_key`, applied to **both** operands — the operator
  types the address by hand, and normalising one side only would leave the later claim path unable to
  see a booking conversion had already matched;
- **confirmed accounts only** (`email_confirmed_at is not null`) — the whole difference between an
  address someone _typed_ and one they have demonstrably received mail at. Without it, signing up with
  a stranger's address would be a way to be handed their booking;
- **exactly one match, or none.** `auth.users` does not constrain `email` to be unique, and picking
  "the oldest" of two confirmed accounts would be a coin toss on a money record.

**Null is a supported state, not a failure.** Most quote guests never open an account. Nothing
downstream needs an owner: `api_create_quote_payment` exists precisely because a quote booking has
none, and the guest's own record stays reachable through the link token — the public quote page shows
the booking's status, and `GET /api/v1/quotes/{ref}/receipt` serves the invoice/receipt PDF on the same
cookie, because every other customer PDF route opens with a bearer token and an RLS read an ownerless
booking can never satisfy.

**If they sign up later**, `api_claim_quote_bookings` fills the column in. `AuthProvider` calls it once
per sign-in, right after the profile row is ensured. Four properties, each of which is a hole if
dropped:

1. it matches **the claimer's own address**, read from `auth.users` by `auth.uid()` — never anything in
   the payload (the jsonb argument exists only because every `api_*` RPC takes one, and nothing in it
   is read);
2. **confirmed only, through the same `quote_owner_for_email`** — one copy of the rule, so conversion
   and claim cannot drift;
3. **null → a user only, never user A → user B.** `b.user_id is null` is in the WHERE, so an
   already-owned booking is untouchable;
4. **`source = 'quote'` only**, so this can never grow into "claim any booking carrying my address".

It is idempotent by construction — the second run finds no null-owner rows — which is what makes it
safe on every sign-in. SECURITY DEFINER is load-bearing twice: `authenticated` has no EXECUTE on
`quote_owner_for_email`, and `enforce_booking_admin_update` pins `new.user_id := old.user_id` for any
anon/authenticated write, so the same UPDATE through PostgREST would be silently reverted.

**Known and accepted by the owner:** a mistyped address that belongs to a real confirmed account
attaches that booking to the wrong person, exposing name, phone, pickup address and amount. The same
typo already emailed them the offer itself, so the first disclosure happens either way — which is
exactly why this must never widen beyond a confirmed, exact (case-insensitive) address.

---

## 6. Landmines

- **Never guard conversion on `booking_id`.** Use `converted_at`. An erasure nulls the first one.
- **Never put the raw token in a rendered URL.** GTM and the client-error reporter both export it.
- **Never answer a bad token differently from an unknown ref.** One 404 for everything.
- **`expired` status is written by nobody** — don't go looking for the sweep. The date is the rule.
- **A custom line holds nothing.** Deliberate. A catalogue line holds its seat inside the conversion
  transaction, never in the route.
- **A new `api_*` function must be revoked from `public, anon, authenticated`** — not just `public`.
  Supabase's default privileges grant EXECUTE to anon and authenticated _explicitly_, and
  `create or replace` never resets an existing ACL. That one-word omission has shipped a live leak from
  this repo twice, and `tests/integration/definer-grants-lockdown.test.ts` is what catches it.

## 7. Not built yet

- **Part 2 — rentals.** `kind = 'rental'` and `rental_vehicle_slug` exist so Part 2 needs no migration,
  but no rental pricing or UI ships here. Open: is the deposit charged online, and does the same
  vehicle get quoted twice on overlapping dates (`rental_vehicles` has no fleet count)?
- **Part 3 — calendar union.** `booking_custom_items.starts_at` is already indexed so surfacing
  date-bearing custom lines on the day sheet is a read change, not a migration.
- **Part 4 — AI drafting.** Parked. The guardrail is decided: AI drafts lines, it never sets a price.
