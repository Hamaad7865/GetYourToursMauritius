# OpenNext migration plan (review item 13 — staged, NOT same-day)

**Status: planned, deliberately not started.** Written 2026-07-17 while closing the 13-item
external review. Items 1–12 were code fixes; this one is a platform move, and rushing a platform
move in the same change-set as twelve behaviour fixes is how production breaks. It gets its own
effort with its own verification.

## The problem (verified)

- `@cloudflare/next-on-pages@1.13.16` supports `next >=14.3.0 <=15.5.2`; the app pins
  `next@15.5.19` for security patches. `npm ls` exits `ELSPROBLEMS` (`next@15.5.19 invalid`), and
  only `.npmrc`'s `legacy-peer-deps=true` lets install succeed (see `docs/handbook/landmines.md`).
- Cloudflare's own guidance now recommends `@opennextjs/cloudflare` on **Workers** for new Next.js
  apps; next-on-pages is in maintenance. Every Next upgrade widens the gap.
- Concretely: we run production on an adapter that does not claim to support our framework
  version. CI's `pages:build` + e2e smoke keep it honest today, but each `next` bump is a gamble.

## What migrating actually changes

| Area            | Today (next-on-pages / Pages)                                | After (@opennextjs/cloudflare / Workers)                                                                                                   |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Build           | `npx @cloudflare/next-on-pages` (CI step `pages:build`)      | `npx opennextjs-cloudflare build`                                                                                                          |
| Deploy          | Pages git-integration auto-deploy on push to main            | `wrangler deploy` (CI step or Workers Builds git integration)                                                                              |
| Runtime         | edge runtime, `export const runtime = 'edge'` per route      | Node.js runtime on `workerd` — the `runtime = 'edge'` exports (≈ every route) must be REMOVED                                              |
| Custom domains  | Pages project custom domains (already on bellemaretours.com) | Workers custom domains — re-attach both hosts                                                                                              |
| Env/secrets     | Pages project settings                                       | Worker settings / `wrangler.toml` + `wrangler secret put`                                                                                  |
| Preview deploys | `<hash>.getyourtoursmauritius.pages.dev`                     | Workers preview URLs (different shape — the canonical-host redirect in `next.config.mjs` matches exact hosts, so previews stay unaffected) |
| Static assets   | Pages CDN                                                    | Workers static assets (bundled)                                                                                                            |
| Cron worker     | separate `gytm-cron` Worker                                  | unchanged — but its SITE_URL target must stay correct through the cutover                                                                  |

Edge-runtime removal is the real migration: the codebase was written edge-safe (Web Crypto, fetch,
no Node built-ins), which makes it _compatible_ with Node runtime, but every route exporting
`runtime = 'edge'` needs the export dropped and re-verifying (pdf-lib invoice generation, Supabase
client, Peach HMAC, the logger's request-id plumbing).

## Order of work (each step green before the next)

1. **Branchless spike, local only**: add `@opennextjs/cloudflare`, run `opennextjs-cloudflare
build` + `wrangler dev`, inventory what breaks. No deploy.
2. **Remove `runtime = 'edge'` exports** behind the build working locally; full vitest + e2e
   against the `workerd` preview (`wrangler dev`), not `next dev`.
3. **CI**: replace the `pages:build` step with the OpenNext build; keep the 6-step gate shape.
   (Bonus: the OpenNext build runs on Windows, un-breaking local full-gate runs.)
4. **Deploy to a STAGING Worker** (no custom domain), smoke the money path end-to-end against the
   test DB: availability → hold → book → pay (Peach sandbox) → webhook/sync → confirmed → invoice.
5. **Cutover**: attach `bellemaretours.com` + `www` to the Worker, watch health + a real sandbox
   booking, keep the Pages project intact for instant rollback (re-attach domains back).
6. **Decommission** the Pages project only after a quiet week; drop `.npmrc`'s
   `legacy-peer-deps` and `@cloudflare/next-on-pages`.

## Prerequisites before starting

- Items 1–12 of the 2026-07-17 review deployed and stable in production.
- Owner has run `supabase/catch-up.sql` (the review batch adds `20260812000000`).
- A quiet booking window (not launch week) — the cutover step swaps what serves the money path.

## Explicitly out of scope for the migration

- The Pages project name (`getyourtoursmauritius`) — cosmetic, and pages.dev URLs die with the
  platform move anyway.
- Any behaviour change. The migration lands byte-identical pages or it doesn't land.
