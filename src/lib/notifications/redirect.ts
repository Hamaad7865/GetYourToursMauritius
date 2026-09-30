/**
 * SANDBOX ONLY — the pieces of `EMAIL_REDIRECT_TO` (deliver every email to ONE inbox) shared by every
 * code path that sends mail: the notification provider and the Supabase auth-email hook. One place, so
 * the two cannot drift apart and the claim "nothing reaches anyone else" stays true for both.
 */
import { ConfigError } from '@/lib/services/errors';

/**
 * A live-payments deployment must never carry the redirect: every customer's confirmation would land
 * in that one inbox. Refuse to send rather than quietly do it.
 */
export function assertRedirectAllowed(env: {
  EMAIL_REDIRECT_TO?: string;
  PEACH_ENVIRONMENT?: string;
}): void {
  if (env.EMAIL_REDIRECT_TO && env.PEACH_ENVIRONMENT === 'live') {
    throw new ConfigError(
      'EMAIL_REDIRECT_TO is set on a live-payments deployment: every customer email would be diverted ' +
        'to one inbox. Unset it.',
    );
  }
}

/** The subject of a redirected email: who it was really for, then the real subject. */
export function tagSubject(original: string, subject: string): string {
  return `[sandbox → ${original}] ${subject}`;
}

/** The line put in front of a redirected email's plain-text body. */
export function redirectTextNote(original: string): string {
  return `[SANDBOX — this email was addressed to ${original}; the sandbox delivers every email to one inbox.]\n\n`;
}

/** Minimal HTML escaping for the one untrusted value put in markup here: a recipient address. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The banner shown above a redirected email's HTML part, naming who it was really for. */
export function withSandboxBanner(html: string, original: string): string {
  const banner =
    '<div style="background:#fff4d6;color:#5b4300;padding:8px 12px;font:13px/1.4 Arial,sans-serif;' +
    `border-bottom:1px solid #e6c36a">SANDBOX — this email was addressed to ${escapeHtml(original)}. ` +
    'The sandbox delivers every email to one inbox.</div>';
  const open = /<body[^>]*>/i;
  return open.test(html) ? html.replace(open, (tag) => `${tag}${banner}`) : `${banner}${html}`;
}
