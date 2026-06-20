# gytm-cron — scheduled-task Worker

Cloudflare **Pages has no built-in cron**, so this tiny standalone **Worker** runs GYTM's two background
jobs on a timer by calling the Pages app's protected internal endpoints:

| Schedule | Endpoint | What it does |
|---|---|---|
| every 2 min | `POST /api/v1/internal/notifications/drain` | sends queued booking-confirmation emails (via Resend) |
| every 5 min | `POST /api/v1/internal/maintenance` | releases expired 30-min seat holds, expires abandoned bookings, rolls the availability window forward |

Both endpoints require the shared `INTERNAL_TASK_SECRET`, which this Worker sends as the
`x-internal-secret` header.

## Deploy (one-time, from the repo root)

```bash
# 1. Deploy the Worker (creates "gytm-cron" in your Cloudflare account, with the cron triggers)
npx wrangler deploy --config workers/cron/wrangler.toml

# 2. Set the secret — paste the SAME value you used for INTERNAL_TASK_SECRET on the Pages project
npx wrangler secret put INTERNAL_TASK_SECRET --config workers/cron/wrangler.toml
```

That's it — the jobs now run automatically forever. (You can also do this in the dashboard:
**Workers & Pages → Create → Worker**, paste `src/index.js`, then **Settings → Variables** for
`SITE_URL` + the `INTERNAL_TASK_SECRET` secret, and **Settings → Triggers → Cron Triggers** for the two
schedules.)

## Verify it works

- **Logs:** `npx wrangler tail gytm-cron` — you'll see a `[cron] POST … -> 200` line every couple of minutes.
- **Dashboard:** Workers & Pages → `gytm-cron` → it lists the next/last cron runs.
- **Manual fire:** the Worker's URL responds `gytm-cron: alive` to a GET (proves it deployed); a manual
  "Trigger" from the dashboard runs both jobs once.

## Notes

- `SITE_URL` lives in `wrangler.toml`; change it there (and redeploy) if the domain changes.
- `INTERNAL_TASK_SECRET` is a **secret** — it is never committed; it's set via `wrangler secret put`.
- Schedules are UTC; cadence (every 2/5 min) is timezone-independent. Tune the `crons` array in
  `wrangler.toml` if you want them more/less frequent.
