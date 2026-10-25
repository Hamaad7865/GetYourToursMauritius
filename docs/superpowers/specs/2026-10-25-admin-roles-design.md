# Admin roles & permissions — design

Date: 2026-10-25. Owner decisions recorded here were given in the session that produced this file.

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
    sections can be ticked; the rest are shown greyed out with "Content-only roles can't open guest
    data".
- Each role is a set of ticked boxes from the permission catalogue below: **Sections** and **Money**.
- Rename, edit boxes, delete. Delete is refused while the role has members.

**Team tab**

- Everyone in the back office: name, email, role. The owner's own rows are labelled Owner.
- **Add member**: email + role. The email must belong to an account that has signed up on the site;
  otherwise "No account with that email — ask them to sign up first".
- **Change role** (including to Owner) and **Remove** (back to an ordinary `customer` account).

**Owner**

- Built-in, not a row in the roles table: `profiles.role = 'admin'`. Has every permission, can open
  Roles, cannot be edited.
- **At least one Owner always remains.** Demoting or removing the last Owner — including yourself — is
  refused by the database.

**What a member sees**

- The sidebar and the mobile bottom bar show only the sections their role allows.
- Opening a section's URL directly shows a "No access — ask the owner" panel instead of the screen.
- The Dashboard is open to everyone in the back office; its revenue card and revenue chart appear only
  with the Revenue switch.
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

| Key              | Covers                                                                                                                                     | Enforced in           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `money.reports`  | Reports page (P&L, VAT, per-tour/source), its CSV, and the Bookings CSV export                                                             | Screen only           |
| `money.revenue`  | Dashboard revenue card and revenue chart                                                                                                   | Screen only           |
| `money.prices`   | Tour price tiers, private-option prices, supplements, transfer/sightseeing/planner fares, return discounts, rental rates; the Pricing page | **Database** + screen |
| `money.currency` | Charge currency (MUR/EUR) and the EUR→MUR rate card                                                                                        | **Database** + screen |
| `money.refunds`  | "Mark refunded" on a booking and recording a change-of-tour refund                                                                         | **Database** + screen |
| `money.notes`    | Internal (margin) notes on quotes and documents                                                                                            | Screen only           |

Per-booking and per-quote amounts stay visible to whoever has Bookings / Quotes / Documents: the job
needs them. Writing prices **on a quote or document** is part of those sections, not `money.prices`,
which covers the catalogue only.

### Where each kind of permission is enforced

| Kind                                    | Enforcement                                                              | Limit, stated plainly                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Sections                                | Nav filter, the "No access" page guard, and the `/api/v1/admin/*` routes | Not RLS: the browser reads tables directly, so a technical member could still query a hidden section's data |
| `money.reports` / `revenue` / `notes`   | Screen only                                                              | Totals are sums of rows the member can already read                                                         |
| `money.prices` / `currency` / `refunds` | RLS, triggers and RPC checks                                             | None: refused even outside the UI                                                                           |
| Assigning roles                         | Database, owner only                                                     | None                                                                                                        |

Locking every section in RLS (≈150 `is_staff()` references, including money-path functions) was
rejected for now; it can be done later one section at a time.

## Data model

```sql
create table team_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  base        text not null check (base in ('team', 'content')),
  -- the array literal lists every key of the permission catalogue above
  permissions text[] not null default '{}' check (permissions <@ array['section.bookings', …]::text[]),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles (id) on delete set null
);
alter table profiles add column team_role_id uuid references team_roles (id) on delete restrict;
```

- A trigger on `team_roles` rejects a `content` role holding any key outside the content-allowed set,
  and rejects any change to `base` after insert.
- `on delete restrict` is what makes "delete is refused while the role has members" hold.
- Pairing rule, enforced by the profiles trigger: `team_role_id` is non-null only when `role` is
  `staff` (base `team`) or `seo` (base `content`), and the base matches; `admin` and `customer` always
  have `team_role_id = null`.

## Database rules

**Functions** (all `stable security definer set search_path = public`, mirroring `is_staff()`):

- `is_admin()` — `role = 'admin'`.
- `has_permission(key text)` — true for `admin`; otherwise `key = any(permissions)` of the caller's
  team role; false when there is no profile or no team role. Used in policies as
  `(select has_permission('…'))` so it is evaluated once per statement.

**Profiles guard** — rewrite `enforce_profile_role()` (find the winning body first; see
`docs/handbook/database.md`):

- `role` and `team_role_id` may change only when `is_admin()` (or service role / owner).
  A non-admin's insert is forced to `customer` / `null`; a non-admin's update keeps the old values.
- Enforce the pairing rule above on every write.
- Narrow the staff branches of `profiles_update` and `profiles_staff` (`for all`): `delete` requires
  `is_admin()`, and a non-admin cannot update a profile whose `role = 'admin'`.

**RPCs** (each takes `p jsonb`; each name added to `ALLOWED` in `tests/db/rpc.ts`; grants revoked from
`public, anon` and granted to `authenticated` only, verified with `has_table_privilege` /
`has_function_privilege`):

| RPC               | Who                | Does                                                                                                                |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `api_my_access`   | any signed-in user | Returns `{ role, teamRoleId, teamRoleName, permissions[] }` for the caller (`permissions` = every key for an Owner) |
| `api_team_list`   | owner              | Every non-customer profile with email (from `auth.users`), role and team role                                       |
| `api_team_assign` | owner              | `{ email, teamRoleId \| 'owner' }` → sets `role` + `team_role_id` together; `not_found` when no account             |
| `api_team_remove` | owner              | `{ userId }` → `customer` / `null`                                                                                  |

`api_team_assign` and `api_team_remove` refuse (`last_owner`) when the change would leave zero
`admin` profiles. Role CRUD is plain table access: `team_roles` RLS = `select` for `is_admin()` or the
caller's own role, `insert/update/delete` for `is_admin()`. Explicit grants on `team_roles` (revoke all
from `anon`; `authenticated` gets select/insert/update/delete, RLS narrows it).

**Money locks**

- **Price-only tables** — the staff write policy becomes `is_staff() and (select has_permission('money.prices'))`;
  reads are unchanged: `activity_option_prices`, `activity_supplements`, `sightseeing_pricing`,
  `planner_pricing`, `transport_band_pricing`, `airport_transfer_fare`, `hotel_transfer_fare`,
  `airport_transfer_config`, `hotel_transfer_config`, `region_zone_distance`.
- **Mixed tables** — a `before insert or update` trigger raises `forbidden` when a client caller
  without the permission sets a price column to a new value (`new.col is distinct from old.col`; on
  insert, a non-null value). Unchanged re-saves pass.
  - `activity_options.private_base_minor`, `private_extra_minor` → `money.prices`
  - `activities.supplement_minor` (legacy, frozen) → `money.prices`
  - `rental_vehicles.daily_rate_minor`, `deposit_minor` → `money.prices`
  - `business_settings.charge_currency`, `eur_mur_rate` → `money.currency` (the WhatsApp number on the
    same row stays editable)
- **Refunds** — `api_mark_refunded` and `api_record_change_refund` raise `forbidden` without
  `money.refunds`. Re-define from the winning body, adding only the check.

**Backfill** — the migration creates a "Content" role (base `content`, the five content sections) and
points every existing `seo` profile at it. Existing `staff` profiles (none in prod) are left with no
team role and fail closed.

## App changes

- **`src/lib/admin/permissions.ts`** — the catalogue as data: key, label, group, content-allowed flag.
  No React/Next imports.
- **Access in the browser** — `AuthProvider` calls `api_my_access` with the profile load; a `useAccess()`
  hook exposes `isOwner` and `can(key)`. The scattered `role === 'admin' || role === 'staff'` checks
  in admin components switch to `can(...)`.
- **Navigation** — `NavItem.seo?: boolean` becomes `permission: PermissionKey | 'owner' | null`
  (`null` = everyone: Dashboard). Reports → `money.reports`; Pricing → `money.prices` or
  `money.currency`; Roles → `'owner'`. `navForRole` becomes `navFor(access)` and also filters the
  bottom-nav lists.
- **Page guard** — `AdminShell` resolves the current path to its nav item and renders the "No access"
  panel when `can` fails, so every admin page is covered in one place.
- **Money inside screens**
  - Dashboard: revenue card + `RevenueChart` behind `money.revenue`.
  - Bookings: CSV export behind `money.reports`; "Mark refunded" behind `money.refunds`; the change-of-tour
    refund step behind `money.refunds`.
  - Quotes / Documents: internal-notes field hidden without `money.notes`.
  - Tours: `PricingSection` read-only without `money.prices`; **the save path skips `replacePrices()`
    and `reconcileSupplements()` entirely** when the user lacks `money.prices`, and sends option price
    columns unchanged (otherwise every description edit would hit the DB lock).
  - Pricing page: fare editors need `money.prices`; `PaymentCurrencyCard` needs `money.currency`.
  - Rental: rate fields read-only without `money.prices`.
- **Server routes** — one helper in `src/lib/http/` (e.g. `requirePermission(req, key)`) reads
  `profiles` + `team_roles` through the service-role client and replaces the five `callerRole()` copies.
  Never `requireUser().role` (that is the JWT role). Mapping: assistant → `section.assistant`;
  installment remind → `section.bookings`; quotes send / balance / draft-from-email → `section.quotes`;
  documents email / pdf → `section.documents` (new: they gain an explicit check on top of RLS). A
  content-only member is refused by every one of them, as `seo` is today.
- **Roles UI** — `app/(site)/admin/roles/page.tsx` (`runtime = 'edge'`) + `src/components/admin/AdminRoles.tsx`,
  following the existing admin screens' look.

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

Integration (PGlite, `tests/integration/`):

- `has_permission` for owner, team member with/without a key, content member, staff with no team role,
  signed-out.
- Profiles guard: staff cannot change their own or anyone's `role` / `team_role_id`, cannot delete a
  profile, cannot update an admin's profile; a mismatched role/base pair is refused.
- `api_team_assign` / `api_team_remove`: owner only; `not_found` for an unknown email; `last_owner`
  refusal, including self-demotion.
- `team_roles`: content role cannot hold a guest section or money key; `base` cannot change; delete
  refused while members exist; non-admin cannot write.
- Money locks: price-only table writes refused without `money.prices` and allowed with it; mixed-table
  trigger passes an unchanged re-save and refuses a changed price; `business_settings` WhatsApp edit
  passes without `money.currency`, rate edit refused; both refund RPCs refused without `money.refunds`.
- Grants: `anon` has no privilege on `team_roles`; the new RPCs are not executable by `anon`
  (extend `rpc-grants.test.ts` / `definer-grants-lockdown.test.ts`).

Unit:

- Catalogue keys in `permissions.ts` equal the SQL check list.
- Every `ADMIN_NAV` entry points at a real route and carries a permission; the content-allowed set
  equals the old `seo: true` set (replaces the seo-flag assertions in `admin-quotes-editor.test.ts`).
- The tour save path makes no `activity_option_prices` / `activity_supplements` writes without
  `money.prices`.

## Out of scope

- RLS enforcement of sections (reads of bookings, leads, quotes… stay `is_staff()`).
- Per-section view/edit levels.
- Invitation emails for people without an account.
- An audit log of role changes (beyond `team_roles.updated_by`).

## Landmines this touches

- Re-defining `enforce_profile_role`, `api_mark_refunded`, `api_record_change_refund` and the price
  tables' policies: start from the **winning** (last in filename order) body, mirror to the end of
  `supabase/catch-up.sql`, add a `backfill-migration-ledger.sql` row.
- New table grants: `anon` gets DELETE by default — revoke explicitly and check with
  `has_table_privilege()`.
- Hand-edit `src/lib/supabase/types.ts` for `team_roles`, `profiles.team_role_id` and the new RPCs.
- New admin UI strings passed to `t(...)` need `messages.ts` rows; run `node scripts/i18n-scan.mjs`.
