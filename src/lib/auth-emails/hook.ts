import { timingSafeEqual } from '@/lib/http/auth';
import type { AuthEmailKind, AuthEmailLang } from './templates';

/**
 * Supabase Send-Email Auth Hook plumbing: Standard-Webhooks signature verification + payload
 * shaping. With the hook enabled, Supabase does NOT send auth emails itself — it POSTs this signed
 * payload and OUR endpoint composes + sends the email (which is what makes per-user language
 * possible; the dashboard templates are single-language).
 *
 * Signature scheme (https://www.standardwebhooks.com): headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature`; the signature is base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)).
 * The dashboard shows the secret as `v1,whsec_<base64>`; the base64 part decodes to the key BYTES.
 * `webhook-signature` may carry several space-separated `v1,<sig>` entries (key rotation) — any
 * match passes. Timestamps outside ±5 minutes are rejected (replay).
 */

const TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(raw: string): Uint8Array {
  // Tolerate `v1,whsec_…`, `whsec_…` or bare base64 — dashboards have shown all three.
  const b64 = raw.replace(/^v1,/, '').replace(/^whsec_/, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function verifyHookSignature(args: {
  secret: string;
  rawBody: string;
  headers: { id: string | null; timestamp: string | null; signature: string | null };
}): Promise<boolean> {
  const { id, timestamp, signature } = args.headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'raw',
      decodeSecret(args.secret) as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    return false; // malformed secret — fail closed
  }
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${args.rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Each entry looks like `v1,<base64>`; only v1 entries are ours to check.
  for (const entry of signature.split(' ')) {
    const [version, sig] = entry.split(',');
    if (version !== 'v1' || !sig) continue;
    if (await timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

/** The subset of the hook payload this endpoint consumes. */
export interface SendEmailHookPayload {
  user: {
    email?: string;
    new_email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    redirect_to?: string;
    email_action_type?: string;
  };
}

/**
 * The user's email language. Priority:
 *  1. `user_metadata.lang` — stamped at signup with the site language the account was created in;
 *  2. `?lang=` on the redirect URL — the signed-out reset path, where the CURRENT UI language is
 *     the only signal (no metadata write is possible without a session);
 *  3. English.
 */
export function resolveLang(payload: SendEmailHookPayload): AuthEmailLang {
  const meta = payload.user.user_metadata?.lang;
  if (meta === 'fr' || meta === 'en') return meta;
  try {
    const lang = new URL(payload.email_data.redirect_to ?? '').searchParams.get('lang');
    if (lang === 'fr' || lang === 'en') return lang;
  } catch {
    /* absent/relative redirect — fall through */
  }
  return 'en';
}

/** Map Supabase's action type onto our template kinds. Unknown types map to null (caller 200s
 *  with a log rather than breaking an auth flow we did not anticipate). */
export function kindFor(actionType: string | undefined): AuthEmailKind | null {
  switch (actionType) {
    case 'recovery':
      return 'recovery';
    case 'signup':
    case 'invite':
      return 'signup';
    case 'magiclink':
      return 'magiclink';
    case 'email_change':
    case 'email_change_current':
    case 'email_change_new':
      return 'email_change';
    case 'reauthentication':
      return 'reauthentication';
    default:
      return null;
  }
}

/**
 * The confirmation link — the same URL Supabase's own `{{ .ConfirmationURL }}` builds: the
 * project's GoTrue verify endpoint, which consumes the token hash and then redirects to
 * `redirect_to` with the session/`?code` exactly as the client flow (PKCE, AuthCallback,
 * /auth/reset-password) already expects. No client changes needed.
 */
export function buildVerifyUrl(args: {
  supabaseUrl: string;
  tokenHash: string;
  actionType: string;
  redirectTo?: string;
}): string {
  const url = new URL('/auth/v1/verify', args.supabaseUrl);
  url.searchParams.set('token', args.tokenHash);
  url.searchParams.set('type', args.actionType);
  if (args.redirectTo) url.searchParams.set('redirect_to', args.redirectTo);
  return url.toString();
}
