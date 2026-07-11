import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildSetupSql } from '../../scripts/build-setup-sql';

/**
 * The committed supabase/setup.sql (the paste-once fresh-install bundle documented in SUPABASE_SETUP.md)
 * must stay in sync with the migrations. It had drifted to 47 of 94 migrations — missing api_rate_limit,
 * the rental fleet, transfer search, and payment-checkout persistence — so a fresh provision from it
 * produced a DB that did not match the app. This guard fails CI the moment setup.sql lags a migration.
 *
 * Fix when it fails: `npm run seed:gen && npm run setup:sql` and commit the result.
 */
const norm = (s: string) => s.replace(/\r\n/g, '\n');

describe('supabase/setup.sql is in sync with the migrations + seed', () => {
  it('equals a fresh bundle (run `npm run setup:sql` to refresh)', () => {
    const committed = norm(readFileSync(join(process.cwd(), 'supabase', 'setup.sql'), 'utf8'));
    const fresh = norm(buildSetupSql());
    expect(committed).toBe(fresh);
  });
});
