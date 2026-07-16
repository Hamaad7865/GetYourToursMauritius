import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { getServerEnv } from '@/lib/config/env';
import { SITE } from '@/lib/seo/site';
import {
  buildVerifyUrl,
  kindFor,
  resolveLang,
  verifyHookSignature,
  type SendEmailHookPayload,
} from '@/lib/auth-emails/hook';
import { renderAuthEmail, type AuthEmailKind } from '@/lib/auth-emails/templates';

export const runtime = 'edge';

/**
 * POST /api/v1/hooks/send-email — Supabase Send-Email Auth Hook receiver.
 *
 * With the hook enabled in Supabase (Authentication → Hooks → Send Email), Supabase no longer
 * sends auth emails itself: it POSTs the token payload here (Standard-Webhooks HMAC signature) and
 * THIS endpoint renders the email in the USER'S language (EN/FR) and sends it through Resend from
 * accounts@… — per-user language is impossible with the single-language dashboard templates.
 *
 * Failure philosophy: every failure is LOUD. A missing secret/key answers 503 and a failed Resend
 * send answers 500 — both surface as an immediate error on the customer's auth action (which they
 * can retry) instead of a silently-never-arriving email. The one exception is replay-stale or
 * forged signatures (401): those are attacker-shaped, not customer-shaped.
 */
export const POST = apiHandler(async (req) => {
  const env = getServerEnv();
  const secret = env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) {
    // Hook enabled in Supabase but the secret never reached this deploy — refuse loudly rather
    // than let every reset/signup email silently vanish.
    return jsonError(503, 'not_configured', 'SEND_EMAIL_HOOK_SECRET is not set');
  }
  const apiKey = env.RESEND_API_KEY;
  const from = env.AUTH_EMAIL_FROM ?? env.RESEND_FROM;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiKey || !from || !supabaseUrl) {
    return jsonError(
      503,
      'not_configured',
      'RESEND_API_KEY / sender identity / NEXT_PUBLIC_SUPABASE_URL is not set',
    );
  }

  const rawBody = await req.text();
  const ok = await verifyHookSignature({
    secret,
    rawBody,
    headers: {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
  });
  if (!ok) return jsonError(401, 'unauthorized', 'Invalid webhook signature');

  const payload = JSON.parse(rawBody) as SendEmailHookPayload;
  const actionType = payload.email_data.email_action_type;
  const kind = kindFor(actionType);
  if (!kind || !payload.user.email) {
    // An auth flow we didn't anticipate: failing is BETTER than 200-ing — a 200 tells Supabase the
    // email was sent, and the customer waits forever for mail that never existed.
    console.error('[auth-email] unhandled hook payload', {
      actionType,
      hasEmail: Boolean(payload.user.email),
    });
    return jsonError(422, 'validation_error', `Unhandled email_action_type: ${actionType}`);
  }

  const userEmail = payload.user.email; // narrowed once — the guard above proved it exists
  const lang = resolveLang(payload);
  const redirectTo = payload.email_data.redirect_to;

  const emails: Array<{ to: string; kind: AuthEmailKind; tokenHash?: string; code?: string }> = [];
  if (kind === 'reauthentication') {
    emails.push({ to: userEmail, kind, code: payload.email_data.token });
  } else if (
    kind === 'email_change' &&
    payload.email_data.token_hash_new &&
    payload.user.new_email
  ) {
    // Secure email change (double confirm): ONE hook call carries BOTH tokens — the current
    // address approves with token_hash, the new address with token_hash_new.
    emails.push({ to: userEmail, kind, tokenHash: payload.email_data.token_hash });
    emails.push({ to: payload.user.new_email, kind, tokenHash: payload.email_data.token_hash_new });
  } else {
    const to =
      actionType === 'email_change_new' ? (payload.user.new_email ?? userEmail) : userEmail;
    emails.push({ to, kind, tokenHash: payload.email_data.token_hash });
  }

  let sent = 0;
  for (const mail of emails) {
    if (!mail.code && !mail.tokenHash) {
      return jsonError(422, 'validation_error', 'Hook payload carried no token');
    }
    const { subject, html } = renderAuthEmail({
      kind: mail.kind,
      lang,
      email: userEmail,
      newEmail: payload.user.new_email ?? undefined,
      code: mail.code,
      actionUrl: mail.tokenHash
        ? buildVerifyUrl({
            supabaseUrl,
            tokenHash: mail.tokenHash,
            actionType: actionType!,
            redirectTo,
          })
        : undefined,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: mail.to, subject, html, reply_to: SITE.email }),
    });
    if (!res.ok) {
      // Loud + retryable: Supabase surfaces the failure on the auth call itself. 500, NOT 502 —
      // Cloudflare replaces a Function's 502 with its own HTML gateway page (see ProviderError in
      // src/lib/services/errors.ts), so the JSON body would never reach the caller.
      const detail = await res.text().catch(() => '');
      console.error('[auth-email] resend send failed', {
        status: res.status,
        kind: mail.kind,
        detail: detail.slice(0, 200),
      });
      return jsonError(500, 'provider_error', `Email provider rejected the send (${res.status})`);
    }
    sent += 1;
  }

  return jsonOk({ sent });
});
