# Operations — the owner's runbook

[← Handbook](../HANDBOOK.md)

No code in this page. This is what you can do yourself, and what to do when something goes wrong.

---

## Your two dashboards

- **Supabase** — the database. Where you run SQL and look up bookings.
- **Cloudflare** — the hosting. Two things live here: `bellemaretours` (the website) and `gytm-cron`
  (the background jobs).

**And one URL, which is the fastest way to know if anything is wrong:**

```
https://bellemaretours.com/api/v1/health?deep=true
```

If it says `"status":"ok"` — the site's configuration is healthy. If it says `"degraded"`, it **tells you
which check failed**. Always look here first.

---

## What you can change yourself, with no developer

All of this is in `/admin`:

| You want to change…                          | Where                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tours: photos, descriptions, options, prices | **Tours** → pick a tour                                                                                |
| Which dates a tour is bookable               | **Tours** → tour → **Availability**                                                                    |
| Any transfer or vehicle fare                 | **Pricing** (5 sections: sightseeing, road trips, transport add-on, airport transfers, hotel-to-hotel) |
| Rental cars & scooters                       | **Rental**                                                                                             |
| The order tour cards appear in               | **Tours** → filter to one category → drag them                                                         |
| A page's Google title & description          | **SEO** (18 pages)                                                                                     |
| Blog posts                                   | **Blog**                                                                                               |
| Redirect an old URL to a new one             | **Redirects**                                                                                          |
| Approve or reject a customer review          | **Reviews**                                                                                            |

Prices are typed in euros and take effect immediately — the server prices every new quote from those
rows.

> **A note for developers reading this:** because all of the above is in the database, **do not hardcode
> it in the code.** If you do, the owner's edit is silently ignored.

---

## Giving someone access

They must **sign up on the website first** (so their account exists). Then, in Supabase → SQL Editor:

```sql
update profiles set role = 'admin'
 where id = (select id from auth.users where email = 'them@example.com');
```

| Role      | What they get                                                                    |
| --------- | -------------------------------------------------------------------------------- |
| `admin`   | Everything                                                                       |
| `staff`   | Everything (same as admin in practice)                                           |
| **`seo`** | **SEO, Blog, Redirects, Tours (text & photos only), Places — and nothing else.** |

The `seo` role is for an **external SEO contractor**. They **cannot see bookings, customers, payments or
leads** — that's enforced by the database itself, not just by hiding menu items, so it holds even if they
go poking at URLs directly.

To revoke: set the role back to `'customer'`.

---

## Applying a database update

When a developer says _"re-run catch-up.sql"_:

1. Supabase → **SQL Editor** → New query.
2. Open `supabase/catch-up.sql` from the repo, copy the **entire file**, paste it, press **Run**.
3. It's safe to run as many times as you like.

**If it fails partway:** note the error, get it fixed, then **re-run the whole file from the top**. Don't
try to run "just the rest" — part of the script has already been applied and re-running is designed to be
safe.

---

# Troubleshooting

## A customer paid but the booking is not confirmed

Usually the settlement notification from Peach didn't arrive. **There is an automatic safety net** — the
background job re-checks Peach every 5 minutes for stuck bookings (looking back 4 hours) and confirms
the ones that really paid. So first: **wait 5–10 minutes**.

If it's still stuck:

1. Check the background job is actually running (see below). If it's dead, that's your answer.
2. In Supabase, find the booking by its reference. `status = 'payment_pending'` means no payment event
   was ever recorded.

> ⚠️ **Never mark a booking confirmed by hand in the database.** It looks like it works, but it skips the
> checks that verify the customer actually paid the full amount and that a seat is still available. Get
> the background job working instead — it's the only correct path.

## Nothing is emailing anyone

Booking confirmations, invoices and your own new-booking alerts are all sent by the background job. If
none are arriving, **the job is almost certainly dead.**

```bash
npx wrangler tail --config workers/cron/wrangler.toml
```

| What you see         | What it means                                                       |
| -------------------- | ------------------------------------------------------------------- |
| `-> 200` every 2 min | The job is fine — the problem is elsewhere (check `RESEND_API_KEY`) |
| `-> 401`             | The shared secret doesn't match between the website and the job     |
| `-> 503`             | `INTERNAL_TASK_SECRET` isn't set on the website at all              |
| Nothing at all       | The job isn't deployed, or has no schedule                          |

Emails are never lost — they queue up. Fix the job and the backlog sends.

## Tours say "no dates available"

Same cause: **the background job is dead.** The booking calendar is filled in ~6 months ahead by that
job. If it stops, the calendar doesn't break — it slowly empties from the far end inward until tours
appear fully booked.

This is the failure mode that hides the longest. Check the job the moment anything looks odd.

## Customer reviews aren't coming in

Same root cause as the other post-trip jobs: **the background job is dead.** Review-request emails
are **queued** by the same 5-minute maintenance sweep that reconciles payments and expires holds,
then **sent** by the same 2-minute job that sends every other queued email — if either is down, no
review requests go out. Check it the same way as in
[Nothing is emailing anyone](#nothing-is-emailing-anyone).

One more thing worth knowing: **every submitted review sits in the Reviews queue until you approve
it** — nothing a customer writes appears on the site automatically, by design.

## Seats appear taken but nobody booked them

When someone starts a checkout, their seat is held for 30 minutes and then released automatically. That
release does **not** depend on the background job — it's automatic. So if seats look stuck, it's more
likely a genuine booking. Check **Bookings** in `/admin`.

## Photo uploads fail silently

The Storage bucket was never created. A developer needs to run **step 3** of
`supabase/admin-setup.sql` once. (Step 1 of that file is destructive — it must not be run wholesale on a
live catalogue.)

## Nobody can pay

Almost always `NEXT_PUBLIC_SITE_URL` in the Cloudflare Pages settings. If it's missing or wrong, payments
**deliberately refuse to start** rather than sending customers to a broken page after they've paid.

`/api/v1/health` will say `siteUrlConfigured: false`.

## The whole site 500s

Check that the `nodejs_compat` compatibility flag is set on the Cloudflare Pages project, for **both**
Production and Preview. Without it, every page fails at runtime — on a build that succeeded.

---

## The background job (`gytm-cron`) — why it matters so much

It's a small Cloudflare Worker, **separate from the website**, that does five jobs on a timer:

1. Sends every queued email (every 2 minutes)
2. Confirms payments that got stuck (every 5 minutes)
3. Releases abandoned bookings
4. **Keeps the booking calendar filled ~6 months ahead**
5. Queues review-request emails for recently completed trips

**If it stops, the website keeps working perfectly.** Pages load, tours display, customers can browse.
Nothing looks wrong. But no email goes out, and the calendar quietly runs down.

That's why it deserves a real alert. In Cloudflare → Workers & Pages → `gytm-cron` you can see failed
invocations — the job is deliberately written to _fail loudly_ rather than exit quietly when it can't do
its work.

**It is not redeployed when a developer pushes code.** It has to be deployed on purpose.

---

## Before go-live — the config checklist

Code is not the blocker; configuration is. Confirm each of these:

- [ ] `NEXT_PUBLIC_SITE_URL` = `https://bellemaretours.com` in Cloudflare Pages
- [ ] `supabase/catch-up.sql` has been run on the production database
- [ ] `INTERNAL_TASK_SECRET` set in Pages **and** as the `gytm-cron` Worker secret — **same value**
- [ ] `gytm-cron` deployed, and `wrangler tail` shows `-> 200`
- [ ] Peach live credentials set, `PEACH_ENVIRONMENT=live`, webhook URL registered
- [ ] `RESEND_API_KEY` + `RESEND_FROM` set, and the sending domain verified in Resend
- [ ] `bookings@bellemaretours.com` (sends) and `info@bellemaretours.com` (receives) both work
- [ ] `curl https://bellemaretours.com/api/v1/health?deep=true` → **200, `"status":"ok"`**
- [ ] One real low-value test booking: card charged → booking confirmed → invoice email arrives

That last one exercises the entire money path in a single test. Do it.
