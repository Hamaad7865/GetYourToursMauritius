'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useToast } from '@/components/site/ToastProvider';
import { AuthDialog } from './AuthDialog';

/** Best-effort display name from the auth user's metadata, for the welcome toast. */
function displayName(user: User | null): string | null {
  const meta = user?.user_metadata ?? {};
  const name =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    null;
  return name ? name.split(' ')[0]! : null;
}

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
  const { showToast } = useToast();

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
    const { data: inserted, error: insertError } = await sb
      .from('profiles')
      .insert({ id: current.id, full_name: fullName })
      .select('id, full_name, phone, role')
      .maybeSingle();

    if (insertError) {
      // A concurrent sign-in (e.g. a second tab) may have created the row first, tripping
      // the primary-key constraint — re-read it rather than masking the failure.
      const { data: existing } = await sb
        .from('profiles')
        .select('id, full_name, phone, role')
        .eq('id', current.id)
        .maybeSingle();
      setProfile(
        existing
          ? { id: existing.id, fullName: existing.full_name, phone: existing.phone, role: existing.role }
          : null,
      );
      return;
    }

    setProfile(
      inserted
        ? { id: inserted.id, fullName: inserted.full_name, phone: inserted.phone, role: inserted.role }
        : { id: current.id, fullName, phone: null, role: 'customer' },
    );
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let active = true;
    // Track which user we've already loaded a profile for, so the initial getSession and
    // the INITIAL_SESSION event (and token refreshes) don't each refetch the profile.
    let loadedFor: string | null = null;
    // Whether a user was already present, so we only toast on a *fresh* interactive sign-in
    // (not on a logged-in page refresh / token refresh).
    let hadUser = false;

    const apply = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      const u = nextSession?.user ?? null;
      setUser(u);
      if (u) {
        if (u.id !== loadedFor) {
          loadedFor = u.id;
          void loadProfile(u);
        }
      } else {
        loadedFor = null;
        setProfile(null);
      }
    };

    sb.auth.getSession().then(({ data }) => {
      apply(data.session);
      hadUser = !!data.session?.user;
      if (active) setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, nextSession) => {
      const wasSignedIn = hadUser;
      apply(nextSession);
      hadUser = !!nextSession?.user;
      if (active && event === 'SIGNED_IN' && !wasSignedIn) {
        const name = displayName(nextSession?.user ?? null);
        showToast({
          title: "You're logged in",
          description: name ? `Signed in as ${name}.` : 'Signed in to Belle Mare Tours.',
        });
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, showToast]);

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
