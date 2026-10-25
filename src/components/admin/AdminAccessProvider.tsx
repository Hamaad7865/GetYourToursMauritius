'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { loadMyAccess } from '@/lib/admin/team';
import { buildAccess, NO_ACCESS, type AdminAccess } from '@/lib/admin/permissions';

const AccessContext = createContext<AdminAccess | null>(null);

/**
 * Loads what the signed-in person may do in /admin (api_my_access) once per visit and hands it to every
 * admin screen. Mounted inside AdminGuard, so only back-office profiles ever make the call.
 *
 * If the call fails, falls back to the profile's role alone: the Owner keeps working, everyone else
 * gets nothing (fail closed). The fallback is UI only — the database enforces every money rule.
 */
export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const userId = user?.id ?? null;
  const role = profile?.role ?? null;

  useEffect(() => {
    if (!userId) {
      setAccess(null);
      return;
    }
    let active = true;
    loadMyAccess()
      .then((a) => {
        if (active) setAccess(a);
      })
      .catch(() => {
        if (active) setAccess(buildAccess({ role }));
      });
    return () => {
      active = false;
    };
  }, [userId, role]);

  if (!access) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-ink-muted">Loading…</div>
    );
  }
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/** The current person's admin access. Outside the provider: no access at all (fail closed). */
export function useAdminAccess(): AdminAccess {
  return useContext(AccessContext) ?? NO_ACCESS;
}
