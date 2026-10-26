import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EVERY STAFF ROUTE CHECKS ITS SECTION, BEFORE IT DOES ANYTHING ELSE — PINNED AGAINST THE SOURCE.
 *
 * The back office's permissions are enforced twice: in the database (RLS + has_permission()) and, for the
 * routes that read through the SERVICE-ROLE client and so bypass RLS, in the route itself. That second
 * check is a few lines of copy-pasteable code, and it has already drifted once (five hand-rolled
 * `callerRole()` copies, then three more `profiles.role` checks nobody remembered). A route that forgets
 * it, or runs it after reading the body or the database, is a guest-data leak that no behavioural test
 * of the happy path will ever notice. So this reads each route's source and pins, per route:
 *
 *  - exactly ONE `can(access, '<the section>')`, fed by `loadCallerAccess` (never `requireUser().role`,
 *    which is the JWT's Postgres selector, and never a hand-rolled `profiles` read);
 *  - that gate comes BEFORE the body / query is parsed and BEFORE the first database read;
 *  - none of the old copy-pasted machinery is left.
 *
 * It is a tripwire, like tests/unit/quote-send-contract.test.ts: it cannot prove the gate is correct,
 * only that it is there, once, first. The behaviour itself is exercised by
 * tests/integration/admin-section-gates.test.ts and the admin-quote-* suites.
 *
 * A new route under app/api/v1/admin/ MUST be added to GATED below, and so must any other route under
 * app/api/v1/ whose code calls loadCallerAccess (today the seo/* and reviews/* ones) — the last two tests
 * fail until it is, so the list cannot silently fall behind the directory.
 */

const API = join(process.cwd(), 'app', 'api', 'v1');

/** route file (relative to app/api/v1, posix separators) -> the permission it requires. */
const GATED: Record<string, string> = {
  'admin/assistant/route.ts': 'section.assistant',
  'admin/bookings/[ref]/installments/[seq]/remind/route.ts': 'section.bookings',
  'admin/quotes/send/route.ts': 'section.quotes',
  'admin/quotes/[ref]/balance/route.ts': 'section.quotes',
  'admin/quotes/draft-from-email/route.ts': 'section.quotes',
  'admin/documents/[id]/pdf/route.ts': 'section.documents',
  'admin/documents/[id]/email/route.ts': 'section.documents',
  'seo/ai-fix/route.ts': 'section.seo',
  'seo/search-console/route.ts': 'section.seo',
  'reviews/google-live/route.ts': 'section.reviews',
};

/** The source with every comment removed, so prose that quotes `callerRole` or `can(` cannot count. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Index just past the `)` that closes the call opening at `open` (the index of its `(`). */
function endOfCall(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced parentheses');
}

function load(route: string): string {
  return code(readFileSync(join(API, ...route.split('/')), 'utf8'));
}

describe.each(Object.entries(GATED))('%s', (route, permission) => {
  const src = load(route);

  it(`checks ${permission} exactly once, through loadCallerAccess`, () => {
    const checks = [...src.matchAll(/\bcan\(\s*access\s*,\s*([^)]*)\)/g)].map((m) => m[1]!.trim());
    // The any-of array form is allowed, but today every route needs exactly one section.
    expect(checks).toEqual([`'${permission}'`]);
    expect(src.match(/\bloadCallerAccess\(/g)).toHaveLength(1);
    expect(src).toMatch(/const access = await loadCallerAccess\(/);
  });

  it('checks before it parses the request or touches the database', () => {
    const loadAt = src.indexOf('loadCallerAccess(');
    const loadEnd = endOfCall(src, src.indexOf('(', loadAt));
    const gateAt = src.search(/\bcan\(\s*access\b/);
    expect(loadAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(loadEnd);

    for (const needle of ['parseJsonBody(', 'parseQuery(', 'await params']) {
      const at = src.indexOf(needle);
      if (at !== -1) expect(gateAt, `${needle} must come after the gate`).toBeLessThan(at);
    }

    // The first read of anything — `.from(` or `.rpc(` — that is not an argument of loadCallerAccess.
    const reads = [...src.matchAll(/\.(from|rpc)\(/g)]
      .map((m) => m.index!)
      .filter((at) => at < loadAt || at >= loadEnd);
    for (const at of reads) expect(gateAt).toBeLessThan(at);
  });

  it('keeps none of the hand-rolled role machinery', () => {
    expect(src).not.toMatch(/\bcallerRole\b/);
    expect(src).not.toMatch(/\bSENDING_ROLES\b/);
    expect(src).not.toMatch(/\.from\(\s*['"]profiles['"]\s*\)/);
    expect(src).not.toMatch(/\bprofile\??\.role\b/);
    // `requireUser().role` is the JWT's Postgres role selector, never the business role.
    expect(src).not.toMatch(/\buser\.role\b/);
  });
});

/** Every route.ts under `dir`, relative to app/api/v1 with posix separators. */
function routeFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'route.ts') found.push(relative(API, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return found;
}

describe('the list of gated routes', () => {
  it('covers every route under app/api/v1/admin', () => {
    const missing = routeFiles(join(API, 'admin')).filter((route) => !(route in GATED));
    expect(missing, 'add each new admin route to GATED with its section').toEqual([]);
  });

  it('covers every route anywhere under app/api/v1 that calls loadCallerAccess', () => {
    // Comments stripped, so prose that merely mentions the helper cannot trigger this.
    const callers = routeFiles(API).filter((route) => /\bloadCallerAccess\(/.test(load(route)));
    expect(
      callers.length,
      'the scan found no gated route at all — is it looking in the right place?',
    ).toBeGreaterThan(0);
    const missing = callers.filter((route) => !(route in GATED));
    expect(missing, 'add each staff route to GATED with its section').toEqual([]);
  });
});
