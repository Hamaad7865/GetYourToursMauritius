'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { AuthDialog } from './AuthDialog';

export interface Profile {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: string;
}

export type AuthMode = 'signin' | 'signup';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** True until the initial session check resolves — guard UI flicker with this. */
  loading: boolean;
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * App-wide auth state backed by the Supabase browser client. Exposes the current user +
 * profile, controls the sign-in/up modal, and ensures a `profiles` row exists on first
 * sign-in (the schema has no auth.users trigger). Wrap the app once in the root layout.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogMode, setDialogMode] = useState<AuthMode | null>(null);

  // Load (and create if missing) the caller's profile row under RLS.
  const loadProfile = useCallback(async (current: User): Promise<void> => {
    const sb = getBrowserSupabase();
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name, phone, role')
      .eq('id', current.id)
      .maybeSingle();

    if (error) {
      // Don't block the session on a profile read hiccup; leave it null.
      setProfile(null);
      return;
    }

    if (data) {
      setProfile({ id: data.id, fullName: data.full_name, phone: data.phone, role: data.role });
      return;
    }

    // First sign-in: seed the profile from the auth metadata (role is forced to 'customer'
    // by the DB role-guard trigger regardless of what we send).
    const meta = current.user_metadata ?? {};
    const fullName =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null;
    const { data: inserted } = await sb
      .from('profiles')
      .insert({ id: current.id, full_name: fullName })
      .select('id, full_name, phone, role')
      .maybeSingle();
    setProfile(
      inserted
        ? { id: inserted.id, fullName: inserted.full_name, phone: inserted.phone, role: inserted.role }
        : { id: current.id, fullName, phone: null, role: 'customer' },
    );
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let active = true;

    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) void loadProfile(data.session.user);
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) void loadProfile(nextSession.user);
      else setProfile(null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const openAuth = useCallback((mode: AuthMode = 'signin') => setDialogMode(mode), []);
  const closeAuth = useCallback(() => setDialogMode(null), []);

  const signOut = useCallback(async () => {
    await getBrowserSupabase().auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user);
  }, [user, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, profile, loading, openAuth, closeAuth, signOut, refreshProfile }),
    [user, session, profile, loading, openAuth, closeAuth, signOut, refreshProfile],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialogMode && <AuthDialog mode={dialogMode} onClose={closeAuth} onSwitch={setDialogMode} />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>.');
  return ctx;
}
