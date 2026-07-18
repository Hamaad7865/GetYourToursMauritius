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
