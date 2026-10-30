import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A guest's anonymous JWT is a valid JWT, so it passes `requireUser`. This makes every route that calls
 * `requireUser` a decision somebody took, in the same way the edge-runtime test does: a new route fails
 * here until it says whether a guest may reach it.
 *
 * Anything that means "a person with an account" calls `requireAccount` instead and is not listed.
 */
const GUEST_OK = [
  // The booking itself: a guest owns it, and the owner checks in SQL do the rest.
  'bookings',
  'bookings/pending',
  'bookings/[ref]',
  'bookings/[ref]/adopt',
  'bookings/[ref]/cancel',
  'bookings/[ref]/invoice',
  'bookings/[ref]/pickup',
  'bookings/[ref]/pickup/quote',
  'bookings/[ref]/release',
  'bookings/[ref]/reschedule',
  'bookings/[ref]/voucher',
  'holds/[id]',
  'holds/[id]/release',
  'payments',
  'payments/sync',
  // Their own in-app notifications, which are their own rows.
  'notifications',
  'notifications/[id]/read',
  'notifications/read-all',
  'notifications/unread-count',
];

/** Back-office routes: each checks the caller's team role, which an anonymous user can never have. */
const STAFF_GATED = /^(admin|seo)\/|^reviews\/google-live$/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

const API_ROOT = join(process.cwd(), 'app', 'api', 'v1');
const routes = routeFiles(API_ROOT).map((file) => ({
  file,
  name: relative(API_ROOT, file).split(sep).slice(0, -1).join('/'),
  source: readFileSync(file, 'utf8'),
}));

describe('guest access to the API', () => {
  const usingRequireUser = routes.filter((r) => /await requireUser\(/.test(r.source));

  it('finds routes to check', () => {
    expect(usingRequireUser.length).toBeGreaterThan(20);
  });

  it.each(usingRequireUser.map((r) => r.name))('%s is a deliberate choice', (name) => {
    expect(GUEST_OK.includes(name) || STAFF_GATED.test(name)).toBe(true);
  });

  it('keeps the list honest: every guest-ok route exists and still uses requireUser', () => {
    const names = new Set(usingRequireUser.map((r) => r.name));
    expect(GUEST_OK.filter((name) => !names.has(name))).toEqual([]);
  });

  it('every staff-gated route really does check the caller’s role', () => {
    const staff = usingRequireUser.filter((r) => STAFF_GATED.test(r.name));
    expect(staff.length).toBeGreaterThan(0);
    for (const route of staff) {
      expect(route.source, route.name).toMatch(/loadCallerAccess|isStaff|is_staff|hasRole|role/);
    }
  });

  it('the account routes turn a guest away', () => {
    const account = routes.filter((r) => /^(account|wishlist|saved-cards)(\/|$)/.test(r.name));
    expect(account.length).toBeGreaterThan(5);
    for (const route of account) {
      expect(route.source, route.name).not.toMatch(/await requireUser\(/);
    }
  });
});
