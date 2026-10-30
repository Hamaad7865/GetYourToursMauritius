import { getServerEnv } from '@/lib/config/env';
import { isProductionLikeRuntime } from '@/lib/config/runtime';
import { ConfigError, ForbiddenError, ProviderError } from '@/lib/services/errors';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

/**
 * Cloudflare Turnstile on guest booking creation: the one control that makes a scripted guest identity
 * cost something, because Supabase will mint anonymous users for anyone holding the public key.
 *
 * With no secret configured this is a no-op in `next dev` and refuses everywhere production-like, so a
 * missing key can never quietly leave the door open. settings/guest-checkout.ts keeps the guest form
 * hidden in that state, so a visitor never reaches this refusal.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null,
): Promise<void> {
  const env = getServerEnv();
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (isProductionLikeRuntime(env)) throw new ConfigError('Turnstile is not configured');
    return;
  }
  if (!token) throw new ForbiddenError('Please complete the security check and try again.');

  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set('remoteip', ip);

  let success = false;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const json = (await res.json()) as { success?: unknown };
    success = json.success === true;
  } catch {
    throw new ProviderError('The security check is unavailable — please try again.');
  }
  if (!success) throw new ForbiddenError('Please complete the security check and try again.');
}
