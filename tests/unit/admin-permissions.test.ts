import { describe, expect, it } from 'vitest';
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
      base: 'team',
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
      base: 'content',
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
});

describe('can', () => {
  const a = buildAccess({
    role: 'staff',
    teamRoleId: 'r',
    base: 'team',
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
});
