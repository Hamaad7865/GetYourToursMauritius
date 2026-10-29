import { describe, expect, it } from 'vitest';
import { friendlyAuthError } from '@/lib/auth/auth-error';
import { fr } from '@/lib/i18n/messages';

/**
 * Sign-in / sign-up failures in the guest's words. Before this, checkout showed Supabase's raw
 * English ("Invalid login credentials", "For security purposes, you can only request this after 50
 * seconds.") — and the auth logs showed new guests typing a fresh password into "Sign in", failing,
 * and some never getting through (2026-10-29).
 */
describe('friendlyAuthError', () => {
  const t = (key: string) => key;
  const authError = (code: string, status = 400, message = 'raw supabase text') =>
    Object.assign(new Error(message), { name: 'AuthApiError', code, status });

  it('points a new guest who typed into "Sign in" at creating an account', () => {
    const r = friendlyAuthError(authError('invalid_credentials'), t);
    expect(r.suggest).toBe('signup');
    expect(r.message).not.toContain('raw supabase text');
  });

  it('points an existing address on sign-up at signing in', () => {
    expect(friendlyAuthError(authError('user_already_exists', 422), t).suggest).toBe('signin');
    expect(friendlyAuthError(authError('email_exists', 422), t).suggest).toBe('signin');
  });

  it('turns the repeat-signup rate limit into "we already sent it"', () => {
    const r = friendlyAuthError(authError('over_email_send_rate_limit', 429), t);
    expect(r.message).toMatch(/just sent you an email/);
    expect(r.suggest).toBeNull();
  });

  it('explains an unconfirmed email instead of failing silently', () => {
    expect(friendlyAuthError(authError('email_not_confirmed'), t).message).toMatch(
      /confirm your email/,
    );
  });

  it('treats any other 429 as too many attempts', () => {
    expect(friendlyAuthError(authError('something_new', 429), t).message).toMatch(/Too many/);
  });

  it('names a dropped connection', () => {
    expect(friendlyAuthError(new TypeError('Failed to fetch'), t).message).toMatch(/connection/);
    const retryable = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' });
    expect(friendlyAuthError(retryable, t).message).toMatch(/connection/);
  });

  it('keeps Supabase wording for an unmapped code, and a generic line when there is none', () => {
    expect(friendlyAuthError(authError('brand_new_code', 400, 'Specific reason'), t).message).toBe(
      'Specific reason',
    );
    expect(friendlyAuthError(undefined, t).message).toBe('Something went wrong. Please try again.');
  });

  it('has a French translation for every message it can produce', () => {
    const errors = [
      authError('invalid_credentials'),
      authError('email_not_confirmed'),
      authError('over_email_send_rate_limit', 429),
      authError('user_already_exists', 422),
      authError('weak_password', 422),
      authError('email_address_invalid'),
      authError('over_request_rate_limit', 429),
      new TypeError('Failed to fetch'),
      undefined,
    ];
    for (const e of errors) expect(fr[friendlyAuthError(e, t).message]).toBeTruthy();
  });
});
