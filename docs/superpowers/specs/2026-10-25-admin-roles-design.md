# Admin roles & permissions — design

Date: 2026-10-25. Owner decisions recorded here were given in the session that produced this file.

**Status: built** (migration `20261025140000_admin_roles.sql`). This document describes the system as
it was built, after review: where the first design changed, the text below says what shipped. The
owner's runbook is `docs/handbook/operations.md` ("Giving someone access"); the database rules are in
`docs/handbook/database.md` ("Roles"); the traps are in `docs/handbook/landmines.md`.

## Goal

The people who work with the owner use `/admin` every day (quotes, bookings, the calendar) and today
they see everything the owner sees: revenue, the P&L and VAT report, fares, the exchange rate, refunds.
Give the owner a **Roles** module in `/admin` where they create roles, choose which admin sections and
which money features each role gets, and put team members into those roles.

## Owner decisions

| Question                 | Answer                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| How fine-grained         | Sections (open / not) plus separate money switches — no per-section view/edit levels         |
| How people join the team | Owner types the email of an account that has signed up on the site, picks a role; no invites |
| Who manages roles        | Owner only                                                                                   |
| Approach                 | Roles are permission bundles layered on today's `user_role` access floor (not a rewrite)     |

## Facts established before design

- **There is no worker tier today.** Prod has 4 `admin` profiles, 0 `staff`, 1 `seo` (2026-10-25).
  `is_staff()` is `role in ('staff','admin')` and every admin screen checks
  `role === 'admin' || role === 'staff'`, so `staff` and `admin` are identical everywhere.
- **Staff can promote themselves.** `enforce_profile_role()` lets any `is_staff()` caller change any
  profile's `role`, and the `profiles_staff` policy is `for all using (is_staff())` — so a `staff`
  account can set its own role to `admin`, or delete the owner's profile row (on next sign-in
  `AuthProvider` would re-create it as `customer`). Not exploitable today only because nobody is
  `staff`.
- **Admin screens read the database from the browser** with the user's own JWT. Hiding a screen does
  not stop a technical user querying the tables behind it. The Reports page and the dashboard revenue
  card are computed client-side (`loadReport`, `loadDashboard`) from `bookings` rows that anyone working
  bookings can already read.
- **Roles are granted by hand-run SQL today** (`update profiles set role = …`, documented in
  `docs/handbook/database.md`, `operations.md`, `services.md`, `docs/db-prod-test-split.md`).
- **`profiles` has no email column.** Finding an account by email needs `auth.users`.
- **Saving a tour rewrites its prices every time.** `replacePrices()` in `src/lib/admin/activity-write.ts`
  inserts fresh `activity_option_prices` rows and deletes the old ones on every save, and
  `reconcileSupplements()` rewrites `activity_supplements`, whether or not a price changed.
- **Server routes copy-paste the role check.** Five admin routes each carry their own `callerRole()`
  reading `profiles.role` through the service-role client (assistant, installment remind, quotes send /
  balance / draft-from-email). The documents email/pdf routes have no role check: they read as the
  caller and rely on `documents` being `is_staff()`-only in RLS.
- **The admin AI assistant only looks up one booking or quote by ref** — no aggregate revenue tool.

## Behaviour

### Admin → Roles (`/admin/roles`, owner only)

**Roles tab**

- List of roles with member counts. **New role**: name, optional description, **base access**.
- **Base access** is chosen when the role is created and cannot be changed afterwards:
  - **Team** — may work with guest data (bookings, quotes, leads…). Members get `profiles.role = 'staff'`.
  - **Content only** — never sees guest data. Members get `profiles.role = 'seo'`. Only the content
    sections can be ticked; the rest are shown greyed out and disabled, under the note "Content-only
    roles can’t open guest data or money, so those boxes are off."
- Each role is a set of ticked boxes from the permission catalogue below: **Sections** and **Money**.
- Rename, edit boxes, delete. Delete is refused while the role has members.

**Team tab**

- Everyone in the back office: name, email, role. The owner's own rows are labelled Owner.
- **Add member**: email + role. The email must name exactly **one confirmed** account (it signed up on
  the site and clicked the confirmation link). Otherwise the screen says "No account with that email.
  Ask them to sign up on the website first…", "That account hasn’t confirmed its email yet…", or "More
  than one account uses that email, so it can’t be added by email…".
- **Change role** (including to Owner) is an explicit act: the role box only _chooses_; nothing is saved
  until the **Change** button is clicked, and the row says "Not saved — click Change" meanwhile.
  Making someone an Owner, taking Owner access away, and removing anyone (yourself included) each ask
  the Owner to confirm first. **Remove** turns the account back into an ordinary `customer`.

**Owner**

- Built-in, not a row in the roles table: `profiles.role = 'admin'`. Has every permission, can open
  Roles, cannot be edited.
- **At least one Owner always remains.** Demoting, removing or deleting the last Owner — including
  yourself, and including deleting their `auth.users` row — is refused by the database.

**What a member sees**

- The sidebar and the mobile bottom bar show only the sections their role allows (the bottom bar is
  topped up from their other sections when they may open fewer than four of the usual ones).
- Opening a section's URL directly shows a "No access" panel ("Your role doesn’t include this section. Ask the owner if you need it.") instead of the screen.
- **The Dashboard is open to every back-office member**, and each part of it is shown only to a role
  that can use it: the revenue and pending-payment **euro** cards and the revenue chart need
  `money.revenue` (without it, a role with Bookings sees the pending card as a count of open payments);
  the booking panels (Recent bookings, Needs attention, and the cards that link into Bookings) need
  Bookings; today's departures need Bookings **or** Calendar. A role with none of these sees a bare
  greeting and makes no bookings query.
- **Tours:** without `money.prices` the editor hides the **Pricing & options** pane and the supplements
  block (French labels included), never sends a price column or `pricing_mode`, and a tour **created**
  by such a role starts as a draft that cannot be published until it has a live option. The same holds
  for the content-only role.
- **Rental:** without `money.prices` the rates are read-only, "Add a vehicle" is hidden and saves omit
  the rate fields. **Pricing:** fares show with `money.prices`, the charge-currency card with
  `money.currency`. **Places:** the screen needs `section.places`.
- **Fail closed:** a `staff` or `seo` account with no team role sees only the bare Dashboard.

## Permission catalogue

The catalogue is fixed in code (`src/lib/admin/permissions.ts`) and mirrored by a SQL `check` on
`team_roles.permissions`. A test asserts the two lists are identical. Adding a section later needs a
migration that widens the check.

### Sections

| Key                  | Opens                                | Content-only roles may tick |
| -------------------- | ------------------------------------ | --------------------------- |
| `section.bookings`   | Bookings                             | no                          |
| `section.calendar`   | Calendar                             | no                          |
| `section.quotes`     | Quotes                               | no                          |
| `section.documents`  | Documents                            | no                          |
| `section.leads`      | Leads                                | no                          |
| `section.reviews`    | Reviews                              | no                          |
| `section.assistant`  | Admin AI assistant panel             | no                          |
| `section.tours`      | Tours (descriptions, photos, French) | yes                         |
| `section.categories` | Categories                           | no                          |
| `section.content`    | Standard content                     | no                          |
| `section.rental`     | Rental                               | no                          |
| `section.places`     | Places                               | yes                         |
| `section.seo`        | SEO                                  | yes                         |
| `section.blog`       | Blog                                 | yes                         |
| `section.redirects`  | Redirects                            | yes                         |

The content-allowed set is exactly today's `seo: true` nav items, so the existing SEO account keeps
what it has.

### Money

Content-only roles cannot hold any money switch.

| Key              | Covers                                                                                                                                                                    | Enforced in           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `money.reports`  | Reports page (P&L, VAT, per-tour/source), its CSV, and the Bookings CSV export                                                                                            | Screen only           |
| `money.revenue`  | Dashboard revenue card, revenue chart and the pending-payments euro total                                                                                                 | Screen only           |
| `money.prices`   | Tour price tiers, private-option prices, supplements, transfer/sightseeing/planner fares, return discounts, hotel zone/region assignments, rental rates; the Pricing page | **Database** + screen |
| `money.currency` | Charge currency (MUR/EUR) and the EUR→MUR rate card                                                                                                                       | **Database** + screen |
| `money.refunds`  | "Mark refunded" on a booking and recording a change-of-tour refund                                                                                                        | **Database** + screen |
| `money.notes`    | Internal (margin) notes on quotes and documents                                                                                                                           | Screen only           |

Per-booking and per-quote amounts stay visible to whoever has Bookings / Quotes / Documents: the job
needs them. Writing prices **on a quote or document** is part of those sections, not `money.prices`,
which covers the catalogue only.

### Where each kind of permission is enforced

| Kind                                                            | Enforcement                                                                            | Limit, stated plainly                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Sections                                                        | Nav filter, the "No access" page guard, and the ten staff API routes (see App changes) | Not RLS: the browser reads tables directly, so a technical member could still query a hidden section's data |
| `money.reports` / `revenue` / `notes`                           | Screen only                                                                            | Totals are sums of rows the member can already read                                                         |
| `money.prices` / `currency` / `refunds`                         | RLS, triggers and RPC checks                                                           | None: refused even outside the UI                                                                           |
| Which fare applies (`pickup_available`, `region`, `lat`, `lng`) | Not locked: logistics and map data                                                     | Accepted residual: a worker can change which fare applies, never the fare (see below)                       |
| Assigning roles                                                 | Database, owner only                                                                   | None                                                                                                        |
| A booking's deposit, balance and add-on amounts                 | Trigger, for every browser session (the Owner's too)                                   | None: only the booking RPCs write them                                                                      |

Locking every section in RLS (≈150 `is_staff()` references, including money-path functions) was
rejected for now; it can be done later one section at a time.

**Accepted residuals** (owner decisions; each is deliberate, none is a bug to fix without asking):

- `activities.pickup_available`, `region`, `lat` and `lng` feed the transport add-on
  (`transport_fare_minor`) but stay editable by team and content roles — they are logistics and map
  data. A worker without `money.prices` can change **which** fare applies to a tour, never the fare
  itself.
- Deleting an unbooked, unquoted option (its price tiers cascade away) and deleting a rental vehicle
  stay with the owning section.
- A downgrade change-of-tour can still create a refund obligation without `money.refunds`; only
  **recording** the refund needs the permission.
- A worker can re-open pickup on a booking (`pickup_pending` / `pickup_location`), which leads to a
  late-pickup charge offer.
- Pre-existing, not caused by roles — follow-ups: the content-only role currently **cannot save tours
  at all** (the editor reads `operators`, whose policy is `is_staff()`-only, so the save stops at
  "operator not found"), and the WhatsApp number card shows to content accounts although their save
  does nothing.

## Data model

```sql
create table team_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  base        text not null check (base in ('team', 'content')),
  -- permission_catalogue() is a SQL function returning every key of the catalogue above
  permissions text[] not null default '{}' check (permissions <@ permission_catalogue()),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles (id) on delete set null
);
create unique index team_roles_name_key on team_roles (lower(btrim(name)));
alter table profiles add column team_role_id uuid references team_roles (id) on delete restrict;
```

- Role names are unique case-insensitively (the index above, not a column constraint).
- `permission_catalogue()` and `content_permission_catalogue()` are the SQL side of `permissions.ts`.
  Only ever **add** keys: removing one leaves stored rows that violate the CHECK, so strip it from
  `team_roles` in the same migration first.

- A trigger on `team_roles` rejects a `content` role holding any key outside the content-allowed set,
  and rejects any change to `base` after insert.
- `on delete restrict` is what makes "delete is refused while the role has members" hold.
- Pairing rule, enforced by the profiles trigger: `team_role_id` is non-null only when `role` is
  `staff` (base `team`) or `seo` (base `content`), and the base matches; `admin` and `customer` always
  have `team_role_id = null`.

## Database rules

**Functions** (all `stable security definer set search_path = public`, mirroring `is_staff()`):

- `is_admin()` — `role = 'admin'`.
- `has_permission(key text)` — requires a **catalogue key** (an unknown or null key is false for
  everyone, the Owner included, so a typo in a later policy is caught by tests rather than granting);
  then true for `admin`, or when the caller's team role holds the key **and its base matches the
  caller's `profiles.role`** (staff ↔ team, seo ↔ content); false when there is no profile or no team
  role. Used in policies as `(select has_permission('…'))` so it is evaluated once per statement.

**Profiles guard** — rewrite `enforce_profile_role()` (find the winning body first; see
`docs/handbook/database.md`). It binds **every** writer unless stated:

- `profiles.id` is immutable (`profile_id_immutable`): re-keying a row would carry a staff member's
  role onto another account.
- `role` and `team_role_id` may be changed from a client only by the Owner. A non-Owner's insert is
  forced to `customer` / `null`; a non-Owner's update keeps the old values. Service role, the table
  owner and the definer RPCs pass this clause only — which is why a definer function that writes these
  columns must check `is_admin()` itself.
- The pairing rule above holds on every write, whoever writes (`team_role_mismatch`).
- **The last Owner** cannot be demoted (`last_owner`) — by the Owner or anyone else — nor deleted: not
  by a profile delete, not by `api_erase_user`, not by deleting their `auth.users` row. Demotions and
  deletions take one advisory lock so two Owners cannot demote each other at once.
- `profiles_staff` (`for all using (is_staff())`) is **dropped**. Staff keep reads (`profiles_select`)
  and a narrowed update (`profiles_update`: they cannot touch an Owner's row). Client deletes are
  Owner-only (`profiles_owner_delete`).
- Staff cannot **erase** a non-customer profile either: `api_erase_user` is `SECURITY DEFINER` and
  bypasses RLS, so a delete trigger re-checks the caller. Staff may still erase customers (GDPR) or
  themselves; erasing a team member or an Owner needs an Owner.

**RPCs** (each takes `p jsonb`; each name added to `ALLOWED` in `tests/db/rpc.ts`; grants revoked from
`public, anon` and granted to `authenticated` only, verified with `has_table_privilege` /
`has_function_privilege`):

| RPC               | Who                | Does                                                                                                                      |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `api_my_access`   | any signed-in user | Returns `{ role, teamRoleId, teamRoleName, base, permissions[] }` for the caller (`permissions` = every key for an Owner) |
| `api_team_list`   | owner              | Every non-customer profile with email (from `auth.users`), role and team role                                             |
| `api_team_assign` | owner              | `{ userId \| email, teamRoleId \| 'owner' }` → sets `role` + `team_role_id` together (see below)                          |
| `api_team_remove` | owner              | `{ userId }` → `customer` / `null`                                                                                        |

`api_team_assign` names the account by `userId` **or** `email` (`userId` wins when both are sent). By
email it requires exactly **one confirmed** account, matched case- and space-insensitively
(`quote_email_key`): none → `not_found`, several → `ambiguous_email`, unconfirmed → `not_confirmed`.
`auth.users.email` is not unique and anyone can register a stranger's address without confirming it,
so picking "the oldest" account would be a coin toss over who becomes an Owner. A `userId` was chosen
from the team screen, so it is not held to the confirmed rule. `api_team_assign` and `api_team_remove`
refuse (`last_owner`) when the change would leave zero `admin` profiles. Role CRUD is plain table access: `team_roles` RLS = `select` for `is_admin()` or the
caller's own role, `insert/update/delete` for `is_admin()`. Explicit grants on `team_roles` (revoke all
from `anon`; `authenticated` gets select/insert/update/delete, RLS narrows it).

**Money locks**

- **Price-only tables** — the staff write policy becomes `is_staff() and (select has_permission('money.prices'))`;
  reads are unchanged: `activity_option_prices`, `activity_supplements`, `sightseeing_pricing`,
  `planner_pricing`, `transport_band_pricing`, `airport_transfer_fare`, `hotel_transfer_fare`,
  `airport_transfer_config`, `hotel_transfer_config`, `region_zone_distance` — and
  `airport_transfer_hotels`, which is not a fare but a price **input** (its `zone` picks the airport
  fare and its `region` the hotel-to-hotel band, so editing a row re-prices every transfer to that
  hotel).
- **Mixed tables** — an `enforce_money_columns(permission, columns…)` trigger raises `forbidden` when a
  client caller without the permission **changes** a guarded column (the new value differs from the
  old; on insert, a value that is not null and not `'0'`). Unchanged re-saves pass, and the Owner, the
  definer functions and service role are never touched.
  - Insert **and** update, → `money.prices`: `activity_options.private_base_minor`, `private_included`,
    `private_extra_minor`; `activities.supplement_minor` (legacy, frozen);
    `rental_vehicles.daily_rate_minor`, `deposit_minor`.
  - **Update only**, → `money.prices` (a new tour legitimately sets them on insert, and their defaults
    are not null/`'0'`): `activities.pricing_mode`, `is_airport_transfer`, `is_hotel_transfer`, and
    `activity_options.activity_id` (moving an option to another activity re-prices it).
  - `business_settings.charge_currency`, `eur_mur_rate`, `eur_mur_rate_updated_at` →
    `money.currency` (the WhatsApp number on the same row stays editable).
- **Refunds** — `api_mark_refunded` and `api_record_change_refund` raise `forbidden` without
  `money.refunds`. Re-defined from the winning bodies, adding only the check.
- **Booking money columns** (§6b of the migration) — `enforce_booking_admin_update` also pins
  `deposit_minor`, `balance_due_minor`, `transport_minor`, `supplement_minor`, `supplement_qty` and
  `child_seats` against any browser session, the Owner's included. `deposit_minor` is the dangerous
  one: a value between 0 and the total makes `api_mark_refunded` treat the paid row as a
  non-refundable deposit, so `money.refunds` would guard the front door while this stood open. The
  browser only ever writes `status` and `notes` on bookings, so nothing legitimate loses a write.

**Backfill** — the migration creates a "Content" role (base `content`, the five content sections) and
points every existing `seo` profile at it — but only at a **content-base** role named Content, so a
hand-made team-base "Content" role makes the update a no-op instead of aborting the whole migration
with `team_role_mismatch`. Existing `staff` profiles (none in prod) are left with no team role and fail
closed.

## App changes

- **`src/lib/admin/permissions.ts`** — the catalogue as data: key, label, hint, content-allowed flag,
  plus `buildAccess` (fails closed, never throws on a malformed jsonb) and `can(access, key | keys)`.
  No React/Next imports.
- **Access in the browser** — loaded by `AdminAccessProvider` inside the admin layout (not by
  `AuthProvider`, so customers browsing the site never make the call); `useAdminAccess()` exposes
  `isOwner` and `permissions`, and `can(access, key)` answers. The provider:
  - is per user — a previous user's access is never shown to the next one;
  - seeds the Owner from the profile so an Owner never waits on a loading screen (the call still runs,
    to catch a demotion);
  - retries a failed `api_my_access` once, reports it, and then shows a visible "We couldn’t load your
    permissions." panel with a retry instead of a misleading "No access"; the fallback is the profile's
    role alone (Owner keeps working, everyone else gets nothing);
  - re-reads access when a tab becomes visible again, so a role change reaches an open tab.

  The component-level `role === 'admin' || role === 'staff'` checks inside individual screens stay as
  a floor; the `AdminShell` page guard is the section gate.

- **Navigation** — `NavItem.seo?: boolean` becomes
  `permission: PermissionKey | PermissionKey[] | 'owner' | null` (`null` = every back-office member:
  Dashboard; a list = any of them). Reports → `money.reports`; Pricing → `money.prices` or
  `money.currency`; Roles → `'owner'`. `navForRole` becomes `navFor(access)`, and `bottomNavFor(access)`
  picks the mobile bar's four slots from what the person may open.
- **Page guard** — `AdminShell` resolves the current path to its nav item (`pageAllowedFor`) and renders
  the "No access" panel when it fails, so every admin page is covered in one place. A path no nav item
  owns is Owner-only (fail closed).
- **Money inside screens**
  - Dashboard: open to every member; revenue card, pending-payments euros and `RevenueChart` behind
    `money.revenue` (the pending card falls back to a count with Bookings); booking panels behind
    Bookings; departures behind Bookings or Calendar.
  - Bookings: CSV export behind `money.reports`; "Mark refunded" behind `money.refunds`; the
    change-of-tour refund step behind `money.refunds`.
  - Quotes / Documents: internal-notes field hidden without `money.notes`.
  - Tours: the **Pricing & options** pane is hidden (same mechanism as the content role), as are the
    supplements and their French labels. **The save path skips the option / price / supplement
    reconcile entirely** when the user lacks `money.prices` and never sends a price column or
    `pricing_mode` (otherwise every description edit would hit the DB lock). A tour created by such a
    role is saved as a **draft** and cannot be published until it has a live option — the same applies to
    the content role.
  - Pricing page: fare editors need `money.prices`; `PaymentCurrencyCard` needs `money.currency`.
  - Rental: rates read-only and "Add a vehicle" hidden without `money.prices`; saves omit the rate fields.
  - Places: the screen is gated on `section.places`.
- **Server routes** — one helper, `loadCallerAccess(db, userId)` in `src/lib/http/access.ts`, reads
  `profiles` + `team_roles` through the service-role client and replaces the five `callerRole()` copies
  (and three more hand-written `profiles.role` checks in the SEO and reviews routes). Never
  `requireUser().role` (that is the JWT role). Ten routes check their section **before** reading the
  body or the database, and a refusal names the section ("Your role doesn't include Quotes — ask the
  owner."):

  | Route                                                      | Section                                                    |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `admin/assistant`                                          | `section.assistant`                                        |
  | `admin/bookings/{ref}/installments/{seq}/remind`           | `section.bookings`                                         |
  | `admin/quotes/send`, `/{ref}/balance`, `/draft-from-email` | `section.quotes`                                           |
  | `admin/documents/{id}/pdf`, `/email`                       | `section.documents` (new: an explicit check on top of RLS) |
  | `seo/ai-fix`, `seo/search-console`                         | `section.seo`                                              |
  | `reviews/google-live`                                      | `section.reviews`                                          |

  The assistant's booking and quote lookups additionally need Bookings / Quotes (without them a lookup
  answers "not found"). A content-only member is refused by every route except the SEO ones, as `seo`
  was before. `tests/unit/admin-route-gates.test.ts` pins each route's gate and its position, and fails
  when a route that calls `loadCallerAccess` is missing from its list.

- **Roles UI** — `app/(site)/admin/roles/page.tsx` (`runtime = 'edge'`) + `src/components/admin/AdminRoles.tsx`,
  following the existing admin screens' look. Role changes are an explicit **Change** click, and
  making or unmaking an Owner, and removing anyone, ask for confirmation.

## Rollout

1. One push ships the migration (with the profiles guard) and the code. No account changes role, so
   nothing changes for anyone on deploy day except the SEO account, whose access stays the same.
2. The owner builds roles in `/admin/roles`.
3. The owner confirms which of the 4 `admin` accounts are theirs; the others are moved into roles from
   the Team tab.
4. The owner decides whether the leftover `seo` account (contractor let go 2026-09-29) stays as Content
   or is removed.

The first Owner of a fresh database is still made by SQL (`update profiles set role = 'admin' …`); the
handbook pages that describe granting roles by SQL are updated to point at `/admin/roles` for
everything after that, in the same commit.

## Testing

Integration (PGlite, `tests/integration/admin-roles.test.ts` and neighbours):

- The SQL catalogue equals `permissions.ts`. `has_permission` for the Owner, a team member with and
  without a key, a content member, a team role whose base does not match, an unknown or null key,
  staff with no team role, signed-out.
- Profiles guard: staff cannot change their own or anyone's `role` / `team_role_id` (including through a
  PostgREST-style upsert), cannot re-key or swap profiles, cannot delete a profile or edit the Owner's;
  a mismatched role/base pair is refused; the last Owner cannot be demoted or deleted, even by themselves.
- `api_erase_user`: staff cannot erase a co-Owner or a team member, can still erase a customer, a member
  can erase themselves, an Owner can erase a team member but never the last Owner.
- `api_team_assign` / `api_team_remove`: Owner only; by `userId` or `email` (`userId` wins); `not_found`,
  `not_confirmed` and `ambiguous_email`; `last_owner` refusal, including self-demotion.
- `team_roles`: content role cannot hold a guest section or money key; `base` cannot change; delete
  refused while members exist; non-admin cannot write; anonymous callers hold no privilege.
- Money locks: price-only table writes (all 11) refused without `money.prices` and allowed with it;
  mixed-table triggers pass an unchanged re-save and refuse a changed price, and a worker can still
  create a new tour and option; `business_settings` WhatsApp edit passes without `money.currency`, rate
  edit refused; both refund RPCs refused without `money.refunds`; a booking's deposit, balance and
  add-on amounts cannot be rewritten from a browser session.
- The Content backfill is idempotent and skips a mis-based "Content" role.
- Grants: `anon` has no privilege on `team_roles`; the new RPCs are not executable by `anon`
  (`rpc-grants.test.ts` / `definer-grants-lockdown.test.ts`). `resolved-function-bodies.test.ts` pins the
  re-declared refund RPCs and the booking guard. `admin-section-gates.test.ts` runs each gated route
  as a member with and without its section.

Unit:

- Every `ADMIN_NAV` entry points at a real route and carries a permission; the content-allowed set
  equals the old `seo: true` set; `pageAllowedFor` / `navFor` / `bottomNavFor` per role
  (`admin-permissions.test.ts`); the access provider's per-user state (`admin-access-state.test.ts`);
  the Dashboard's per-role cards (`admin-dashboard.test.ts`).
- `admin-route-gates.test.ts`: each of the ten routes checks its section once, first, through
  `loadCallerAccess`; any route under `app/api/v1` that calls it must be on the list.
- (Integration, `admin-activity-edit.test.ts`) the tour save path makes no `activity_option_prices` /
  `activity_supplements` writes without `money.prices`.

## Out of scope

- RLS enforcement of sections (reads of bookings, leads, quotes… stay `is_staff()`).
- Per-section view/edit levels.
- Invitation emails for people without an account.
- An audit log of role changes (beyond `team_roles.updated_by`).

## Landmines this touches

- Re-defining `enforce_profile_role`, `enforce_booking_admin_update`, `api_mark_refunded`,
  `api_record_change_refund` and the price tables' policies: start from the **winning** (last in filename order) body, mirror to the end of
  `supabase/catch-up.sql`, add a `backfill-migration-ledger.sql` row.
- New table grants: `anon` gets DELETE by default — revoke explicitly and check with
  `has_table_privilege()`.
- Hand-edit `src/lib/supabase/types.ts` for `team_roles`, `profiles.team_role_id` and the new RPCs.
- New admin UI strings passed to `t(...)` need `messages.ts` rows; run `node scripts/i18n-scan.mjs`.
