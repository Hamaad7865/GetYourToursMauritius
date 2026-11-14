'use client';

import { Fragment, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BTN_PRIMARY } from '@/components/admin/ui';

/** Gates the admin area to staff/admin/seo profiles. Customers and signed-out users are blocked. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, profile, loading, openAuth } = useAuth();

  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (!user) {
    return (
      <Centered>
        <p className="text-[13px] text-ink-soft">You need to sign in to access the admin.</p>
        {/* Teal-dark, not the brand teal: white on #0E8C92 is 4.05:1, short of AA for this text. */}
        <button type="button" onClick={() => openAuth('signin')} className={`${BTN_PRIMARY} mt-4`}>
          Sign in
        </button>
      </Centered>
    );
  }
  const role = profile?.role;
  if (role !== 'admin' && role !== 'staff' && role !== 'seo') {
    return (
      <Centered>
        <h1 className="text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-ink">
          Not authorised
        </h1>
        <p className="mt-2 max-w-md text-[13px] text-ink-soft">
          You&apos;re signed in as {user.email}, but this account isn&apos;t an admin yet. Ask an
          administrator to grant you access.
        </p>
      </Centered>
    );
  }
  // Keyed by user: signing in as someone else discards the previous person's screens and their state,
  // rather than carrying them over for the new person to see.
  return <Fragment key={user.id}>{children}</Fragment>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      {<div>{children}</div>}
    </div>
  );
}
