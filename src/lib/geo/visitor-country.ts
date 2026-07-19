import { headers } from 'next/headers';
import { MAURITIUS_COUNTRY } from './mauritius';

/**
 * Where the visitor is browsing from, inferred at the edge from Cloudflare's `CF-IPCountry` header
 * (the same channel `cf-connecting-ip` already uses for rate limiting — no extra request, no cookie,
 * nothing stored).
 *
 * This is a UI-VISIBILITY gate only: it decides whether a Mauritius-only affordance ("use my current
 * location") is worth offering. It is NEVER the authority on whether a coordinate is in Mauritius —
 * `isInMauritius()` on the real fix is, because an IP can be a VPN, a roaming SIM, or simply wrong.
 */
export type VisitorLocality =
  | 'mauritius' // Cloudflare says this visitor is on the island
  | 'abroad' // Cloudflare says a different country — the pick-up stays our base
  | 'unknown'; // no header (local dev, or not behind Cloudflare)

/** Classify a raw CF-IPCountry value. Pure, so the fail-open rule is unit-testable. */
export function localityFromCountry(country: string | null | undefined): VisitorLocality {
  if (!country) return 'unknown';
  const code = country.trim().toUpperCase();
  // Cloudflare sends 'XX' when it cannot determine the country, and 'T1' for Tor exit nodes.
  if (!code || code === 'XX' || code === 'T1') return 'unknown';
  return code === MAURITIUS_COUNTRY ? 'mauritius' : 'abroad';
}

/**
 * The current request's locality. Safe to call from a server component; returns 'unknown' rather
 * than throwing if headers aren't available.
 *
 * `unknown` deliberately behaves like 'mauritius' for VISIBILITY (see the caller): the affordance
 * stays offered when we can't tell, because the coordinate check is what actually protects the
 * booking, and failing closed would silently kill the feature if Cloudflare ever stopped sending the
 * header. Only a CONFIRMED foreign country hides it.
 */
export async function visitorLocality(): Promise<VisitorLocality> {
  try {
    const h = await headers();
    return localityFromCountry(h.get('cf-ipcountry'));
  } catch {
    return 'unknown';
  }
}
