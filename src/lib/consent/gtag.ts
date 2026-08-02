import { type ConsentChoice, consentModePayload } from './notice';

/**
 * Browser-side bridge to Google Consent Mode. `gtag` is defined by the inline bootstrap in
 * `GoogleTagManager.tsx`, which always runs before this can be called (it is in the initial HTML;
 * this only fires from a click handler). Calling it pushes onto the same `dataLayer` the container
 * reads, so GTM re-evaluates every tag's consent state immediately — no reload needed.
 */
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Event the /cookies page dispatches to reopen the banner so a visitor can withdraw consent. */
export const OPEN_CONSENT_EVENT = 'gytm:open-cookie-settings';

/** Pushes the choice to Consent Mode. No-ops when the container is absent (env override, blockers). */
export function applyConsent(choice: ConsentChoice): void {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('consent', 'update', consentModePayload(choice));
  } catch {
    // A blocked/failed container must never break the banner interaction.
  }
}

/** Reopens the consent banner from anywhere (e.g. the "Change cookie settings" button). */
export function openConsentSettings(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT));
}
