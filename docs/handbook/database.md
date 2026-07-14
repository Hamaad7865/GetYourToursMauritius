# Database — the SQL discipline

[← Handbook](../HANDBOOK.md)

> **This is the most dangerous file in the handbook.** The business logic lives in Postgres, production
> is updated **by hand**, and there is a failure mode here that silently reverts security fixes with a
> fully green build. Read it before you write any SQL.

---

## The four SQL files, and what each is for

| File                        | Who runs it                           | Generated?       |
| --------------------------- | ------------------------------------- | ---------------- |
| `supabase/migrations/*.sql` | The test suite; the source of truth   | Hand-written ✍️  |
| `supabase/catch-up.sql`     | **The owner, on production**          | Hand-mirrored ✍️ |
| `supabase/setup.sql`        | `npm run db:setup`, on a **fresh** DB | **Generated** 🤖 |
| `supabase/seed.sql`         | Bundled into setup.sql                | **Generated** 🤖 |

**`supabase/migrations/` is the source of truth.** ~98 files, applied in **filename sort order**. The
tests apply these and only these.

**`supabase/catch-up.sql` is what production actually gets.** There is no migration runner in
production. The live database has never been `supabase db push`-ed. It is updated by a human pasting
this file into the Supabase SQL editor. It's a cumulative, idempotent delta script.

> **So every schema change must be written twice** — once as a migration, once appended to
> `catch-up.sql` — or production silently lags the code.

**`supabase/setup.sql` is the fresh-install bundle** (every migration + seed, in one file). Generated —
never edit it.

### Two files you should not touch

- **`supabase/bootstrap.sql` — ⚠️ DO NOT USE. It is 12 migrations stale.** It stops at
  `20260752000000` and is missing the **entire public-mutation security lockdown**. A database built
  from it would let anyone with the anon key execute `create_booking` and `api_record_payment_charge`.
  Nothing guards this file. Provision fresh databases with `setup.sql` (`npm run db:setup`) instead.
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
so old code runs fine against the new schema. New code against an old schema 500s.

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

**Never provision from `bootstrap.sql`** — see above.

---

## Undoing a bad migration

There are no `down` migrations. **The only way to undo SQL in production is forward-only SQL.**

1. Write a **new** migration, timestamped after the bad one, that restores the previous function body or
   drops the bad column. Never edit the bad migration in place — production already ran it, and the tests
   replay files in order.
2. Append the same SQL to the end of `catch-up.sql`.
3. `npm run seed:gen && npm run setup:sql`, then `npm run test:coverage`.
4. Owner pastes `catch-up.sql` into Supabase.

**If the bad migration destroyed data, SQL cannot bring it back.** Use Supabase's own backups
(Dashboard → Database → Backups / PITR).

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
