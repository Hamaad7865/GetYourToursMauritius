/**
 * Local email drain — sends everything pending in notification_outbox through the dev server,
 * exactly like the cron Worker's 2-minute run does on the deployed site. Locally there is no
 * cron, so run this yourself after any action that should send email:
 *
 *   node scripts/sandbox/drain-emails.mjs
 *
 * Runs the drain twice (the endpoint batches oldest-first, and permanent failures occupy the
 * front of the queue). Reads INTERNAL_TASK_SECRET from .env.local; prints only counts.
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const port = env.PORT ?? 3321;
for (let i = 0; i < 2; i += 1) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/internal/notifications/drain`, {
    method: 'POST',
    headers: { 'x-internal-secret': env.INTERNAL_TASK_SECRET },
  });
  console.log(`drain ${i + 1}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
