import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * Regression guard for the SECURITY DEFINER execute-grant leak (20260814000000).
 *
 * These functions trust their EXECUTE grant for authorization (append_payment_event has no in-function
 * caller guard at all — a forged 'paid' event would self-confirm a booking). A `revoke from public`
 * does NOT remove Supabase's default anon/authenticated grants, so each must be revoked from those roles
 * explicitly. This asserts the ACTUAL privilege (has_function_privilege), not just the SQL text, so a
 * future function added without an explicit revoke — or a re-leak — fails CI.
 */
const LOCKED = [
  'append_payment_event(uuid, text, text, bigint, timestamp with time zone, jsonb)',
  'release_hold(uuid)',
  'run_booking_maintenance(jsonb)',
  'expire_holds()',
  'enqueue_booking_notification()',
  'claim_notifications(jsonb)',
  'mark_notification(jsonb)',
  // Both were revoked `from public` ONLY, so Supabase's direct anon/authenticated grants survived and
  // they were live-callable with the public anon key (verified against production 2026-07-20). Neither
  // has an in-function caller guard: api_booking_receipt returns a full booking DTO — customer name,
  // email, phone, pickup address, charge amount, provider reference — and api_pending_payment_checkouts
  // ENUMERATES pending bookings, so it needs no id at all. Chained, the second one feeds the first.
  'api_booking_receipt(jsonb)',
  'api_pending_payment_checkouts(jsonb)',
  'api_enqueue_review_invites(jsonb)',
  // The error-log pair (20260831000000). api_log_error is called on every failure, so an open grant
  // would be a free, unauthenticated write channel into the operator's diagnostics; api_purge_error_logs
  // DELETES, which would let anyone erase the record of what they just broke.
  'api_log_error(jsonb)',
  'api_purge_error_logs(jsonb)',
  // Mints a PAYABLE booking from a quote id alone (20260909000000) — no in-function caller guard, so
  // an open grant would let any caller mint bookings (and enumerate quotes by probing ids).
  'api_convert_quote(jsonb)',
  // The quote anonymize trigger (20260909000000). Listed here, not only in the per-migration loop in
  // quotes-schema.test.ts, because THIS is the guard that survives: it is the one a future migration
  // adding a definer gets measured against, and dropping `authenticated` from a revoke is the mistake
  // this repo has now made three times. A trigger function belongs here for the same reason
  // enqueue_booking_notification() does — trigger execution never checks the caller's EXECUTE, so the
  // grant buys the function nothing and costs it nothing to remove.
  'quotes_redact_lines()',
  // The quote checkout pair (20260911000000). `create_payment` is the SHARED body behind
  // api_create_payment and api_create_quote_payment, and its boolean argument is the caller-identity
  // check itself — anyone able to call it directly could pass `false` and open a payable session for a
  // booking they do not own. api_create_quote_payment is that bypass already applied: authorization for
  // a quote is the LINK TOKEN, verified in the route long before SQL, so the function is only safe
  // while nothing reachable from a browser can reach it. Both are exactly the shape of definer whose
  // EXECUTE grant IS its authorization, which is why `authenticated` has to be named in the revoke.
  'create_payment(jsonb, boolean)',
  'api_create_quote_payment(jsonb)',
  // An ACCOUNT-EXISTENCE ORACLE over auth.users (20260909000000): it answers "is there a confirmed
  // account at this address?". The privilege is already correct in the migration — this row is the
  // regression guard, so re-opening it later fails CI instead of shipping. That distinction is the whole
  // point of this list: every entry below was correct on the day it was written too.
  'quote_owner_for_email(text)',
];

describe('internal SECURITY DEFINER functions are locked to service_role', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('anon + authenticated cannot EXECUTE them; service_role can', async () => {
    for (const sig of LOCKED) {
      const { rows } = await db.pg.query<{ anon: boolean; auth: boolean; sr: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as sr`,
        [`public.${sig}`],
      );
      const r = rows[0]!;
      expect(r.anon, `anon can execute ${sig}`).toBe(false);
      expect(r.auth, `authenticated can execute ${sig}`).toBe(false);
      expect(r.sr, `service_role cannot execute ${sig}`).toBe(true);
    }
  });

  it('used_capacity stays executable by anon/authenticated (SECURITY INVOKER callers need it)', async () => {
    const { rows } = await db.pg.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.used_capacity(uuid)', 'EXECUTE') as anon,
              has_function_privilege('authenticated', 'public.used_capacity(uuid)', 'EXECUTE') as auth`,
    );
    expect(rows[0]!.anon).toBe(true);
    expect(rows[0]!.auth).toBe(true);
  });
});
