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

/**
 * POST one internal endpoint with the shared secret, retrying briefly on failure (a transient blip
 * shouldn't skip a whole tick). Logs each outcome (visible in `wrangler tail` / Logpush) and RESOLVES
 * to ok/not-ok so the scheduled handler can decide whether to fail the invocation.
 */
async function ping(env, path, attempts = 3) {
  const url = `${env.SITE_URL.replace(/\/+$/, '')}${path}`;
  let lastLine = `[cron] POST ${path} -> no attempt`;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-internal-secret': env.INTERNAL_TASK_SECRET },
      });
      const body = await res.text();
      lastLine = `[cron] POST ${path} -> ${res.status} ${body.slice(0, 200)}`;
      if (res.ok) {
        console.log(lastLine);
        return true;
      }
      console.error(`${lastLine} (attempt ${i + 1}/${attempts})`);
    } catch (err) {
      lastLine = `[cron] POST ${path} -> threw: ${err instanceof Error ? err.message : err}`;
      console.error(`${lastLine} (attempt ${i + 1}/${attempts})`);
    }
    // Short linear backoff between attempts; skip the wait after the final try.
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return false;
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

    // allSettled so one failing endpoint never prevents the other from running. But DON'T swallow the
    // result: if any task ultimately failed (after its retries), throw so Cloudflare marks this cron
    // invocation as failed — that shows up in the dashboard and can drive an alert, instead of a stuck
    // drain/maintenance silently looking healthy forever.
    const results = await Promise.allSettled(tasks);
    const failed = results.filter((r) => r.status === 'rejected' || r.value === false).length;
    if (failed > 0) {
      throw new Error(
        `[cron] ${failed}/${results.length} task(s) failed after retries — see logs above`,
      );
    }
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
