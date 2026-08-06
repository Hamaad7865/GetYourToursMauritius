# Maintenance — keeping it healthy over time

[← Handbook](../HANDBOOK.md)

Nothing here is urgent on any given day, which is exactly why it needs writing down. This chapter is
the recurring upkeep: what to check and how often, how to upgrade dependencies without breaking the
edge build, how to rotate secrets that live in two places at once, and what quietly expires.

---

## 1. The calendar

### Daily — 30 seconds

```bash
curl -s "https://bellemaretours.com/api/v1/health?deep=true"
```

`"status":"ok"` and you're done. Anything else names the failing check in the body.

### Weekly — five minutes

| Check                       | How                                                                                                                        | Looking for                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **The cron is alive**       | `npx wrangler tail --config workers/cron/wrangler.toml`                                                                    | `-> 200` every couple of minutes                   |
| **What broke this week**    | `select event, route, count(*) from error_logs where created_at > now() - interval '7 days' group by 1,2 order by 3 desc;` | Repeats, not singletons                            |
| **Availability is rolling** | `/admin` → any tour → Availability                                                                                         | Dates ~6 months out, not thinning from the far end |
| **Bookings look sane**      | `/admin` → Bookings                                                                                                        | Nothing stuck in `payment_pending` for hours       |
| **Review queue**            | `/admin` → Reviews                                                                                                         | Submissions waiting on approval                    |

The availability check is the one people skip and shouldn't. If the cron dies, the site does not
break — the calendar just empties inward over months until tours look fully booked for no visible
reason. It is the failure mode that hides the longest.

### Monthly — half an hour

- **Deploy provenance.** `releaseSha` from the health endpoint vs `git rev-parse HEAD` on `main`.
  A drift means a release failed and nobody noticed.
- **Stuck money.** Anything with `settlement_review_at` set has been quarantined rather than credited
  and needs a human:

  ```sql
  select ref, status, settlement_review_at from bookings
  where settlement_review_at is not null order by settlement_review_at desc;
  ```

- **Dependency check.** `npm outdated` — read §2 before acting on it.
- **`npm audit`.** Triage, don't reflexively `--force`; see §2.
- **Owner-editable content drift.** `/admin` → SEO → Health check panel: missing, thin, overlong or
  duplicate titles and descriptions, computed from our own data.

### Quarterly

- **Restore rehearsal.** Confirm in Supabase → Database → Backups that you have a recent PITR point
  **and** that you know how to use it. An untested backup is a rumour.
- **Access review.** Who has `admin`, `staff` or `seo`?

  ```sql
  select p.role, u.email from profiles p join auth.users u on u.id = p.id
  where p.role <> 'customer' order by p.role;
  ```

  Revoke by setting the role back to `'customer'`. Pay particular attention to the `seo` role — it
  exists for an external contractor, and the GDPR argument for it depends on that person still being
  engaged.

- **The Peach smoke test.** One real low-value booking, end to end: card charged → booking confirmed →
  invoice email arrives. It exercises the entire money path in a single test, and it is the only check
  that covers the parts no monitor sees.

### Annually

- Domain renewal, and the DNS records in [domain-cutover-runbook.md](../domain-cutover-runbook.md).
- Legal pages in [`docs/legal/`](../legal/) — review against what the site actually does now.
- Image licences (§6).

---

## 2. Dependencies

### The pins, and why they exist

Four things in `package.json` are pinned deliberately. Bumping one of them without reading this will
cost you an afternoon.

| Pinned                | At        | Why                                                                                                                    |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `next`                | `15.5.19` | The latest patched 15.5.x. `@cloudflare/next-on-pages` caps its peer range at `<=15.5.2`, which is why `.npmrc` exists |
| `react` / `react-dom` | `19.0.0`  | Matched to the Next pin                                                                                                |
| `wrangler`            | `4.112.0` | Exact, because the deploy pipeline's behaviour depends on it                                                           |
| `.npmrc`              | —         | `legacy-peer-deps=true`. **Load-bearing.** Delete it and `npm install` fails outright on the peer conflict above       |

`@cloudflare/next-on-pages` is deprecated upstream. The migration off it is planned but explicitly not
part of the current pipeline — see [`opennext-migration-plan.md`](../opennext-migration-plan.md).
Until that lands, treat the Next major version as frozen.

### The upgrade procedure

Upgrade **one thing at a time**, and never batch a framework bump with a feature.

```bash
npm outdated
npm install <package>@<version>
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
git push origin main   # then WATCH CI — the Edge bundle step is the one that matters
```

The last point is the whole game: **you cannot build the deployable artifact on Windows**
(`pages:build` dies with `spawn npx ENOENT`), so a green local build proves nothing about whether the
upgrade survives the Cloudflare bundler. CI's final _Edge bundle_ step is the only trustworthy gate,
and dependency upgrades are precisely the change class most likely to break it.

Upgrade **freely**: `prettier`, `eslint`, `vitest`, `@types/*`, `tsx`, `playwright`.
Upgrade **carefully, alone, and watch CI**: `next`, `react`, `@cloudflare/next-on-pages`, `wrangler`,
`@supabase/supabase-js`, `zod` (a major would touch every schema and `openapi.json`).

### `npm audit`

Read the advisory before acting. Most findings will be in the dev toolchain, which never ships to a
customer. Never run `npm audit fix --force` on this repo — it will happily "fix" the Next pin and
break the edge build. Fix real, reachable, runtime vulnerabilities by hand.

---

## 3. Secrets and where they live

There is no single place. Every secret lives in one to three of: **Cloudflare Pages** (the website),
**the `gytm-cron` Worker**, **GitHub Actions secrets** (the release pipeline), and your local
`.env.local`.

| Secret / var                                                  | Lives in                                                                                                | Rotation note                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `INTERNAL_TASK_SECRET`                                        | **Pages + the cron Worker**                                                                             | **Must match.** Mismatch ⇒ cron gets `401`; unset on Pages ⇒ `503`                |
| `NEXT_PUBLIC_SITE_URL`                                        | Pages — and mirrored as `SITE_URL` in `workers/cron/wrangler.toml` + the `CANONICAL_HOST` repo variable | `release.yml` asserts these agree and fails the release if not                    |
| `SUPABASE_SERVICE_ROLE_KEY`                                   | Pages, GitHub Actions, `.env.local`                                                                     | Full RLS bypass. Rotate everywhere in one sitting                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                               | Pages, `.env.local`                                                                                     | Public by design — but see the definer-grant landmine                             |
| `SUPABASE_JWT_SECRET`                                         | Pages                                                                                                   | —                                                                                 |
| `PEACH_CLIENT_ID` / `_SECRET` / `_MERCHANT_ID` / `_ENTITY_ID` | Pages                                                                                                   | Changing environment means changing all four together                             |
| `PEACH_WEBHOOK_SECRET`                                        | Pages — **and registered in the Peach dashboard**                                                       | Rotating one side alone silently breaks HMAC verification                         |
| `PEACH_ENVIRONMENT` / `PEACH_EXPECT_LIVE`                     | Pages                                                                                                   | `PEACH_EXPECT_LIVE=true` arms the go-live gate in `/api/v1/health`                |
| `RESEND_API_KEY` / `RESEND_FROM`                              | Pages                                                                                                   | `RESEND_FROM` is `bookings@`; **never** collapse it into `info@`                  |
| `SEND_EMAIL_HOOK_SECRET` / `AUTH_EMAIL_FROM`                  | Pages — **and the Supabase auth hook**                                                                  | Set + redeploy **before** enabling the hook, or auth emails break                 |
| `OWNER_NOTIFY_EMAIL` / `OWNER_WHATSAPP_TO` / `TELEGRAM_*`     | Pages                                                                                                   | Owner contact details live **only** here, never in the database                   |
| `WHATSAPP_*`                                                  | Pages — **and Meta's app config**                                                                       | Set `VERIFY_TOKEN` + `APP_SECRET` and redeploy **before** clicking Meta's Verify  |
| `GSC_SERVICE_ACCOUNT_JSON` / `GSC_SITE_URL`                   | Pages                                                                                                   | Unset ⇒ the Search-performance panel just prints setup steps; nothing else breaks |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`              | GitHub Actions                                                                                          | The deploy credentials                                                            |

**The rule for every paired secret: change both sides, then redeploy, then verify.** Half a rotation
is worse than none — the failure is silent and delayed.

After rotating anything: `curl .../api/v1/health?deep=true`, then watch one cron tick.

> ✅ **`.env.example` mirrors the schema** (re-synced 2026-07-31). It now carries all 44 variables that
> `src/lib/config/env.ts` validates, each tagged `[required]` / `[default: x]` / `[optional]`, plus a
> clearly-fenced tail section for the four read by code but absent from the schema
> (`NEXT_PUBLIC_GSC_VERIFICATION`, `ENABLE_PREVIEW_FALLBACK`, `SUPABASE_DB_URL`, `PEXELS_API_KEY`).
> `MUR_PER_EUR` was deleted — no code ever read it.
>
> The Zod schema is still the authoritative inventory: **add a variable there and add it to
> `.env.example` in the same commit.** Note "optional to Zod" ≠ "optional in production" — every field
> in the schema is optional or defaulted so the build and test suite run with no real accounts, which
> is exactly why the `[required]` tags exist. They mean the seven readiness gates in
> `/api/v1/health`, not Zod.
>
> `.dev.vars.example` is a deliberate subset for `wrangler pages dev`, not a second inventory — copy
> extra variables across from `.env.example` when a local edge run needs them.

---

## 4. Data housekeeping

Most of it is automatic. Know which is which, because everything automatic here depends on the cron.

| Data                    | Housekeeping                                  | Automatic?                                              |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `error_logs`            | Deleted after 30 days                         | ✅ cron (a failure here alone won't turn it red)        |
| Seat holds              | Expire after 30 minutes                       | ✅ **and not cron-dependent** — capacity is a predicate |
| `notification_outbox`   | Drained every 2 minutes                       | ✅ cron. Nothing is lost if it stops — it queues        |
| Availability            | Rolled forward 185 days                       | ✅ cron. **Stops silently if the cron dies**            |
| EUR→MUR rate            | Refreshed on a timer                          | ✅ cron                                                 |
| Bookings, payments      | Never deleted                                 | ❌ by design — this is the financial record             |
| Cloudflare Workers Logs | 7-day retention, 100% sampling on `gytm-cron` | ✅ platform                                             |
| GDPR erasure            | Anonymise-with-retention, on request          | ❌ manual — see the GDPR flow in `/admin`               |

The distinction that matters in an incident: **holds free themselves; availability does not create
itself.** A dead cron cannot cause stuck capacity, but it will quietly empty the calendar.

---

## 5. Backups, and the rule that makes them matter

Backups live in Supabase → Database → Backups (PITR). Cloudflare holds no state worth restoring — the
site is rebuilt from `main` and the cron Worker from the same commit.

> **Before any risky SQL against production — a bulk `update`, a `delete`, a `drop`, the ledger
> reconciliation workflow — confirm a recent restore point first.** `supabase/catch-up.sql` runs
> **mostly in autocommit**: a failure partway through leaves a partial state, and there is no
> transaction to roll back. That property is documented in
> [database.md](database.md#-catch-upsql-is-only-half-transactional), and it is the reason
> `reconcile-supabase-ledger.yml` demands you type a confirmation string.

Undoing a bad migration is a forward-only exercise here — never edit a migration that has already run.
The procedure is in [database.md → undoing a bad migration](database.md#undoing-a-bad-migration).

---

## 6. Things that expire

The quiet category. Nothing monitors these; they simply stop working one day.

- **Image licences.** The home hero (`public/hero/hero-blue.jpg`) and the airport hero are known
  outstanding items — one carries a watermark, one is an unlicensed comp. Both need licensed files
  swapped in at the same paths. This is a **legal** exposure, not a cosmetic one.
- **The domain**, and the DNS records the mail flow depends on.
- **Peach credentials**, when the merchant account changes environment or is re-onboarded.
- **The Meta WhatsApp access token**, which is not permanent.
- **The GSC service account key**, if your Google Cloud project rotates it.
- **DPAs and SCCs** with each processor (Supabase, Cloudflare, Resend, Peach, Google), plus the EU
  representative appointment — see [`docs/legal/`](../legal/).
- **The cookie-consent posture.** It is notice-only, and that is defensible **only** because there are
  zero trackers. Add any analytics and it must become per-category gating. Re-check this whenever a
  third-party script is proposed.

---

## 7. Handing this over

If someone new takes over, this is the order that works:

1. [HANDBOOK.md](../HANDBOOK.md) — the 60-second orientation and the five rules.
2. [Operations](operations.md) if they're the operator; [Architecture](architecture.md) if they write code.
3. [Landmines](landmines.md), in full, before the first change. It is scar tissue, not trivia.
4. [Debugging](debugging.md) — bookmark the evidence order and the symptom index.
5. This page, so the slow-moving things don't rot.

Then give them access in this order: the repo, Cloudflare, Supabase, Peach, Resend — and have them do
one real end-to-end test booking on day one. It teaches more about this system than any document here.

**Keep this handbook true.** When you change how something works, change the page that describes it in
the same commit. A handbook that is 80% accurate is more dangerous than none, because people stop
checking the parts they think they know.
