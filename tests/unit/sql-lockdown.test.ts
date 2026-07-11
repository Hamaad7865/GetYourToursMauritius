import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guard for the public-mutation lockdown. PGlite runs as the superuser, so it does NOT
 * enforce role grants — an integration test can't prove `anon` is denied. Instead we assert the
 * revoke/drop statements are present in supabase/catch-up.sql (the live-DB apply script), so a future
 * create-or-replace of one of these functions can't silently re-open it to the anon key. Stock Supabase
 * hands every new public-schema function a DIRECT anon grant via ALTER DEFAULT PRIVILEGES, so the revoke
 * must name anon/authenticated explicitly (a bare `from public` would not strip it).
 */
const catchUp = readFileSync(join(process.cwd(), 'supabase', 'catch-up.sql'), 'utf8');

describe('public mutation lockdown (catch-up.sql)', () => {
  const norm = catchUp.replace(/\s+/g, ' ');

  it.each([
    'revoke execute on function api_rate_limit(jsonb) from anon, authenticated;',
    'revoke execute on function api_create_hold(jsonb) from anon, authenticated;',
    'revoke execute on function create_hold(uuid, int, text) from anon, authenticated;',
    'revoke execute on function api_capture_lead(jsonb) from anon, authenticated;',
    'revoke execute on function api_book(jsonb) from anon;',
    'revoke execute on function api_create_payment(jsonb) from anon;',
  ])('revokes the mutation RPC grant: %s', (stmt) => {
    expect(norm).toContain(stmt.replace(/\s+/g, ' '));
  });

  it('revokes the multi-line create_booking grant from anon/authenticated', () => {
    expect(norm).toContain(
      'revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean) from anon, authenticated;',
    );
  });

  it('drops the open leads_insert policy and revokes the table INSERT grant', () => {
    expect(norm).toContain('drop policy if exists leads_insert on leads;');
    expect(norm).toContain('revoke insert on leads from anon, authenticated;');
  });
});
