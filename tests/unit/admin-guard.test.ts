import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { profilePending } from '@/components/auth/AuthProvider';

/**
 * The back office's sign-in gate. On a reload the session is found first and the profile row (which
 * holds the role) arrives one request later; in between, the gate used to say "Not authorised" to the
 * Owner (seen for ~0.25s on 15 Nov 2026). It must wait for the profile before judging the role.
 */

const hoisted = vi.hoisted(() => ({
  auth: null as null | Record<string, unknown>,
}));
vi.mock('@/components/auth/AuthProvider', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/auth/AuthProvider')>();
  return { ...real, useAuth: () => hoisted.auth };
});

const owner = { id: 'u1', email: 'owner@example.test' };

function render(auth: Record<string, unknown>): string {
  hoisted.auth = { openAuth: () => {}, ...auth };
  return renderToStaticMarkup(
    createElement(AdminGuard, null, createElement('p', null, 'The back office')),
  );
}

describe('AdminGuard', () => {
  it('waits while the session is being checked', () => {
    const html = render({ user: null, profile: null, loading: true, profileLoading: false });
    expect(html).toContain('Loading…');
  });

  it('waits while a signed-in person’s profile is still being read, rather than refusing them', () => {
    const html = render({ user: owner, profile: null, loading: false, profileLoading: true });
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Not authorised');
  });

  it('refuses a signed-in customer once their profile has been read', () => {
    const html = render({
      user: owner,
      profile: { id: 'u1', role: 'customer' },
      loading: false,
      profileLoading: false,
    });
    expect(html).toContain('Not authorised');
  });

  it('lets the Owner in once the profile has been read', () => {
    const html = render({
      user: owner,
      profile: { id: 'u1', role: 'admin' },
      loading: false,
      profileLoading: false,
    });
    expect(html).toContain('The back office');
  });

  it('asks a signed-out visitor to sign in', () => {
    const html = render({ user: null, profile: null, loading: false, profileLoading: false });
    expect(html).toContain('You need to sign in');
  });
});

describe('profilePending', () => {
  it('is pending for a signed-in person until their profile read has settled', () => {
    expect(profilePending('u1', null)).toBe(true);
    expect(profilePending('u1', 'u1')).toBe(false);
  });

  it('is pending again when someone else signs in, until their own read settles', () => {
    expect(profilePending('u2', 'u1')).toBe(true);
  });

  it('is never pending with nobody signed in', () => {
    expect(profilePending(null, null)).toBe(false);
    expect(profilePending(null, 'u1')).toBe(false);
  });
});
