'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { supabaseRpc } from '@/lib/supabase/rpc';
import { welcomeName } from '@/lib/auth/display-name';
import { useToast } from '@/components/site/ToastProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { AuthDialog } from './AuthDialog';

export interface Profile {
  id: string;
  fullName: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  role: string;
}

export type AuthMode = 'signin' | 'signup';

interface AuthContextValue {
  /**
   * A real account, or null. A GUEST (a Supabase anonymous sign-in) is null here on purpose: the header,
   * the account pages and everything else that means "signed in" treat them as signed out by default,
   * and only the surfaces that work for a guest opt in, by reading `session` or `isGuest`.
   */
  user: User | null;
  /** Any live session, a guest's included. This is what the booking and payment calls send. */
  session: Session | null;
  /** The session is a guest checkout's anonymous user. */
  isGuest: boolean;
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
 * Attach any QUOTE bookings this person paid for as a guest, before they had an account.
 *
 * A quote booking is the only ownerless booking in the schema: the guest is emailed an offer and pays
 * it with no account at all. `bookings` is read under `using (user_id = auth.uid() or is_staff())`, and
 * a null user_id matches neither branch — so if they sign up later, their paid booking would be
 * missing from "My trips" and /bookings/{ref} would 404 the person who paid for it.
 *
 * `api_claim_quote_bookings` fills that column in. It reads the caller's OWN confirmed address out of
 * auth.users (nothing is sent to it — an address in the payload would be untrusted input), only ever
 * moves a booking from NULL to a user, and is idempotent, which is what makes it safe to fire here on
 * every sign-in rather than needing a one-shot trigger.
 *
 * BEST-EFFORT BY DESIGN: a failure must never block the session. The claim is a convenience — the
 * guest can still reach their record through the quote link that authorised the payment — and it will
 * simply run again on the next sign-in.
 */
async function claimGuestQuoteBookings(): Promise<void> {
  try {
    // Through the shared adapter rather than `client.rpc(...)` directly: it wraps the argument as the
    // `{ p: … }` every api_* function takes, and it THROWS on a PostgREST error — supabase-js returns
    // one in `{ error }`, which a bare await would swallow past this catch.
    await supabaseRpc(getBrowserSupabase()).rpc('api_claim_quote_bookings', {});
  } catch {
    /* never block sign-in on this; the next sign-in retries it */
  }
}

/**
 * Attach the paid bookings this person made as a guest with the same confirmed address. The rules live
 * server-side (services/guest.ts). Best-effort and idempotent, like the quote claim above: it can never
 * block a session, and it runs again on the next sign-in.
 */
async function claimPaidGuestBookings(
  userId: string,
  accessToken: string,
  freshLogin: boolean,
): Promise<number> {
  // Unlike the quote claim this is several server round trips, and this runs on every page load. So
  // once per tab per account, and always on a real sign-in, which is when a guest booking can appear.
  const claimedKey = `gytm:guest-claim:${userId}`;
  try {
    if (!freshLogin && window.sessionStorage.getItem(claimedKey)) return 0;
  } catch {
    /* sessionStorage unavailable — just run the claim */
  }
  try {
    const res = await fetch('/api/v1/account/claim-guest-bookings', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => null)) as { data?: { claimed?: number } } | null;
    if (res.ok) {
      try {
        window.sessionStorage.setItem(claimedKey, '1');
      } catch {
        /* sessionStorage unavailable — the next page load claims again, harmlessly */
      }
    }
    return body?.data?.claimed ?? 0;
  } catch {
    return 0; /* never block sign-in on this; the next sign-in retries it */
  }
}

/**
 * App-wide auth state backed by the Supabase browser client. Exposes the current user +
 * profile, controls the sign-in/up modal, and ensures a `profiles` row exists on first
 * sign-in (the schema has no auth.users trigger). Wrap the app once in the root layout.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogMode, setDialogMode] = useState<AuthMode | null>(null);
  const { showToast } = useToast();
  const t = useT();

  // Load (and create if missing) the caller's profile row under RLS. Resolves to the row's current
  // full name (null when there isn't one, or the read failed) so a caller that needs to GREET the
  // person — the welcome toast — can wait for the editable name instead of the frozen signup one.
  const loadProfile = useCallback(async (current: User): Promise<string | null> => {
    const sb = getBrowserSupabase();
    const { data, error } = await sb
      .from('profiles')
      .select('id, full_name, phone, role, date_of_birth')
      .eq('id', current.id)
      .maybeSingle();

    if (error) {
      // Don't block the session on a profile read hiccup; leave it null.
      setProfile(null);
      return null;
    }

    if (data) {
      setProfile({
        id: data.id,
        fullName: data.full_name,
        phone: data.phone,
        dateOfBirth: data.date_of_birth,
        role: data.role,
      });
      return data.full_name;
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
      .select('id, full_name, phone, role, date_of_birth')
      .maybeSingle();

    if (insertError) {
      // A concurrent sign-in (e.g. a second tab) may have created the row first, tripping
      // the primary-key constraint — re-read it rather than masking the failure.
      const { data: existing } = await sb
        .from('profiles')
        .select('id, full_name, phone, role, date_of_birth')
        .eq('id', current.id)
        .maybeSingle();
      setProfile(
        existing
          ? {
              id: existing.id,
              fullName: existing.full_name,
              phone: existing.phone,
              dateOfBirth: existing.date_of_birth,
              role: existing.role,
            }
          : null,
      );
      return existing?.full_name ?? null;
    }

    setProfile(
      inserted
        ? {
            id: inserted.id,
            fullName: inserted.full_name,
            phone: inserted.phone,
            dateOfBirth: inserted.date_of_birth,
            role: inserted.role,
          }
        : { id: current.id, fullName, phone: null, dateOfBirth: null, role: 'customer' },
    );
    return inserted ? inserted.full_name : fullName;
  }, []);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let active = true;
    // Track which user we've already loaded a profile for, so the initial getSession and
    // the INITIAL_SESSION event (and token refreshes) don't each refetch the profile.
    let loadedFor: string | null = null;

    // Welcome-toast detection. Detecting via the SIGNED_IN event alone is unreliable: on the
    // OAuth / email-confirmation callback the session is restored before SIGNED_IN is emitted,
    // so we'd miss it. Instead we toast on a transition TO a user, primed by whether a session
    // was already stored before this page's JS ran (a logged-in reload must NOT toast).
    let hadStored = false;
    try {
      hadStored = typeof window !== 'undefined' && !!window.localStorage.getItem('gytm:auth');
    } catch {
      hadStored = false;
    }
    let prevUserId: string | null = null;
    let sawSignedOut = false;

    /**
     * Greet the person by the name they can actually CHANGE.
     *
     * `user_metadata.full_name` is written once at registration and never again, so someone who
     * corrected their name in /account kept being welcomed as whoever they signed up as — and only
     * ever by their first word. `profiles.full_name` is the editable one the header and /account
     * already render, so the toast now waits the one round-trip for it and shows it whole.
     */
    const welcome = (name: string | null) => {
      if (!active) return;
      showToast({
        title: t("You're logged in"),
        description: name
          ? t('Signed in as {name}.', { name })
          : t('Signed in to Belle Mare Tours.'),
      });
    };

    const apply = (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      // A guest is a session without a user (see AuthContextValue): no profile row, no welcome toast,
      // no claim, and a later real sign-in still counts as a fresh login below.
      const guest = nextSession?.user.is_anonymous === true;
      setIsGuest(guest);
      const u = guest ? null : (nextSession?.user ?? null);
      setUser(u);
      const nextId = u?.id ?? null;

      // Foreground-only, so a cross-tab auth broadcast doesn't pop a toast in a background tab.
      const foreground = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      // A genuine interactive sign-in: a transition to a (new) user that is either not the
      // pre-existing stored session or follows a sign-out in this tab.
      const freshLogin =
        nextId != null && nextId !== prevUserId && (!hadStored || sawSignedOut) && foreground;
      // A sign-out: a transition from a real user back to no user (explicit log out, a
      // cross-tab sign-out, or an expired session) — not the initial logged-out load.
      const signedOut = nextId == null && prevUserId != null && foreground;
      // The welcome toast is deferred to the profile load below — see `welcome`.
      if (signedOut) {
        showToast({
          title: t('Signed out'),
          description: t('See you next time.'),
          variant: 'info',
        });
      }
      if (nextId == null) sawSignedOut = true;
      prevUserId = nextId;

      if (u) {
        if (u.id !== loadedFor) {
          loadedFor = u.id;
          // Captured, not read from the closure later: by the time the profile resolves another
          // auth event may have moved `freshLogin` on.
          const greet = freshLogin;
          void loadProfile(u).then((name) => {
            // Fall back to the signup name only when the profile has none (or wouldn't read) —
            // never greet a named person by their stale one.
            if (greet) welcome(welcomeName(name, u));
          });
          // Once per user per page load, alongside the profile row. A guest who paid a quote before
          // they had an account has an ownerless booking the RLS policy cannot match; this is what
          // hands it to them. Idempotent, so running it on every sign-in costs one no-op statement.
          void claimGuestQuoteBookings();
          if (nextSession) {
            void claimPaidGuestBookings(u.id, nextSession.access_token, greet).then((claimed) => {
              if (!active || claimed === 0) return;
              showToast({
                title:
                  claimed === 1
                    ? t('We added your booking to your account')
                    : t('We added your bookings to your account'),
                description: t('It was made as a guest with this email address.'),
              });
            });
          }
        }
      } else {
        loadedFor = null;
        setProfile(null);
      }
    };

    sb.auth.getSession().then(({ data }) => {
      apply(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, nextSession) => apply(nextSession));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, showToast, t]);

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
    () => ({
      user,
      session,
      isGuest,
      profile,
      loading,
      openAuth,
      closeAuth,
      signOut,
      refreshProfile,
    }),
    [user, session, isGuest, profile, loading, openAuth, closeAuth, signOut, refreshProfile],
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
