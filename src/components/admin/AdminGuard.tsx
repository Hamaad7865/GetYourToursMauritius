'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

/** Gates the admin area to staff/admin profiles. Customers and signed-out users are blocked. */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, profile, loading, openAuth } = useAuth();

  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (!user) {
    return (
      <Centered>
        <p className="text-sm text-ink-muted">You need to sign in to access the admin.</p>
        <button
          type="button"
          onClick={() => openAuth('signin')}
          className="mt-4 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          Sign in
        </button>
      </Centered>
    );
  }
  const role = profile?.role;
  if (role !== 'admin' && role !== 'staff') {
    return (
      <Centered>
        <h1 className="font-display text-2xl font-semibold text-ink">Not authorised</h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          You&apos;re signed in as {user.email}, but this account isn&apos;t an admin yet. Ask an
          administrator to grant you access.
        </p>
      </Centered>
    );
  }
  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center px-6 text-center">{<div>{children}</div>}</div>;
}
