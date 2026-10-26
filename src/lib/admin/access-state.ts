import { buildAccess, NO_ACCESS, type AdminAccess } from '@/lib/admin/permissions';

/**
 * The rules behind AdminAccessProvider, kept pure so they can be tested without mounting React.
 *
 * The provider remembers WHOSE access it holds. That matters because the auth provider swaps `user`
 * before it swaps `profile` when someone signs in as a different account without signing out: for a
 * moment the new user is paired with the old user's profile. Anything read from that profile (their
 * role, above all) must be ignored until the profile's id matches the user.
 */
export interface AccessState {
  /** The user this state was loaded for. */
  forUser: string | null;
  /** What api_my_access said, or null when it has not (yet) answered. */
  access: AdminAccess | null;
  /** True once loading failed and there is nothing earlier to fall back on. */
  failed: boolean;
}

export const EMPTY_ACCESS_STATE: AccessState = { forUser: null, access: null, failed: false };

export interface ResolvedAccess {
  /** Null = still loading: show a spinner, not a screen. */
  access: AdminAccess | null;
  /** api_my_access could not be read; `access` is then a role-only fallback. */
  loadFailed: boolean;
}

const OWNER_ACCESS = buildAccess({ role: 'admin' });
const roleOnly = new Map<string, AdminAccess>();

/** The access the profile's role alone implies — the Owner everything, anyone else nothing. Cached so the
 *  context value keeps its identity between renders. */
function roleOnlyAccess(role: string | null): AdminAccess {
  if (role === null) return NO_ACCESS;
  if (role === 'admin') return OWNER_ACCESS;
  let access = roleOnly.get(role);
  if (!access) {
    access = buildAccess({ role });
    roleOnly.set(role, access);
  }
  return access;
}

/**
 * What to render for `userId` right now.
 *
 * - Access loaded for THIS user: use it (a background refresh that finds a demotion lands here).
 * - A profile that is verifiably this user's and says Owner: seed Owner access at once, so the Owner
 *   never waits on the call (the call still runs and wins as soon as it answers).
 * - Loading failed: the profile's role alone — only if the profile is this user's, else nothing.
 * - Otherwise: still loading.
 */
export function resolveAccess(
  state: AccessState,
  userId: string | null,
  profile: { id: string; role: string } | null,
): ResolvedAccess {
  if (!userId) return { access: null, loadFailed: false };
  const current = state.forUser === userId ? state : null;
  if (current?.access) return { access: current.access, loadFailed: false };
  const mine = profile?.id === userId ? profile.role : null;
  const failed = current?.failed ?? false;
  if (mine === 'admin') return { access: OWNER_ACCESS, loadFailed: failed };
  if (failed) return { access: roleOnlyAccess(mine), loadFailed: true };
  return { access: null, loadFailed: false };
}

/** True when two answers grant exactly the same thing — so an unchanged refresh re-renders nothing. */
export function sameAccess(a: AdminAccess, b: AdminAccess): boolean {
  if (a.role !== b.role) return false;
  if (a.teamRoleId !== b.teamRoleId || a.teamRoleName !== b.teamRoleName) return false;
  if (a.permissions.size !== b.permissions.size) return false;
  for (const p of a.permissions) if (!b.permissions.has(p)) return false;
  return true;
}

/**
 * The state after a load for `userId` finished. `result` is null when every attempt failed.
 *
 * A failure never takes away access this user already had (a flaky network on a focus refresh must not
 * lock a working screen); it only records `failed` when there is nothing to keep.
 */
export function nextAccessState(
  prev: AccessState,
  userId: string,
  result: AdminAccess | null,
): AccessState {
  const held = prev.forUser === userId ? prev.access : null;
  if (result) {
    if (held && sameAccess(held, result)) return prev;
    return { forUser: userId, access: result, failed: false };
  }
  if (held) return prev;
  return { forUser: userId, access: null, failed: true };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const ACCESS_RETRY_DELAY_MS = 1000;

/**
 * Run the load, and on a failure report it and try once more after a short pause. Returns null when
 * both attempts failed. `onError` is called for each failed attempt (the caller reports it).
 */
export async function loadAccessWithRetry(
  load: () => Promise<AdminAccess>,
  onError: (error: unknown, attempt: number) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<AdminAccess | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await load();
    } catch (error) {
      onError(error, attempt);
      if (attempt === 1) await wait(ACCESS_RETRY_DELAY_MS);
    }
  }
  return null;
}
