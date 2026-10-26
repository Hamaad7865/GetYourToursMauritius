'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { reportClientError } from '@/lib/client-error-report';
import { loadMyAccess } from '@/lib/admin/team';
import { NO_ACCESS, type AdminAccess } from '@/lib/admin/permissions';
import {
  EMPTY_ACCESS_STATE,
  loadAccessWithRetry,
  nextAccessState,
  resolveAccess,
  type AccessState,
} from '@/lib/admin/access-state';

interface AccessContextValue {
  access: AdminAccess;
  /** api_my_access could not be read (after one retry); `access` is then a role-only fallback. */
  loadFailed: boolean;
  /** Try again now. Resolves when the attempt is over, whichever way it went. */
  retry: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

const NO_RETRY = async () => {};
const DEFAULT_STATUS = { loadFailed: false, retry: NO_RETRY };

/** A tab brought back to the front re-reads access at most this often. */
const REFRESH_MIN_GAP_MS = 5000;

/**
 * Loads what the signed-in person may do in /admin (api_my_access) and hands it to every admin screen.
 * Mounted inside AdminGuard, so only back-office profiles ever make the call.
 *
 * - Access belongs to a USER: it is never shown for anyone else (see src/lib/admin/access-state.ts).
 * - The Owner is seeded from the profile and sees no loading screen; the call still runs to catch a
 *   demotion.
 * - A failed call is reported, retried once, and then surfaced through useAdminAccessStatus(); the
 *   fallback is the profile's role alone (Owner keeps working, everyone else gets nothing). UI only —
 *   the database enforces every money rule.
 * - A tab that becomes visible again re-reads access, so a role change reaches an open tab.
 */
export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<AccessState>(EMPTY_ACCESS_STATE);
  // Refs, not state: they steer the loader and must not re-render anything.
  const latestUser = useRef<string | null>(userId);
  const inFlight = useRef<string | null>(null);
  const lastDone = useRef(0);

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      if (!userId || inFlight.current === userId) return;
      if (!force && Date.now() - lastDone.current < REFRESH_MIN_GAP_MS) return;
      inFlight.current = userId;
      let result: AdminAccess | null = null;
      try {
        result = await loadAccessWithRetry(loadMyAccess, (error, attempt) => {
          reportClientError({
            kind: 'admin.access_load_failed',
            message: `Could not load admin access (attempt ${attempt} of 2): ${
              error instanceof Error ? error.message : String(error)
            }`,
            stack: error instanceof Error ? error.stack : undefined,
            source: 'AdminAccessProvider',
          });
        });
      } finally {
        if (inFlight.current === userId) inFlight.current = null;
        lastDone.current = Date.now();
      }
      // The person changed while we waited: this answer is about someone else.
      if (latestUser.current !== userId) return;
      setState((prev) => nextAccessState(prev, userId, result));
    },
    [userId],
  );

  const retry = useCallback(() => load(true), [load]);

  useEffect(() => {
    latestUser.current = userId;
    if (userId) void load(true);
  }, [userId, load]);

  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userId, load]);

  const resolved = resolveAccess(state, userId, profile);
  const value = useMemo<AccessContextValue | null>(
    () =>
      resolved.access ? { access: resolved.access, loadFailed: resolved.loadFailed, retry } : null,
    [resolved.access, resolved.loadFailed, retry],
  );

  if (!value) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-ink-muted">Loading…</div>
    );
  }
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/**
 * Hands a fixed access to the tree — for tests and previews. Makes no network call.
 * (Production wiring is AdminAccessProvider.)
 */
export function StaticAdminAccess({
  value,
  loadFailed = false,
  children,
}: {
  value: AdminAccess;
  loadFailed?: boolean;
  children?: ReactNode;
}) {
  const ctx = useMemo(() => ({ access: value, loadFailed, retry: NO_RETRY }), [value, loadFailed]);
  return <AccessContext.Provider value={ctx}>{children}</AccessContext.Provider>;
}

/** The current person's admin access. Outside the provider: no access at all (fail closed). */
export function useAdminAccess(): AdminAccess {
  return useContext(AccessContext)?.access ?? NO_ACCESS;
}

/** Whether the access could be read, and a way to try again. Outside the provider: nothing to retry. */
export function useAdminAccessStatus(): { loadFailed: boolean; retry: () => Promise<void> } {
  return useContext(AccessContext) ?? DEFAULT_STATUS;
}
