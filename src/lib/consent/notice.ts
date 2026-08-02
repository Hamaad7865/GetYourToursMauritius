/**
 * Cookie-consent state, stored under localStorage['gytm:cookie-notice'].
 *
 * This was a NOTICE-ONLY model (one "Accept", no gating) — valid only while the site set no
 * analytics or advertising cookies. Installing the Google Tag Manager container (GA4 fires inside
 * it) ended that, so consent is now per-category and actually gates the tags via Google Consent
 * Mode v2: the tags load either way, but `analytics_storage` / `ad_storage` start DENIED and only
 * flip when the visitor opts in.
 *
 * Bump NOTICE_VERSION whenever the categories or the policy materially change — a stored
 * acknowledgement at an older version re-prompts, because consent to the old terms is not consent
 * to the new ones. v1 = the old notice-only bar; v2 = per-category consent with analytics/marketing.
 */
export const NOTICE_VERSION = 2;
export const NOTICE_KEY = 'gytm:cookie-notice';

/** The opt-in categories. `necessary` is not represented — it is always on and never asked about. */
export interface ConsentChoice {
  analytics: boolean;
  marketing: boolean;
}

/** Nothing opted in. The pre-consent default, and what "Reject all" stores. */
export const CONSENT_DENIED: ConsentChoice = { analytics: false, marketing: false };
/** What "Accept all" stores. */
export const CONSENT_GRANTED: ConsentChoice = { analytics: true, marketing: true };

interface StoredConsent {
  version?: number;
  ts?: number;
  analytics?: boolean;
  marketing?: boolean;
}

function parse(stored: string | null): StoredConsent | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as unknown;
    return v && typeof v === 'object' ? (v as StoredConsent) : null;
  } catch {
    return null;
  }
}

/**
 * Show the banner unless a choice was recorded at the CURRENT version. A v1 acknowledgement does
 * not count: that visitor agreed to a notice that promised no tracking, so they must be asked again
 * now that analytics exists.
 */
export function shouldShowNotice(stored: string | null): boolean {
  const v = parse(stored);
  return !(v && v.version === NOTICE_VERSION);
}

/**
 * The visitor's stored choice, or null when they have not chosen at the current version. Callers
 * must treat null as "denied" — absence of a choice is never consent.
 */
export function readConsent(stored: string | null): ConsentChoice | null {
  const v = parse(stored);
  if (!v || v.version !== NOTICE_VERSION) return null;
  return { analytics: v.analytics === true, marketing: v.marketing === true };
}

export function serializeConsent(choice: ConsentChoice, now: number): string {
  return JSON.stringify({
    version: NOTICE_VERSION,
    ts: now,
    analytics: choice.analytics,
    marketing: choice.marketing,
  });
}

/** Google Consent Mode v2 signal names. */
export type ConsentSignal =
  | 'ad_storage'
  | 'ad_user_data'
  | 'ad_personalization'
  | 'analytics_storage'
  | 'functionality_storage'
  | 'personalization_storage'
  | 'security_storage';

/**
 * A choice as the Consent Mode v2 payload for `gtag('consent', 'update', …)`.
 *
 * `security_storage` and `functionality_storage` are always granted — they cover strictly-necessary
 * things (auth session, cart, language/currency prefs) that the site cannot work without and which
 * do not require opt-in. The three ad_* signals move together off `marketing`: splitting them would
 * imply a granularity the banner does not actually offer.
 */
export function consentModePayload(
  choice: ConsentChoice,
): Record<ConsentSignal, 'granted' | 'denied'> {
  const analytics = choice.analytics ? 'granted' : 'denied';
  const marketing = choice.marketing ? 'granted' : 'denied';
  return {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
    personalization_storage: marketing,
    functionality_storage: 'granted',
    security_storage: 'granted',
  };
}
