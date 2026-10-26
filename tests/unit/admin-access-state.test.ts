import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EMPTY_ACCESS_STATE,
  loadAccessWithRetry,
  nextAccessState,
  resolveAccess,
  sameAccess,
  type AccessState,
} from '@/lib/admin/access-state';
import { NO_ACCESS, buildAccess, can } from '@/lib/admin/permissions';
import { MY_ACCESS_TIMEOUT_MS, loadMyAccess } from '@/lib/admin/team';
import { NoAccess } from '@/components/admin/NoAccess';
import {
  StaticAdminAccess,
  useAdminAccess,
  useAdminAccessStatus,
} from '@/components/admin/AdminAccessProvider';

const hoisted = vi.hoisted(() => ({
  rpc: null as null | (() => Promise<{ data: unknown; error: unknown }>),
}));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({ rpc: () => hoisted.rpc!() }),
}));

const ownerProfile = { id: 'A', role: 'admin' };
const staff = buildAccess({
  role: 'staff',
  teamRoleId: 'r',
  teamRoleName: 'Reservations',
  permissions: ['section.bookings'],
});

describe('resolveAccess: access belongs to a user', () => {
  it('shows a spinner while the call is out, for anyone who is not the Owner', () => {
    expect(resolveAccess(EMPTY_ACCESS_STATE, 'B', { id: 'B', role: 'staff' })).toEqual({
      access: null,
      loadFailed: false,
    });
    expect(resolveAccess(EMPTY_ACCESS_STATE, null, null).access).toBeNull();
  });

  it('seeds the Owner from their own profile, with no wait', () => {
    const r = resolveAccess(EMPTY_ACCESS_STATE, 'A', ownerProfile);
    expect(r.access?.isOwner).toBe(true);
    expect(r.loadFailed).toBe(false);
  });

  it('lets a finished load win over the Owner seed, so a demotion lands', () => {
    const state: AccessState = { forUser: 'A', access: staff, failed: false };
    expect(resolveAccess(state, 'A', ownerProfile).access).toBe(staff);
  });

  it('never shows one user’s access to another (A → B without signing out)', () => {
    const stateForA: AccessState = { forUser: 'A', access: staff, failed: false };
    // B is signed in, but the auth provider still holds A's (Owner) profile.
    expect(resolveAccess(stateForA, 'B', ownerProfile)).toEqual({
      access: null,
      loadFailed: false,
    });
  });

  it('does not borrow the previous user’s ROLE when the call fails', () => {
    const failedForB: AccessState = { forUser: 'B', access: null, failed: true };
    const r = resolveAccess(failedForB, 'B', ownerProfile); // profile A (Owner) is not B's
    expect(r.access).toBe(NO_ACCESS);
    expect(r.access?.isOwner).toBe(false);
    expect(r.loadFailed).toBe(true);
  });

  it('falls back to the role alone when the call fails: Owner keeps working, others get nothing', () => {
    const failed: AccessState = { forUser: 'A', access: null, failed: true };
    expect(resolveAccess(failed, 'A', ownerProfile).access?.isOwner).toBe(true);
    const asStaff = resolveAccess(failed, 'A', { id: 'A', role: 'staff' });
    expect(asStaff.access?.permissions.size).toBe(0);
    expect(asStaff.loadFailed).toBe(true);
    // The same fallback object each render, so the context value does not churn.
    expect(resolveAccess(failed, 'A', { id: 'A', role: 'staff' }).access).toBe(asStaff.access);
  });
});

describe('nextAccessState', () => {
  it('records an answer for the user it was loaded for', () => {
    const next = nextAccessState(EMPTY_ACCESS_STATE, 'A', staff);
    expect(next).toEqual({ forUser: 'A', access: staff, failed: false });
  });

  it('keeps the same state object when a refresh finds nothing new', () => {
    const prev: AccessState = { forUser: 'A', access: staff, failed: false };
    const same = buildAccess({
      role: 'staff',
      teamRoleId: 'r',
      teamRoleName: 'Reservations',
      permissions: ['section.bookings'],
    });
    expect(nextAccessState(prev, 'A', same)).toBe(prev);
  });

  it('replaces the access when the role changed', () => {
    const prev: AccessState = { forUser: 'A', access: staff, failed: false };
    const wider = buildAccess({
      role: 'staff',
      teamRoleId: 'r',
      teamRoleName: 'Reservations',
      permissions: ['section.bookings', 'section.quotes'],
    });
    const next = nextAccessState(prev, 'A', wider);
    expect(next.access).toBe(wider);
    expect(can(next.access!, 'section.quotes')).toBe(true);
  });

  it('a failed refresh never takes away access the user already had', () => {
    const prev: AccessState = { forUser: 'A', access: staff, failed: false };
    expect(nextAccessState(prev, 'A', null)).toBe(prev);
  });

  it('a failure with nothing to keep is recorded, and cleared by the next success', () => {
    const failed = nextAccessState(EMPTY_ACCESS_STATE, 'A', null);
    expect(failed).toEqual({ forUser: 'A', access: null, failed: true });
    expect(nextAccessState(failed, 'A', staff).failed).toBe(false);
  });

  it('does not keep another user’s access when this user’s load fails', () => {
    const prev: AccessState = { forUser: 'A', access: staff, failed: false };
    expect(nextAccessState(prev, 'B', null)).toEqual({ forUser: 'B', access: null, failed: true });
  });
});

describe('sameAccess', () => {
  it('compares role, team role and the permission set', () => {
    expect(sameAccess(staff, staff)).toBe(true);
    expect(sameAccess(staff, buildAccess({ role: 'staff' }))).toBe(false);
    expect(
      sameAccess(
        staff,
        buildAccess({
          role: 'staff',
          teamRoleId: 'other',
          teamRoleName: 'Reservations',
          permissions: ['section.bookings'],
        }),
      ),
    ).toBe(false);
    expect(sameAccess(buildAccess({ role: 'admin' }), buildAccess({ role: 'admin' }))).toBe(true);
  });
});

describe('loadAccessWithRetry', () => {
  const noWait = async () => {};

  it('returns the first answer without reporting or waiting', async () => {
    const onError = vi.fn();
    const wait = vi.fn(noWait);
    await expect(loadAccessWithRetry(async () => staff, onError, wait)).resolves.toBe(staff);
    expect(onError).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it('reports a failure, waits, and tries once more', async () => {
    const onError = vi.fn();
    const wait = vi.fn(noWait);
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(staff);
    await expect(loadAccessWithRetry(load, onError, wait)).resolves.toBe(staff);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![1]).toBe(1);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry fails too, reporting both attempts', async () => {
    const onError = vi.fn();
    const load = vi.fn().mockRejectedValue(new Error('down'));
    await expect(loadAccessWithRetry(load, onError, noWait)).resolves.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map((c) => c[1])).toEqual([1, 2]);
  });
});

describe('loadMyAccess timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    hoisted.rpc = null;
  });

  it('fails instead of waiting for ever on a call that never answers', async () => {
    vi.useFakeTimers();
    hoisted.rpc = () => new Promise(() => {});
    const pending = loadMyAccess();
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(MY_ACCESS_TIMEOUT_MS);
    await assertion;
  });

  it('returns the access when the call answers in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    hoisted.rpc = async () => ({
      data: {
        role: 'staff',
        teamRoleId: 'r',
        teamRoleName: 'Reservations',
        permissions: ['section.bookings'],
      },
      error: null,
    });
    const access = await loadMyAccess();
    expect(can(access, 'section.bookings')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still rejects with the database’s message when the call errors', async () => {
    hoisted.rpc = async () => ({ data: null, error: { message: 'permission denied' } });
    await expect(loadMyAccess()).rejects.toThrow(/permission denied/);
  });
});

describe('the failure panel', () => {
  it('says "No access" for a role without the section, with no retry', () => {
    const html = renderToStaticMarkup(createElement(NoAccess));
    expect(html).toContain('No access');
    expect(html).not.toContain('Retry');
  });

  it('says the permissions could not be loaded, and offers Retry', () => {
    const html = renderToStaticMarkup(
      createElement(NoAccess, { loadFailed: true, onRetry: async () => {} }),
    );
    expect(html).toContain('We couldn’t load your permissions.');
    expect(html).toContain('Retry');
    expect(html).not.toContain('No access');
  });
});

describe('StaticAdminAccess', () => {
  function Probe() {
    const access = useAdminAccess();
    const { loadFailed } = useAdminAccessStatus();
    return createElement(
      'p',
      null,
      `${access.teamRoleName}|${String(loadFailed)}|${String(can(access, 'section.bookings'))}`,
    );
  }

  it('hands a fixed access to the tree, with no network', () => {
    const html = renderToStaticMarkup(
      createElement(StaticAdminAccess, { value: staff }, createElement(Probe)),
    );
    expect(html).toContain('Reservations|false|true');
  });

  it('can stand in for a failed load', () => {
    const html = renderToStaticMarkup(
      createElement(
        StaticAdminAccess,
        { value: NO_ACCESS, loadFailed: true },
        createElement(Probe),
      ),
    );
    expect(html).toContain('|true|false');
  });

  it('is fail-closed outside any provider', () => {
    expect(renderToStaticMarkup(createElement(Probe))).toContain('|false|false');
  });
});
