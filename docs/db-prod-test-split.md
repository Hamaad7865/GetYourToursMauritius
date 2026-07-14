# Splitting the database: clean PROD + a throwaway TEST project

The current Supabase project has been used for development, so it holds real catalogue work
(46 activities you built by hand) **mixed with** test bookings, test payments, abandoned carts and
test customer logins. This turns it into a clean production database and gives you a separate test
project you can break freely.

**End state**

|          | Project                                      | Contains                                            |
| -------- | -------------------------------------------- | --------------------------------------------------- |
| **PROD** | the current project (`dwjkfowhrrvdiqligxcj`) | the catalogue, **zero** bookings, your admin logins |
| **TEST** | a new Supabase project                       | the same catalogue, safe to break                   |

The catalogue stays where it is. Only the test junk is removed — see
[Why prod is purged, not rebuilt](#why-prod-is-purged-not-rebuilt).

---

## Order matters. Do these in order.

### 1. Back up (twice). Non-negotiable.

**a) Supabase's own backup.** Dashboard → **Database → Backups** → take/confirm a recent backup.

**b) A logical backup of the catalogue** — the only data you cannot re-create by hand:

```bash
npx tsx scripts/dump-catalogue.ts
```

Writes `supabase/seed-live-catalogue.sql` (~572 rows: activities, options, prices, images,
translations, categories, operator, and every fare/pricing/planner/rental table). It contains **no**
bookings, payments or customer PII. Commit it — it's both your restore point and the seed for TEST.

### 2. Purge PROD

In the **Supabase SQL editor** (on the current project), run:

```
supabase/purge-transactional.sql
```

- **Deletes:** every booking (+ items, holds, payments, payment events by cascade), abandoned cart
  holds, the notification outbox, in-app notifications, rate limits, audit logs, chat, leads,
  wishlists, and the test **customer** accounts.
- **Keeps:** the entire catalogue, all pricing/fare config, availability, and **every admin/staff
  login**.

The script prints the surviving admin logins **first**. Read that list. If your own account is not in
it, stop and don't commit — you'd be locking yourself out of `/admin`.

It ends with a verification table: every `should be 0` row must read 0, and the `KEPT` rows must match
what you had.

> Seats free themselves. `session_occurrences` has no `used_capacity` column — usage is _derived_ by
> counting bookings/holds. Deleting the bookings releases every seat, so availability is left alone.
> This is covered by `tests/integration/purge-transactional.test.ts`, which runs the real script
> against the real schema and asserts the catalogue and admin survive.

### 3. Create the TEST project

Supabase dashboard → **New project**. Any name (e.g. `bmt-test`), same region. Save the DB password.

### 4. Build the TEST schema + catalogue

In the **TEST** project's SQL editor:

1. Paste and run **`supabase/setup.sql`** — the whole file. It's generated
   (`npm run setup:sql`) and builds the complete schema from every migration.
2. Then run **`supabase/seed-live-catalogue.sql`** — but it **refuses to run by default**, because it
   replaces the entire catalogue and must never be pasted into prod by accident. Opt in first, in the
   same editor tab:

   ```sql
   set bmt.allow_catalogue_replace = 'yes';
   ```

   Then paste the seed file below it and run. It clears the demo catalogue `setup.sql` seeded, inserts
   your real one, and rebuilds availability.

3. Give yourself admin on TEST: sign up through the app pointed at TEST, then:

   ```sql
   update profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
   ```

### 5. Point your tooling at TEST

Local dev and the scripts read `.env.local`. To work against TEST, swap these four to the **new**
project's values (Supabase → Project Settings → API / Database):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
```

**Leave Cloudflare Pages production alone** — it must keep pointing at PROD. If you want a deployed
test site, set these as overrides on a Cloudflare **Preview** environment, not Production.

---

## Landmines

**The TEST database's photos are served from PROD's storage bucket.** 181 of the 277 image URLs are
absolute links into `dwjkfowhrrvdiqligxcj.supabase.co/storage/.../activity-images/...`, and the dump
carries them verbatim. That bucket is public, so TEST will happily load them — free, read-only, no
migration needed. Two consequences:

- **Don't delete PROD's `activity-images` bucket**, or TEST's photos break too.
- Images you upload _in TEST's admin_ land in TEST's own bucket. That's fine and expected.

**`seed-live-catalogue.sql` is destructive.** It wipes and replaces the whole catalogue. The
`bmt.allow_catalogue_replace` guard exists so a stray paste into the prod tab errors out instead of
deleting your work. Never remove that guard.

**Re-dump after catalogue changes.** `seed-live-catalogue.sql` is a snapshot. If you add activities in
PROD's admin, re-run `npx tsx scripts/dump-catalogue.ts` to refresh it, or TEST drifts.

**The purge is safe to re-run.** It's idempotent — a second run deletes nothing.

---

## Why prod is purged, not rebuilt

The obvious instinct is "make a brand-new project for production and copy the activities in". We
deliberately don't, for one concrete reason: **181 of your 277 activity photos live inside the current
project's storage bucket**, as absolute URLs:

```
https://dwjkfowhrrvdiqligxcj.supabase.co/storage/v1/object/public/activity-images/...
```

A new Supabase project gets a **new project ref**, so every one of those URLs would 404 on day one
unless the bucket were copied across and all 181 URLs rewritten. (The other 96 are external
visitemaurice.com links and would be fine.) Rebuilding prod also means re-creating admin logins,
rotating three env keys in Cloudflare, and re-adding Supabase auth redirect URLs — a lot of moving
parts, each a chance to ship a broken site.

Purging in place gets the same outcome — a production database with zero test data — while the photos,
the API keys, the auth redirect config and your admin logins all keep working untouched. The schema is
already correct (it's kept in sync by `catch-up.sql`, guarded by `catch-up-parity.test.ts`), so a
"pristine rebuild" buys nothing you don't already have.

The one thing a rebuild _would_ have given you for free is rotated Supabase keys. If you want that,
rotate them directly instead: **Project Settings → API → rotate the `anon` / `service_role` keys**,
then update Cloudflare — no data migration required.
