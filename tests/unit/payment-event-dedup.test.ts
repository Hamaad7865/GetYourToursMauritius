import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The ledger's idempotency key must distinguish a provider's PENDING notification from its SUCCESSFUL
 * one when both carry the same transaction id.
 *
 * append_payment_event absorbs a webhook with
 *   `insert into payment_events … on conflict (<key>) do nothing`
 * so the conflict target IS the idempotency rule. It shipped as (payment_id, provider_event_id),
 * which does not include the event type. Peach reuses one transaction id across the Pending and the
 * Successful webhook for a payment, so the Successful collided with the already-stored Pending and was
 * silently dropped:
 *
 *   • the ledger never credited the money — `v_paid` stayed 0, so the booking was never confirmed;
 *   • no error surfaced, so reconcile.ts returned `confirmed: true` for a payment the database had
 *     just discarded — success was REPORTED while nothing was recorded;
 *   • the booking stayed payment_pending and the 30-minute sweep expired it and resold the seat,
 *     with the customer's money taken.
 *
 * Adding `type` keeps genuine idempotency (a retried Successful with the same id still lands once)
 * while letting the two DIFFERENT events coexist.
 *
 * This scans every migration in order and checks the LAST definition, because that is what production
 * actually runs: this repo has been bitten before by a late migration silently reverting an earlier
 * guard, and a test pinned to one file would not notice.
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const CONFLICT = /on conflict \(payment_id, provider_event_id([^)]*)\) do nothing/g;

/** Every `on conflict (payment_id, provider_event_id…)` in migration order — last wins in prod. */
function conflictTargets(): { file: string; target: string }[] {
  const out: { file: string; target: string }[] = [];
  for (const name of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    for (const m of sql.matchAll(CONFLICT)) out.push({ file: name, target: m[0] });
  }
  return out;
}

describe('payment_events idempotency key', () => {
  const targets = conflictTargets();

  it('finds the ledger insert (guards against a broken scan)', () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  it('dedups on the event TYPE as well as the provider id — in the definition that ships', () => {
    const last = targets[targets.length - 1]!;

    expect(
      last.target,
      `The last append_payment_event definition (${last.file}) dedups without the event type, so a ` +
        `provider Successful sharing a transaction id with an earlier Pending is discarded and the ` +
        `payment is never credited.`,
    ).toContain('type');
  });

  it('keeps the same rule in catch-up.sql, which provisions a drifted database', () => {
    const catchUp = readFileSync(join(process.cwd(), 'supabase', 'catch-up.sql'), 'utf8');
    const found = [...catchUp.matchAll(CONFLICT)];

    expect(found.length, 'catch-up.sql no longer carries the ledger insert').toBeGreaterThan(0);
    expect(
      found[found.length - 1]![0],
      'catch-up.sql would re-create the ledger without the type-aware dedup key',
    ).toContain('type');
  });

  it('backs the conflict target with a matching unique constraint', () => {
    // `on conflict (a, b, c)` needs a unique index on exactly (a, b, c) or Postgres raises
    // "no unique or exclusion constraint matching the ON CONFLICT specification" — which would take
    // down every webhook, so the index change and the function change must ship together.
    const all = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
      .join('\n');

    expect(all).toMatch(
      /unique \(payment_id, provider_event_id, type\)|payment_id, provider_event_id, type\)/,
    );
  });
});
