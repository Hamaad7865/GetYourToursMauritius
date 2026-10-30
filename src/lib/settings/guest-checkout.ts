import { createUserClient } from '@/lib/supabase/client';
import { getServerEnv } from '@/lib/config/env';
import { isProductionLikeRuntime } from '@/lib/config/runtime';

export interface GuestCheckoutConfig {
  /** Show the guest form at step ②, and accept anonymous bookings. */
  enabled: boolean;
  /** Public by design, so read at request time and handed to the page: no rebuild to rotate it. */
  turnstileSiteKey: string | null;
}

/**
 * The owner's kill switch (`business_settings.guest_checkout_enabled_at`, NULL = off).
 *
 * FAILS CLOSED, to today's account gate: a read error, or a column that is not there yet, is "off".
 * Production-like runtimes also need both Turnstile keys, so switching this on before the keys are set
 * leaves the site exactly as it was rather than refusing every guest at Pay.
 *
 * Read through the anon client (the `business_settings_public_read` policy allows it). Never cached, so
 * flipping the switch takes effect on the next request. No React here: POST /bookings imports this.
 */
export async function readGuestCheckoutConfig(): Promise<GuestCheckoutConfig> {
  const env = getServerEnv();
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;
  const turnstileReady = Boolean(turnstileSiteKey && env.TURNSTILE_SECRET_KEY);
  try {
    const { data, error } = await createUserClient()
      .from('business_settings')
      .select('guest_checkout_enabled_at')
      .limit(1)
      .maybeSingle();
    if (error || !data?.guest_checkout_enabled_at) return { enabled: false, turnstileSiteKey };
    return { enabled: turnstileReady || !isProductionLikeRuntime(env), turnstileSiteKey };
  } catch {
    return { enabled: false, turnstileSiteKey };
  }
}
