import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAV,
  allows,
  bottomNavFor,
  navFor,
  navItemForPath,
  pageAllowedFor,
} from '@/components/admin/nav';
import {
  ALL_PERMISSIONS,
  CONTENT_PERMISSIONS,
  MONEY_PERMISSIONS,
  NO_ACCESS,
  SECTION_PERMISSIONS,
  buildAccess,
  can,
  isPermissionKey,
  roleLabel,
} from '@/lib/admin/permissions';

describe('the permission catalogue', () => {
  it('has unique keys, sections first then money', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS).toHaveLength(SECTION_PERMISSIONS.length + MONEY_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.every((k) => k.startsWith('section.') || k.startsWith('money.'))).toBe(
      true,
    );
  });

  it('lets content-only roles hold exactly the five content sections', () => {
    expect([...CONTENT_PERMISSIONS].sort()).toEqual([
      'section.blog',
      'section.places',
      'section.redirects',
      'section.seo',
      'section.tours',
    ]);
    expect(MONEY_PERMISSIONS.some((p) => p.contentAllowed)).toBe(false);
  });

  it('has 21 keys (tripwire: the SQL mirror must change with this)', () => {
    expect(ALL_PERMISSIONS).toHaveLength(21);
  });

  it('recognises only catalogue keys', () => {
    expect(isPermissionKey('money.refunds')).toBe(true);
    expect(isPermissionKey('money.everything')).toBe(false);
  });
});

describe('buildAccess', () => {
  it('gives the Owner every permission', () => {
    const a = buildAccess({ role: 'admin' });
    expect(a.isOwner).toBe(true);
    expect([...a.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(roleLabel(a)).toBe('Owner');
  });

  it('gives a team member only their keys, dropping unknown ones', () => {
    const a = buildAccess({
      role: 'staff',
      teamRoleId: 'r1',
      teamRoleName: 'Reservations',
      permissions: ['section.bookings', 'section.quotes', 'money.everything'],
    });
    expect(a.isOwner).toBe(false);
    expect([...a.permissions].sort()).toEqual(['section.bookings', 'section.quotes']);
    expect(roleLabel(a)).toBe('Reservations');
  });

  it('never lets a content member hold a guest or money key, whatever the row says', () => {
    const a = buildAccess({
      role: 'seo',
      teamRoleId: 'r2',
      teamRoleName: 'Content',
      permissions: ['section.blog', 'section.bookings', 'money.reports'],
    });
    expect([...a.permissions]).toEqual(['section.blog']);
  });

  it('fails closed: staff with no team role, customers and nobody get nothing', () => {
    expect(buildAccess({ role: 'staff' }).permissions.size).toBe(0);
    expect(
      buildAccess({ role: 'customer', permissions: ['section.bookings'] }).permissions.size,
    ).toBe(0);
    expect(buildAccess({ role: null }).permissions.size).toBe(0);
    expect(NO_ACCESS.permissions.size).toBe(0);
    expect(roleLabel(buildAccess({ role: 'staff' }))).toBe('No role yet');
  });

  it('never throws on malformed permissions from the jsonb RPC', () => {
    const objectPerms = buildAccess({ role: 'staff', permissions: {} as never });
    expect(objectPerms.permissions.size).toBe(0);
    const stringPerms = buildAccess({ role: 'staff', permissions: 'section.bookings' as never });
    expect(stringPerms.permissions.size).toBe(0);
    const mixed = buildAccess({
      role: 'staff',
      permissions: ['section.bookings', 42, null, { key: 'section.leads' }] as never,
    });
    expect([...mixed.permissions]).toEqual(['section.bookings']);
  });

  it('carries no team role for a customer, whatever it is given', () => {
    const a = buildAccess({
      role: 'customer',
      teamRoleId: 'r9',
      teamRoleName: 'Sneaky',
      permissions: ['section.bookings'],
    });
    expect(a.teamRoleId).toBeNull();
    expect(a.teamRoleName).toBeNull();
    expect(a.base).toBeNull();
    expect(a.permissions.size).toBe(0);
    expect(roleLabel(a)).toBe('No role yet');
  });

  it('derives base from the role, not from the row', () => {
    expect(buildAccess({ role: 'seo', permissions: ['section.blog'] }).base).toBe('content');
    expect(buildAccess({ role: 'staff' }).base).toBe('team');
    expect(buildAccess({ role: 'admin' }).base).toBeNull();
  });

  it('does not render a blank label for an empty role name', () => {
    expect(roleLabel(buildAccess({ role: 'staff', teamRoleId: 'r', teamRoleName: '' }))).toBe(
      'No role yet',
    );
  });
});

describe('can', () => {
  const a = buildAccess({
    role: 'staff',
    teamRoleId: 'r',
    permissions: ['money.prices'],
  });

  it('checks one key', () => {
    expect(can(a, 'money.prices')).toBe(true);
    expect(can(a, 'money.currency')).toBe(false);
  });

  it('treats a list as any-of', () => {
    expect(can(a, ['money.currency', 'money.prices'])).toBe(true);
    expect(can(a, ['money.currency', 'money.refunds'])).toBe(false);
  });

  it('lets the Owner do anything, but an empty list matches nothing', () => {
    const owner = buildAccess({ role: 'admin' });
    expect(can(owner, 'money.refunds')).toBe(true);
    expect(can(owner, [])).toBe(false);
  });
});

const owner = buildAccess({ role: 'admin' });
const reservations = buildAccess({
  role: 'staff',
  teamRoleId: 'r',
  teamRoleName: 'Reservations',
  permissions: ['section.bookings', 'section.quotes', 'section.calendar'],
});
const writer = buildAccess({
  role: 'seo',
  teamRoleId: 'c',
  teamRoleName: 'Content',
  permissions: CONTENT_PERMISSIONS,
});

function adminPages(dir = join(process.cwd(), 'app', '(site)', 'admin')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return adminPages(full);
    if (name !== 'page.tsx') return [];
    const rel = relative(join(process.cwd(), 'app', '(site)'), dir)
      .split(sep)
      .join('/');
    // Dynamic segments become a sample value: /admin/activities/[id]/edit -> /admin/activities/x/edit
    return [`/${rel}`.replace(/\[[^\]]+\]/g, 'x')];
  });
}

describe('admin navigation by permission', () => {
  it('every nav item names a known permission, "owner", or null', () => {
    for (const item of ADMIN_NAV) {
      const p = item.permission;
      const keys = p === null || p === 'owner' ? [] : typeof p === 'string' ? [p] : p;
      expect(keys.every(isPermissionKey), item.href).toBe(true);
    }
  });

  it('every admin page belongs to a nav item, so the page guard covers it', () => {
    for (const path of adminPages()) {
      expect(navItemForPath(path), path).not.toBeNull();
    }
  });

  it('the Owner sees everything', () => {
    expect(navFor(owner).map((n) => n.href)).toEqual(ADMIN_NAV.map((n) => n.href));
  });

  it('a team member sees the Dashboard plus their sections, never Reports', () => {
    expect(navFor(reservations).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/bookings',
      '/admin/calendar',
      '/admin/quotes',
    ]);
    expect(allows(reservations, navItemForPath('/admin/reports')!)).toBe(false);
  });

  it('a content member sees the Dashboard plus exactly the old seo sections', () => {
    expect(navFor(writer).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/activities',
      '/admin/planner-places',
      '/admin/seo',
      '/admin/blog',
      '/admin/redirects',
    ]);
  });

  it('resolves deep paths to their section', () => {
    expect(navItemForPath('/admin/activities/x/edit')?.href).toBe('/admin/activities');
    expect(navItemForPath('/admin')?.href).toBe('/admin');
    expect(navItemForPath('/admin/nope')).toBeNull();
  });

  it('the bottom bar is the usual four in sidebar order, minus any not allowed, topped up to four', () => {
    // Owner: the usual four.
    expect(bottomNavFor(owner).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/bookings',
      '/admin/activities',
      '/admin/leads',
    ]);
    // The old seo account's bar keeps its order: Tours, SEO, Blog, Redirects.
    expect(bottomNavFor(writer).map((n) => n.href)).toEqual([
      '/admin/activities',
      '/admin/seo',
      '/admin/blog',
      '/admin/redirects',
    ]);
    // Only two of the usual four are open, so two more of their own sections fill the bar.
    expect(bottomNavFor(reservations).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/bookings',
      '/admin/calendar',
      '/admin/quotes',
    ]);
  });

  it('a role with a single unusual section still gets it in the bottom bar', () => {
    const calendarOnly = buildAccess({
      role: 'staff',
      teamRoleId: 'r',
      permissions: ['section.calendar'],
    });
    expect(bottomNavFor(calendarOnly).map((n) => n.href)).toEqual(['/admin', '/admin/calendar']);
    const fewContent = buildAccess({
      role: 'seo',
      teamRoleId: 'c',
      permissions: ['section.blog', 'section.places'],
    });
    expect(bottomNavFor(fewContent).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/planner-places',
      '/admin/blog',
    ]);
  });

  it('never puts more than four items in the bottom bar', () => {
    for (const access of [owner, reservations, writer]) {
      expect(bottomNavFor(access).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('the page guard', () => {
  const noRole = buildAccess({ role: 'staff' });

  it('treats a path no nav item owns as Owner-only', () => {
    expect(pageAllowedFor(owner, '/admin/not-a-real-page')).toBe(true);
    expect(pageAllowedFor(reservations, '/admin/not-a-real-page')).toBe(false);
    expect(pageAllowedFor(writer, '/admin/not-a-real-page')).toBe(false);
  });

  it('lets a staff account with no role open the Dashboard and nothing else', () => {
    expect(pageAllowedFor(noRole, '/admin')).toBe(true);
    expect(pageAllowedFor(noRole, '/admin/bookings')).toBe(false);
    expect(pageAllowedFor(noRole, '/admin/activities/x/edit')).toBe(false);
  });

  it('opens Pricing for either half of it, and for neither it stays shut', () => {
    const currencyOnly = buildAccess({
      role: 'staff',
      teamRoleId: 'r',
      permissions: ['money.currency'],
    });
    const pricesOnly = buildAccess({
      role: 'staff',
      teamRoleId: 'r',
      permissions: ['money.prices'],
    });
    const neither = buildAccess({ role: 'staff', teamRoleId: 'r', permissions: ['money.refunds'] });
    expect(pageAllowedFor(currencyOnly, '/admin/vehicle-pricing')).toBe(true);
    expect(pageAllowedFor(pricesOnly, '/admin/vehicle-pricing')).toBe(true);
    expect(pageAllowedFor(neither, '/admin/vehicle-pricing')).toBe(false);
  });

  it('covers a section’s deep pages, not just its index', () => {
    expect(pageAllowedFor(writer, '/admin/activities/x/availability')).toBe(true);
    expect(pageAllowedFor(writer, '/admin/activities/new')).toBe(true);
    expect(pageAllowedFor(writer, '/admin/bookings')).toBe(false);
    expect(pageAllowedFor(owner, '/admin/activities/x/availability')).toBe(true);
  });

  it('opens a path a team member holds the permission for', () => {
    expect(pageAllowedFor(reservations, '/admin/quotes')).toBe(true);
    expect(pageAllowedFor(reservations, '/admin/reports')).toBe(false);
  });
});
