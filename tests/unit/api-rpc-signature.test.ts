import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every `api_*` function must declare its single jsonb argument as `p`.
 *
 * WHY THIS EXISTS. The production port calls every api_* function by ARGUMENT NAME —
 * `client.rpc(fn, { p: params })` in src/lib/supabase/rpc.ts — and PostgREST resolves overloads by
 * name, so a function declared `(payload jsonb)` is simply not found at runtime. That shipped once
 * (api_record_merchant_ref, 20261007000000) and took every card payment on the site down: the record
 * call sits in front of `createCheckout`, so bookings, quotes, balances, installments, supplements
 * and tour-change differences all threw "An upstream service is unavailable" before reaching Peach.
 *
 * THE INTEGRATION TESTS STRUCTURALLY CANNOT CATCH IT. The PGlite shim binds positionally —
 * `select ${fn}($1::jsonb)` — so it resolves the function whatever the parameter is called. The
 * argument name is the one part of the contract that only production exercises, which is exactly
 * what makes a cheap static check worth having.
 */
const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** `create [or replace] function api_<name>(<args>)`, capturing the name and the argument list. */
const DECL = /create\s+(?:or\s+replace\s+)?function\s+(api_[a-z0-9_]+)\s*\(([^)]*)\)/gi;

/** `p jsonb`, with or without a default. */
const CONVENTION = /^p\s+jsonb\b/i;

/**
 * The two api_* functions that deliberately take TYPED arguments instead of the jsonb envelope.
 * Neither goes through the DbRpc port: both are invoked straight off a Supabase client with named
 * typed args (`supabase.rpc('api_release_hold', { p_hold_id: id })`), so the `{ p: ... }` binding
 * this test protects does not apply to them. Anything else joining this list needs the same proof.
 */
const TYPED_ARG_EXEMPT = new Set(['api_release_hold', 'api_swap_category_positions']);

describe('api_* RPC signatures', () => {
  it('declare their jsonb argument as `p`, the name the production port binds', () => {
    // The WINNING definition is what Postgres ends up with: migrations apply in filename order, so
    // the last declaration of a function is the live one. An earlier body that a later migration
    // supersedes is history, not a contract — the same rule the handbook applies to function drift.
    const winner = new Map<string, { file: string; args: string }>();

    for (const file of readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      for (const [, fn, rawArgs] of sql.matchAll(DECL)) {
        if (fn === undefined || rawArgs === undefined) continue;
        winner.set(fn, { file, args: rawArgs.trim() });
      }
    }

    expect(winner.size).toBeGreaterThan(50);

    const offenders = [...winner.entries()]
      // A no-argument api_* function is called with no args and so has nothing to mis-name.
      .filter(([, { args }]) => args !== '')
      .filter(([fn]) => !TYPED_ARG_EXEMPT.has(fn))
      .filter(([, { args }]) => !CONVENTION.test(args))
      .map(([fn, { file, args }]) => `${file}: ${fn}(${args})`);

    expect(offenders).toEqual([]);
  });
});
