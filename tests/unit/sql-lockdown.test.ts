import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guard for the public-mutation lockdown, asserting the statements exist in
 * supabase/catch-up.sql — the script the OWNER actually runs against the live DB (the PGlite harness
 * applies migrations, which tests/integration/rpc-grants.test.ts proves with real ACL checks; this file
 * keeps catch-up.sql honest, since nothing executes it in CI).
 *
 * Both halves of the revoke matter and BOTH must name their targets:
 *  - `from public` — Postgres implicitly grants EXECUTE to PUBLIC at create-function time, and
 *    anon/authenticated are PUBLIC members, so without this the member-role revokes are ineffective
 *    (privileges are additive). This was the first lockdown's miss, confirmed live via pg_proc.proacl.
 *  - `from anon, authenticated` — stock Supabase ALTER DEFAULT PRIVILEGES also hands each new function
 *    a DIRECT grant to the member roles, which a bare `from public` would not strip.
 */
const catchUp = readFileSync(join(process.cwd(), 'supabase', 'catch-up.sql'), 'utf8');

describe('public mutation lockdown (catch-up.sql)', () => {
  const norm = catchUp.replace(/\s+/g, ' ');

  it.each([
    'revoke execute on function api_rate_limit(jsonb) from public, anon, authenticated;',
    'revoke execute on function api_create_hold(jsonb) from public, anon, authenticated;',
    'revoke execute on function create_hold(uuid, int, text) from public, anon, authenticated;',
    'revoke execute on function api_capture_lead(jsonb) from public, anon, authenticated;',
    'revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean) from public, anon, authenticated;',
    'revoke execute on function api_record_payment_charge(jsonb) from public, anon, authenticated;',
    'revoke execute on function api_record_payment_checkout(jsonb) from public, anon, authenticated;',
    'revoke execute on function api_book(jsonb) from public, anon;',
    'revoke execute on function api_create_payment(jsonb) from public, anon;',
    'revoke execute on function api_erase_user(jsonb) from public;',
  ])('revokes: %s', (stmt) => {
    expect(norm).toContain(stmt.replace(/\s+/g, ' '));
  });

  it.each([
    'grant execute on function api_create_hold(jsonb) to service_role;',
    'grant execute on function api_record_payment_charge(jsonb) to service_role;',
    'grant execute on function api_book(jsonb) to authenticated, service_role;',
    'grant execute on function api_create_payment(jsonb) to authenticated, service_role;',
  ])('restores the intended callers: %s', (stmt) => {
    expect(norm).toContain(stmt.replace(/\s+/g, ' '));
  });

  it('drops the open leads_insert policy and revokes the table INSERT grant', () => {
    expect(norm).toContain('drop policy if exists leads_insert on leads;');
    expect(norm).toContain('revoke insert on leads from anon, authenticated;');
  });
});
