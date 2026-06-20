/**
 * GYTM scheduled-task runner — a tiny companion Worker.
 *
 * Cloudflare Pages has no native cron, so this separate Worker fires on Cron Triggers and pings the
 * Pages app's protected internal endpoints on a timer:
 *   - every 2 min  → POST /api/v1/internal/notifications/drain   (send queued booking emails via Resend)
 *   - every 5 min  → POST /api/v1/internal/maintenance           (release expired holds + roll availability)
 *
 * Auth: the endpoints require the shared INTERNAL_TASK_SECRET, sent here as the `x-internal-secret` header.
 *
 * Config lives in wrangler.toml: the `SITE_URL` var, and the INTERNAL_TASK_SECRET *secret* set via
 * `wrangler secret put` (never committed). The matched cron string arrives as `event.cron`.
 */

const DRAIN_CRON = '*/2 * * * *';
const MAINTENANCE_CRON = '*/5 * * * *';

const DRAIN_PATH = '/api/v1/internal/notifications/drain';
const MAINTENANCE_PATH = '/api/v1/internal/maintenance';

/** POST one internal endpoint with the shared secret; logs the outcome (visible in `wrangler tail`). */
async function ping(env, path) {
  const url = `${env.SITE_URL.replace(/\/+$/, '')}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-secret': env.INTERNAL_TASK_SECRET },
  });
  const body = await res.text();
  const line = `[cron] POST ${path} -> ${res.status} ${body.slice(0, 200)}`;
  if (res.ok) console.log(line);
  else console.error(line);
  return res.ok;
}

const worker = {
  async scheduled(event, env) {
    if (!env.SITE_URL || !env.INTERNAL_TASK_SECRET) {
      console.error('[cron] missing SITE_URL or INTERNAL_TASK_SECRET — nothing to run');
      return;
    }

    const tasks = [];
    if (event.cron === MAINTENANCE_CRON) tasks.push(ping(env, MAINTENANCE_PATH));
    if (event.cron === DRAIN_CRON) tasks.push(ping(env, DRAIN_PATH));
    // Manual trigger (`wrangler dev` / dashboard "Trigger") sends no matching cron — run both then.
    if (tasks.length === 0) tasks.push(ping(env, MAINTENANCE_PATH), ping(env, DRAIN_PATH));

    // allSettled so one failing endpoint never prevents the other from running.
    await Promise.allSettled(tasks);
  },

  /** A trivial GET so you can confirm the Worker is deployed (does nothing, exposes no secret). */
  async fetch() {
    return new Response('gytm-cron: alive. Jobs run on cron triggers, not on request.', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  },
};

export default worker;
