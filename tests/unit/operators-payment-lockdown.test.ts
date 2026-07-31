import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two privilege holes found on 2026-07-31 and closed by 20260901000900. Both are the kind a later
 * migration can silently undo (this repo has been bitten by exactly that), so the whole migration
 * directory is scanned in order and the LAST word wins — the same shape as the definer-grant-lockdown
 * guard.
 *
 *  1. `operators` was world-readable. Proven live with only the public anon key:
 *     GET /rest/v1/operators?select=payout_details,contact_email,phone → 200. Nothing sensitive was
 *     populated that day, which is exactly why it needed closing BEFORE real payout details are
 *     entered in /admin.
 *  2. `authenticated` held DELETE on `payments`, and payment_events cascades from it — so a staff
 *     JWT could erase a payment and its entire ledger trail.
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

const allSql = (): string =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

/** Last statement matching `re` across the migrations in order — what production actually ends up with. */
function lastMatch(re: RegExp): string | null {
  const found = [...allSql().matchAll(re)];
  return found.length ? found[found.length - 1]![0] : null;
}

describe('operators is not publicly readable', () => {
  it('revokes the anon select grant', () => {
    expect(
      lastMatch(/(revoke|grant)\s+select\s+on\s+operators\s+(from|to)\s+[^;]*;/gi),
      'the last operators SELECT grant/revoke must be a revoke from anon — otherwise payout_details, ' +
        'contact_email and phone are readable by anyone holding the public key',
    ).toMatch(/revoke\s+select\s+on\s+operators\s+from\s+[^;]*anon/i);
  });

  it('does not leave a permissive read-everything policy behind', () => {
    // `operators_read … using (true)` made every row readable by whoever held a table grant.
    const last = lastMatch(
      /(create|drop)\s+policy\s+(if exists\s+)?operators_read\s+on\s+operators/gi,
    );
    expect(last, 'operators_read was never dropped').not.toBeNull();
    expect(last, 'operators_read must end DROPPED, not re-created').toMatch(/drop\s+policy/i);
  });
});

describe('the payment ledger is append-only', () => {
  it('revokes delete on payments from authenticated', () => {
    expect(
      lastMatch(/(revoke|grant)\s+[^;]*delete[^;]*\s+on\s+payments\s+(from|to)\s+[^;]*;/gi),
      'payment_events cascades from payments, so a staff JWT with DELETE can erase the audit trail',
    ).toMatch(/revoke[^;]*delete[^;]*from\s+[^;]*authenticated/i);
  });

  it('keeps service_role able to work (webhook, reconcile, cron)', () => {
    // Guards against over-correcting: the money path runs as service_role and must not be revoked.
    const sql = allSql();
    expect(sql).not.toMatch(/revoke[^;]*\bon\s+payments\s+from\s+[^;]*service_role/i);
  });
});
