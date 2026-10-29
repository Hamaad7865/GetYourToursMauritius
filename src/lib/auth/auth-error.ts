type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * A sign-in / sign-up failure, said the way a guest can act on it. `suggest` names the other mode
 * when switching is the fix (a new guest typing a fresh password into "Sign in" is the common case
 * at checkout), so the dialog can offer it as a button.
 */
export type FriendlyAuthError = { message: string; suggest: 'signin' | 'signup' | null };

/**
 * Maps a Supabase auth error to a translated message. Supabase's own messages are English-only and
 * written for developers ("Invalid login credentials", "For security purposes, you can only request
 * this after 50 seconds."), and checkout guests were seeing them verbatim. Keyed on `error.code`
 * (auth-js ≥ 2.6x), with the HTTP status as the fallback signal.
 *
 * Every branch passes a string LITERAL to the translator on purpose: the i18n scanner only sees
 * literal keys, so a lookup table here would silently fall back to English in French.
 */
export function friendlyAuthError(err: unknown, t: Translate): FriendlyAuthError {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  switch (code) {
    case 'invalid_credentials':
      return {
        message: t('That email and password don’t match. New here? Create an account instead.'),
        suggest: 'signup',
      };
    case 'email_not_confirmed':
      return {
        message: t(
          'Please confirm your email first: open the link we sent you, then sign in here.',
        ),
        suggest: null,
      };
    case 'over_email_send_rate_limit':
      return {
        message: t(
          'We’ve just sent you an email. Check your inbox and spam folder; you can ask for another one in a minute.',
        ),
        suggest: null,
      };
    case 'user_already_exists':
    case 'email_exists':
      return {
        message: t('This email already has an account. Sign in instead.'),
        suggest: 'signin',
      };
    case 'weak_password':
      return {
        message: t('That password is too weak. Please choose a longer one.'),
        suggest: null,
      };
    case 'email_address_invalid':
      return { message: t('Please check your email address.'), suggest: null };
  }

  if (code === 'over_request_rate_limit' || status === 429) {
    return { message: t('Too many attempts. Please wait a minute and try again.'), suggest: null };
  }
  // A dropped connection: fetch's TypeError, or auth-js's retryable fetch error (status 0 or none).
  if (e.name === 'TypeError' || e.name === 'AuthRetryableFetchError') {
    return {
      message: t('We couldn’t reach the sign-in service. Check your connection and try again.'),
      suggest: null,
    };
  }
  // An unmapped code keeps Supabase's own wording — it is usually specific enough to act on.
  if (typeof e.message === 'string' && e.message.trim()) {
    return { message: e.message, suggest: null };
  }
  return { message: t('Something went wrong. Please try again.'), suggest: null };
}
