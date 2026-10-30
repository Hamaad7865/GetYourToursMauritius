/**
 * The signed manage link in a guest booking's emails.
 *
 * A DETERMINISTIC HMAC of the booking id + a version, for the reason the installment link is one
 * (src/lib/quotes/installment-token.ts): guest emails go out days or weeks after the booking, from the
 * notification drain (a pickup reminder, a weather move), so the raw token has to be recomputable at
 * send time. Nothing bearer-shaped is written to notification_outbox or anywhere else, so a database
 * leak exposes no links. Staff revoke by bumping the version (`booking_guest_links`).
 *
 * The prefix keeps this token from ever verifying as an installment token, which may share the secret.
 * Edge-safe: Web Crypto only.
 */
import { getServerEnv } from '@/lib/config/env';
import { hmacHex } from '@/lib/quotes/installment-token';

/**
 * The signing key first, then every key an already-sent link may have been signed with. Optional
 * config: without GUEST_LINK_SECRET this falls back like the installment link, so no new setting is
 * needed, and adding a dedicated key later does not kill links already in inboxes.
 */
function linkSecrets(): string[] {
  const env = getServerEnv();
  const secrets = [
    env.GUEST_LINK_SECRET,
    env.GUEST_LINK_SECRET_PREVIOUS,
    env.PAYMENT_LINK_SECRET,
    env.SUPABASE_JWT_SECRET,
    env.SUPABASE_SERVICE_ROLE_KEY,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) {
    throw new Error(
      'link-token: GUEST_LINK_SECRET (or PAYMENT_LINK_SECRET / SUPABASE_JWT_SECRET / the service-role ' +
        'key) must be set to mint or verify guest links.',
    );
  }
  return secrets;
}

/** The signed message: the booking's uuid, never its public ref. */
export function guestLinkMessage(bookingId: string, version: number): string {
  return `guest-link:v1:${bookingId}:${version}`;
}

export async function mintGuestLinkToken(bookingId: string, version: number): Promise<string> {
  const [signingKey] = linkSecrets() as [string, ...string[]];
  return hmacHex(signingKey, guestLinkMessage(bookingId, version));
}

/** Constant-time verify against every key in {@link linkSecrets}. Fails closed on the wrong shape. */
export async function guestLinkTokenMatches(
  bookingId: string,
  version: number,
  token: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  let matched = false;
  for (const secret of linkSecrets()) {
    const expected = await hmacHex(secret, guestLinkMessage(bookingId, version));
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
    }
    if (diff === 0) matched = true;
  }
  return matched;
}
