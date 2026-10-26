# Database — the SQL discipline

[← Handbook](../HANDBOOK.md)

> **This is the most dangerous file in the handbook.** The business logic lives in Postgres, and
> there is a failure mode here that silently reverts security fixes with a fully green build. Read
> it before you write any SQL.

**Two eras, read carefully which one you're in:** until the [release pipeline bootstrap
checklist](deployment.md#bootstrap-checklist-do-this-once-in-this-exact-order) is complete, production
is still updated **by hand** exactly as described below. Once bootstrapped, `release.yml` checks the
ledger and runs `supabase db push` on every push to `main`, but **it never applies a new migration** —
the owner still applies each one by hand, then records it in the ledger, _before_ pushing. See
["The automated path"](#the-automated-path-once-bootstrapped) below. The manual recipe further down
(writing a migration, mirroring it into `catch-up.sql`, regenerating `setup.sql`) **does not change**
either way — `catch-up.sql` stays the disaster-recovery / fresh-reconciliation script and
`supabase/migrations/` stays the one true source of truth in both eras.

---

## The four SQL files, and what each is for

| File                        | Who runs it                                                                                       | Generated?       |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| `supabase/migrations/*.sql` | The test suite; the owner by hand (SQL editor); the release's ledger gate checks them             | Hand-written ✍️  |
| `supabase/catch-up.sql`     | The owner (manual era); `reconcile-supabase-ledger.yml` (bootstrap); disaster recovery thereafter | Hand-mirrored ✍️ |
| `supabase/setup.sql`        | `npm run db:setup`, on a **fresh** DB                                                             | **Generated** 🤖 |
| `supabase/seed.sql`         | Bundled into setup.sql                                                                            | **Generated** 🤖 |

**`supabase/migrations/` is the source of truth.** ~107 files, applied in **filename sort order**.
The tests apply these and only these. In production the owner applies a new one by hand, and the
release's ledger gate then checks that the ledger lists every file here (it does not apply anything).

**`supabase/catch-up.sql` is the manual-era delta script and the reconciliation script.** Before
bootstrap, there is no migration runner in production — the live database has never been `supabase db
push`-ed, and it's updated by a human pasting this file into the Supabase SQL editor. After
bootstrap, this file becomes step 2 of `reconcile-supabase-ledger.yml` (a one-time, human-supervised
operation) and stays the documented disaster-recovery path if the ledger ever drifts again — it does
NOT stop being maintained.

> **So every schema change must still be written twice** — once as a migration, once appended to
> `catch-up.sql` — in BOTH eras. Skipping the `catch-up.sql` mirror doesn't just lag production in
> the manual era; post-bootstrap it also means a future re-reconciliation (if the ledger ever needs
> rebuilding) would silently regress that change.

## The automated path (once bootstrapped)

`release.yml`'s `supabase-ledger-gate` job, on every push to `main`, is a **gate, not a deployer**:

1. Fails immediately unless the repository variable `SUPABASE_MIGRATION_LEDGER_RECONCILED` is
   exactly `true` (see the [bootstrap checklist](deployment.md#bootstrap-checklist-do-this-once-in-this-exact-order)).
2. Verifies the ledger (`supabase_migrations.schema_migrations`) matches `supabase/migrations/`
   1:1 (`scripts/release/supabase-ledger.mjs --mode status`). It **throws when any local migration
   has no ledger row**, or the ledger holds a version with no local file.
3. Runs `supabase db push --dry-run --linked` and fails if it names any local migration (= pending).
4. Runs the real `supabase db push --linked` — **never `--include-all`**. Steps 2 and 3 have already
   proved there is nothing to push, so this is a no-op safety net: **the release never applies a new
   migration.**
5. Re-verifies the ledger afterwards.

This job runs BEFORE the web/cron deploys (`deploy-web` needs it), so a migration the owner has not
yet applied and recorded blocks the whole release and the site stays on the old build. The one-time
reconciliation (`reconcile-supabase-ledger.yml`) that got the ledger into this state is documented in
`deployment.md` and is deliberately **manual-only, never triggered by this pipeline**.

### Shipping a new migration — the real procedure

The migration reaches production by hand, in this order:

1. **The owner runs the migration** (the new file in `supabase/migrations/`, or `catch-up.sql`) in the
   production SQL editor.
2. **Verify it** with read-only checks specific to that migration (a function body, a policy, a
   `has_table_privilege()` answer, a row count).
3. **Only then record it in the ledger** — one row, the same tuple that already sits in
   `supabase/backfill-migration-ledger.sql`:

   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('20261025140000', 'admin_roles')   -- the file's <version>_<name>.sql
   on conflict (version) do nothing;
   ```

4. **Then `git push origin main`.**

**The order is load-bearing.** A ledger row without the schema behind it lets the gate pass and ships
new web code onto the old schema — every request touching the new column or RPC then 500s. (Never paste
the whole `backfill-migration-ledger.sql` to "catch up": it already lists migrations that have not been
applied yet, so it would record them early.) Pushing with the migration still unapplied is the safe
mistake: the gate fails with "Ledger is NOT in sync", `deploy-web` is skipped, production is unchanged;
apply, verify, insert the row, then re-run the failed release.

**`supabase/setup.sql` is the fresh-install bundle** (every migration + seed, in one file). Generated —
never edit it.

**`setup.sql` is the only supported way to provision a fresh database.** There used to be a second,
hand-maintained bundle (`bootstrap.sql`); it rotted, silently dropped the security lockdown, and was
deleted in `2026-07`. Don't reintroduce one — if you need a fresh-install artifact, regenerate
`setup.sql`. `tests/integration/setup-sql-executes.test.ts` now runs it against an empty Postgres and
asserts the anon key cannot reach the money RPCs, so that class of rot cannot come back unnoticed.

### One file you should not run blindly

- **`supabase/admin-setup.sql` — step 1 is destructive.** It begins with
  `delete from activities where slug <> 'north-tour'`. Read it before you run it. (Step 3 — which creates
  the `activity-images` Storage bucket — is safe and idempotent, and admin photo uploads fail silently
  until it has been run once.)

---

## The two guards CI gives you

**`catch-up-parity`** applies every migration to a real Postgres, snapshots every function body, then
applies `catch-up.sql` on top and checks nothing changed. It catches `catch-up.sql` shipping an _older_
body than the migrations.

> A failure means: _catch-up.sql redefines this function with a stale body._ Fix by copying the
> migration's current body into catch-up.sql. **Do not "fix" the migration.**

**`setup-sql-parity`** byte-compares the committed `setup.sql` against a fresh build. Fix with
`npm run seed:gen && npm run setup:sql`.

**Neither guard can see the worst failure mode.** Read on.

---

## ⚠️ The worst one: migration-revert drift

Migrations are applied in **filename order**, and for a `create or replace function`, **the last one
wins**.

So: a migration that is _written_ later but _named_ earlier — or one that was branched from an old copy
of a function body — will silently **revert** another migration's fix. Its own diff looks completely
innocent. The build stays green. No test fails, because the migrated database _itself_ is now wrong, and
catch-up-parity only compares catch-up against that database.

**This has already happened at least twice.** In one case, `20260617180000_child_seats.sql` added a guard
to `api_book` that stops a replayed idempotency key from disclosing another customer's booking PII.
`20260617210000_planner_vehicle_pricing.sql` — forked from an earlier copy — redefined `api_book`
_without_ the guard, sorted later, and won. The guard vanished from production. It took a dedicated
migration to put it back.

## ⚠️ Its twin: appending to a migration that has already run

A migration is **immutable the moment it may have been applied**. `supabase db push` keys off the
version prefix, not the file contents: once `supabase_migrations.schema_migrations` has the row, the
file is never read again. Editing or appending to it changes nothing in production, forever.

**This has happened.** `20260901000100_localised_catalogue_rpcs.sql` was created containing only
`api_get_activity`. A parallel session pushed while the work was still in progress, which deployed and
recorded that version. `api_search_activities` was then appended to the same file. The push that
followed skipped it — the version was already recorded — so activity **detail** pages resolved French
while every card, search result, home rail and "you might also like" row kept rendering English.

What makes this one nasty is that **everything on disk is correct**: the migration file is right,
`catch-up.sql` is right, `setup.sql` is right, the ledger is right, and every test passes — because
tests replay all migrations onto a fresh database, where the appended text does run. Only the live
database disagrees, and nothing compares the two.

**The rule:** to change a function, add a **new** migration. Never append to an existing one, even one
you created minutes ago — in a shared tree you cannot know whether someone else has already pushed.

To check whether production actually has what you think it has:

```sql
select position('activity_translations' in pg_get_functiondef(p.oid)) > 0
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'api_search_activities';
```

### Mandatory before any `create or replace function`

```bash
# 1. Find every migration that defines it — output is in sort order.
grep -ln "function api_book" supabase/migrations/*.sql

# 2. The LAST path printed is the WINNING body. That is what production is running.
#    Read it in full. Base your change on THAT — not on "the one that looks recent".

# 3. Diff it against the guards in every EARLIER definition.
#    A guard present earlier but missing from the winner is an existing silent revert.
#    Fix it forward. Never edit an old migration — production already ran it.
```

Grep for each guard you _assume_ is present rather than trusting a migration's header comment. One real
migration's header claimed its `api_book` body was "byte-for-byte identical" when it was not.

The functions to be most careful with: `api_book`, `create_booking`, `create_hold`, `api_create_hold`,
`append_payment_event`, `materialize_availability`, `api_search_activities`, `api_get_activity`.

---

## The full recipe: add a migration

1. **Pick the filename.** `ls supabase/migrations | tail -1` → your file must sort **strictly after** it.
   Note that duplicate timestamp prefixes already exist in this repo, so ties break on the rest of the
   name — don't reuse a prefix for a fix that must win.

2. **If you're redefining a function, find the winning body first.** See above. This is not optional.

3. **Write idempotent DDL.** `create table if not exists`, `create or replace function`,
   `drop policy if exists` + `create policy`, `alter table … add column if not exists`. It must be safe
   to run twice, because `catch-up.sql` reuses the same text.

4. **If you created a function, lock down its grants.** Postgres implicitly grants `EXECUTE` to
   `PUBLIC` at create time, and `anon`/`authenticated` are **members of PUBLIC** — so revoking from just
   those two roles does nothing:

   ```sql
   revoke execute on function my_fn(jsonb) from public, anon, authenticated;  -- name PUBLIC!
   grant  execute on function my_fn(jsonb) to service_role;
   ```

   This exact mistake shipped once: the first lockdown revoked only the named roles, and the money RPCs
   stayed callable with the public anon key.

5. **Mirror into `supabase/catch-up.sql`** — append at the **end**, under a
   `-- ---- <migration filename> ----` banner. _A migration that isn't mirrored never reaches
   production._

6. **Regenerate:** `npm run seed:gen && npm run setup:sql`, and commit `supabase/setup.sql`.

7. **New `api_*` RPC?** Add its exact name to `ALLOWED` in `tests/db/rpc.ts`.

8. **New table / column / enum value?** Hand-edit `src/lib/supabase/types.ts`. It is **hand-authored**,
   not generated. **Do not run `npm run gen:types`** — it needs a local Supabase CLI stack this project
   doesn't have, and it will overwrite the file with garbage.

9. **Write an integration test.** `createTestDb()` in `tests/db/pglite.ts`. This is the only thing that
   stops your security guard from being silently reverted a year from now.

10. **Run `npm run test:coverage`** — the parity, lockdown and grant guards all live in there.

11. **Tell the owner to apply the migration on production and record it in the ledger — before you
    push.** Deploying code does not change the database, and the release does not apply migrations
    either: see [Shipping a new migration](#shipping-a-new-migration--the-real-procedure).

---

## ⚠️ `catch-up.sql` is only half transactional

`begin;` is on line 11. `commit;` is on line 6221. **The remaining ~6,270 lines run in autocommit**,
one statement at a time — including the whole security lockdown and the SEO module.

So if the owner runs it and it errors halfway, **everything before the failure is already committed** and
the live database is in a partial state. The error message gives no hint of this.

**Which is why every appended statement must be independently idempotent.** Then the recovery is always
the same: fix the error, re-run the whole file from the top.

---

## Owner: applying an update to production

**This is how every migration reaches production, bootstrapped or not.** `release.yml`'s
`supabase-ledger-gate` job does not apply anything — it only checks that the ledger already lists
every file in `supabase/migrations/` (see ["The automated path"](#the-automated-path-once-bootstrapped)
above). So after step 4 below, **insert the ledger row** for each new migration
([Shipping a new migration](#shipping-a-new-migration--the-real-procedure), steps 2–3) and only then
push. It is also the disaster-recovery path (any time the ledger needs rebuilding from scratch):

1. Supabase dashboard → **SQL Editor** → New query.
2. Open `supabase/catch-up.sql`, copy the **whole file**, paste, **Run**.
3. It's idempotent. Re-running it is safe, and is the expected routine after any deploy that says
   _"owner re-runs catch-up.sql"_.
4. **If it errors: fix, then re-run the whole file from the top.** Do not try to run "just the rest".

If the paste truncates, or a multibyte character (`Île`, `–`) mangles, use the wire method instead: put
`SUPABASE_DB_URL` (the **:5432** direct/session-pooler URI, _not_ the :6543 transaction pooler) in
`.env.local`, then:

```bash
npx tsx scripts/db-exec.ts supabase/catch-up.sql
```

**Order matters:** run the SQL **before** deploying the code that needs it. The migrations are additive,
so old code runs fine against the new schema. New code against an old schema 500s. (The ledger gate
backs this up — a push whose migration is not yet in the ledger stops there and the web deploy is
skipped — but only if you insert the ledger row _after_ the SQL has run and been checked, never before.)

---

## Provisioning a brand-new database

```bash
# .env.local: SUPABASE_DB_URL=postgresql://postgres:PASSWORD@…:5432/postgres   (NOT :6543)
npm run seed:gen && npm run setup:sql
npm run db:setup          # applies supabase/setup.sql → "✓ Applied. activities rows: N"
```

Then sign up in the app (so a `profiles` row exists), **read `supabase/admin-setup.sql` and delete step
1** unless you really want the catalogue wiped, and run it to make yourself admin and create the Storage
bucket.

---

## Undoing a bad migration

There are no `down` migrations. **The only way to undo SQL in production is forward-only SQL.**

1. Write a **new** migration, timestamped after the bad one, that restores the previous function body or
   drops the bad column. Never edit the bad migration in place — production already ran it, and the tests
   replay files in order.
2. Append the same SQL to the end of `catch-up.sql`.
3. `npm run seed:gen && npm run setup:sql`, then `npm run test:coverage`.
4. The owner applies it like any other migration: run the new file (or `catch-up.sql`) in the SQL
   editor, verify, insert its ledger row, and only then push to `main`
   ([Shipping a new migration](#shipping-a-new-migration--the-real-procedure)).

**If the bad migration destroyed data, SQL cannot bring it back.** Use Supabase's own backups
(Dashboard → Database → Backups / PITR).

This is also why every migration must be **additive/backward-compatible with the previously deployed
web version**: `deployment.md`'s rollback story for a bad web deploy is "redeploy the old Pages
build" — that only stays safe if the OLD code can still run against the (now slightly ahead) schema.
The pipeline never attempts an automatic destructive database rollback, and neither should you by
hand — forward-only, always.

---

## Roles

Back-office access is managed in **/admin/roles** (spec: `docs/superpowers/specs/2026-10-25-admin-roles-design.md`,
migration `20261025140000_admin_roles.sql`). Only the very first Owner of a fresh database is made by
hand:

```sql
update profiles set role = 'admin'
 where id = (select id from auth.users where email = 'them@example.com');
```

- `profiles.role` stays the **data floor**: `admin` = Owner, `staff` = a team-base role, `seo` = a
  content-base role, `customer`. `profiles.team_role_id` → `team_roles` (the owner's permission bundles).
- `is_staff()` → `staff | admin`. Gates **money and PII reads** (unchanged).
- `is_content_editor()` → `staff | admin | seo`. Gates **content tables only**.
- `is_admin()` → Owner. Gates `team_roles` writes, the team RPCs, **client** profile deletes, and every
  change of `role` / `team_role_id` (`enforce_profile_role`).
- `has_permission('<key>')` → Owner, or a member whose role holds the key **and whose base matches**
  their `profiles.role` (staff ↔ team, seo ↔ content). A key that is not in the catalogue is false for
  **everyone, the Owner included**, so a typo'd key in a policy fails loudly in tests instead of
  silently granting. Use it in policies as `(select has_permission('…'))`.
- The catalogue lives twice — `src/lib/admin/permissions.ts` and `permission_catalogue()` — and
  `tests/integration/admin-roles.test.ts` pins them equal. Adding a key means a migration that
  redefines both catalogue functions. **Only ever add keys**: removing one leaves stored
  `team_roles.permissions` that violate the CHECK, so strip it from the rows in the same migration.

**The profile guard** (`enforce_profile_role`, `enforce_last_owner_delete`) binds every writer:

- `profiles.id` is immutable. Only the Owner changes `role` / `team_role_id` from a client; anyone
  else's insert is forced to `customer` and their updates keep the old values.
- The pairing rule: a team role sits only on a `staff` (base `team`) or `seo` (base `content`) profile;
  an Owner or customer never carries one. The last Owner cannot be demoted or deleted — by a profile
  delete, by `api_erase_user`, or by deleting their `auth.users` row. Both checks take the same
  advisory lock, so two Owners cannot demote each other at once.
- Staff cannot delete or erase a non-customer profile (`profiles_staff` is gone; deletes are
  Owner-only). `api_erase_user` is `SECURITY DEFINER` and would bypass RLS, so the delete trigger
  re-checks `auth.uid()`: staff may still erase customers, or themselves.

**The team RPCs** (`p jsonb`, Owner only except the first): `api_my_access` (any signed-in user; returns
`role`, `teamRoleId`, `teamRoleName`, `base`, `permissions[]`), `api_team_list`, `api_team_assign`,
`api_team_remove`. `api_team_assign` takes a `userId` **or** an `email`; by email it needs exactly **one
confirmed** account (`not_found` / `not_confirmed` / `ambiguous_email`), because it can hand out the
whole back office.

**Money locks** (what the database refuses without the permission):

- The ten price tables and `airport_transfer_hotels` need `money.prices` to write (staff policy =
  `is_staff() and has_permission('money.prices')`). Reads are unchanged.
- Price columns on tables that also hold ordinary fields are guarded by `enforce_money_columns(...)`
  triggers, which compare old and new so an unchanged re-save passes: `private_base_minor`,
  `private_included`, `private_extra_minor`, `supplement_minor` and the rental `daily_rate_minor` /
  `deposit_minor` on insert **and** update; `pricing_mode`, `is_airport_transfer`, `is_hotel_transfer`
  and `activity_options.activity_id` on **update only** (a new tour legitimately sets them on insert).
  A column whose non-price default is not null/`'0'` must never go on an insert-firing trigger.
- `business_settings.charge_currency`, `eur_mur_rate`, `eur_mur_rate_updated_at` need `money.currency`.
  The WhatsApp number on the same row stays editable. `business_settings_money_guard` is
  **`before update` only**: `charge_currency` defaults to `'MUR'` and `eur_mur_rate` is numeric, both of
  which the guard's crude INSERT rule would refuse, and nothing is lost because the table is one seeded
  row with no client INSERT policy.
- `api_mark_refunded` and `api_record_change_refund` need `money.refunds`.
- **Table privileges, not policies (§6c, §6d).** Several tables carry a staff policy
  `for all using (is_staff())` that a browser session should never exercise, and production's default
  privileges hand `anon` and `authenticated` every write on them. The migration revokes those writes
  (from `public, anon, authenticated`; `SELECT` is untouched, `service_role` keeps its writes):
  - **§6c — the booking line tables** `booking_items`, `booking_custom_items`,
    `booking_pickup_requests`, `booking_installments`, `booking_supplements`: read-only for signed-in
    clients (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER). Every legitimate writer is a
    `SECURITY DEFINER` function or the service role. Without this, a bookings-only member could rewrite
    a line amount or an installment (which sizes the real charge in `create_payment`) straight through
    PostgREST, past every lock above.
  - **§6d — `bookings`:** `DELETE` and `TRUNCATE` revoked (`INSERT` and `UPDATE` stay — the browser
    updates `status` and `notes`, and `forbid_public_write` / `enforce_booking_admin_update` pin
    the rest). Nothing guarded DELETE, and the foreign keys cascade `bookings` → `payments` →
    `payment_events`, so a worker could otherwise erase a paid booking and its whole payments ledger.
    The only legitimate deleter is `api_erase_user` (definer).
  - **§6d — `booking_holds`, `notification_outbox`, `operators`:** all writes revoked. Holds are made
    and freed by definer functions; a client write to the outbox could queue mail in the business's
    name; `operators` holds `payout_details`. The admin UI only reads them.
  - The tests are the `describeLocks('6c' | '6d')` drift tests in
    `tests/integration/admin-roles.test.ts` — see the landmine
    [a table the browser never writes must revoke the default write grants](landmines.md#a-table-the-browser-never-writes-must-revoke-supabases-default-write-grants-from-anon-and-authenticated).
- §6b of the migration pins a booking's `deposit_minor`, `balance_due_minor`, `transport_minor`,
  `supplement_minor`, `supplement_qty` and `child_seats` against **any** browser session, the Owner's
  included (`enforce_booking_admin_update`): a hand-edited `deposit_minor` would make `api_mark_refunded`
  treat the paid row as a non-refundable deposit.
- The migration re-declares `enforce_profile_role`, `enforce_booking_admin_update`,
  `api_mark_refunded` and `api_record_change_refund` from their winning bodies.
  `tests/integration/resolved-function-bodies.test.ts` pins the permission check in both refund RPCs
  and every column pin in the booking guard, so a later migration forked from a stale copy fails CI;
  `tests/integration/admin-roles.test.ts` exercises the profile guard. Read both before touching any of
  them.

`is_content_editor()` compares `role::text`, not the enum literal, because Postgres forbids _using_ a
just-added enum value in the same transaction that added it. Don't "clean that up" — and the role
comparisons in the admin-roles migration do the same, for the same reason.
