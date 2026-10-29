/**
 * The account dialog is global (AuthProvider renders it), so a page that wants to know how it went —
 * checkout's step telemetry (20261029120000) — listens for this window event instead of the dialog
 * importing checkout code. Fire-and-forget: nothing listens on most pages.
 */
export const AUTH_RESULT_EVENT = 'gytm:auth-result';

export type AuthResult = 'signup_email_sent' | 'auth_failed';

export function announceAuthResult(result: AuthResult): void {
  try {
    window.dispatchEvent(new CustomEvent<AuthResult>(AUTH_RESULT_EVENT, { detail: result }));
  } catch {
    /* no window / CustomEvent — nothing to tell */
  }
}
