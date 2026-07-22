# Database — the SQL discipline

[← Handbook](../HANDBOOK.md)

> **This is the most dangerous file in the handbook.** The business logic lives in Postgres, and
> there is a failure mode here that silently reverts security fixes with a fully green build. Read
> it before you write any SQL.

**Two eras, read carefully which one you're in:** until the [release pipeline bootstrap
checklist](deployment.md#bootstrap-checklist-do-this-once-in-this-exact-order) is complete, production
is still updated **by hand** exactly as described below. Once bootstrapped, `release.yml` runs
`supabase db push` automatically on every push to `main` — see
["The automated path"](#the-automated-path-once-bootstrapped) below. The manual recipe further down
(writing a migration, mirroring it into `catch-up.sql`, regenerating `setup.sql`) **does not change**
either way — `catch-up.sql` stays the disaster-recovery / fresh-reconciliation script and
`supabase/migrations/` stays the one true source of truth in both eras.

---

## The four SQL files, and what each is for

| File                        | Who runs it                                                                                       | Generated?       |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| `supabase/migrations/*.sql` | The test suite; `supabase db push` once bootstrapped; the source of truth                         | Hand-written ✍️  |
| `supabase/catch-up.sql`     | The owner (manual era); `reconcile-supabase-ledger.yml` (bootstrap); disaster recovery thereafter | Hand-mirrored ✍️ |
| `supabase/setup.sql`        | `npm run db:setup`, on a **fresh** DB                                                             | **Generated** 🤖 |
| `supabase/seed.sql`         | Bundled into setup.sql                                                                            | **Generated** 🤖 |

**`supabase/migrations/` is the source of truth.** ~107 files, applied in **filename sort order**.
The tests apply these and only these; once bootstrapped, so does `supabase db push` in production.

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

`release.yml`'s `supabase-ledger-gate` job, on every push to `main`:

1. Fails immediately unless the repository variable `SUPABASE_MIGRATION_LEDGER_RECONCILED` is
   exactly `true` (see the [bootstrap checklist](deployment.md#bootstrap-checklist-do-this-once-in-this-exact-order)).
2. Re-verifies the ledger (`supabase_migrations.schema_migrations`) matches `supabase/migrations/`
   1:1 — no gaps, no unexpected remote-only versions, no non-linear history
   (`scripts/release/supabase-ledger.mjs --mode status`).
3. Runs `supabase db push --dry-run --linked` and fails if it reports anything pending that wasn't
   expected.
4. Only then runs the real `supabase db push --linked` — **never `--include-all`**.
5. Re-verifies the ledger is synchronized afterward.

This job runs BEFORE the web/cron deploys, so a migration failure blocks the whole release — the app
never ships against a schema it doesn't match. The one-time reconciliation
(`reconcile-supabase-ledger.yml`) that gets the ledger into a state where this is safe to do
automatically is documented in `deployment.md` and is deliberately **manual-only, never triggered by
this pipeline**.

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

11. **Tell the owner to re-run `catch-up.sql` on production.** Deploying code does not change the
    database.

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

**Once the release pipeline is bootstrapped, you don't do this for ordinary changes** —
`release.yml`'s `supabase-ledger-gate` job runs `supabase db push` automatically on every push to
`main`, gated on the checks in ["The automated path"](#the-automated-path-once-bootstrapped) above.
This manual recipe is the fallback (pre-bootstrap) and the disaster-recovery path (any time the
ledger needs rebuilding from scratch):

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
so old code runs fine against the new schema. New code against an old schema 500s. (Once bootstrapped,
the pipeline enforces this ordering for you — the ledger gate runs, and the database is pushed,
strictly before the web/cron deploy steps.)

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
4. Owner pastes `catch-up.sql` into Supabase (manual era) — or just push to `main` (automated era:
   the new migration is a normal forward migration, `db push` applies it like any other).

**If the bad migration destroyed data, SQL cannot bring it back.** Use Supabase's own backups
(Dashboard → Database → Backups / PITR).

This is also why every migration must be **additive/backward-compatible with the previously deployed
web version**: `deployment.md`'s rollback story for a bad web deploy is "redeploy the old Pages
build" — that only stays safe if the OLD code can still run against the (now slightly ahead) schema.
The pipeline never attempts an automatic destructive database rollback, and neither should you by
hand — forward-only, always.

---

## Roles

```sql
-- Promote a user. They must have signed up first (so their profiles row exists).
update profiles set role = 'admin'   -- or 'staff' | 'seo' | 'customer'
 where id = (select id from auth.users where email = 'them@example.com');
```

There is no UI for this — it is deliberately a raw SQL statement.

- `is_staff()` → `staff | admin`. Gates **all money and PII**.
- `is_content_editor()` → `staff | admin | seo`. Gates **content tables only**.

`is_content_editor()` compares `role::text`, not the enum literal, because Postgres forbids _using_ a
just-added enum value in the same transaction that added it. Don't "clean that up".
