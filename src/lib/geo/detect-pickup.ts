'use client';

import { getCurrentPosition } from './current-position';
import { isInMauritius } from './mauritius';
import { geoPointId, pickPickupName } from './pickup-name';
import { reverseGeocode } from '@/lib/maps/reverse-geocode';

/**
 * The full "where am I" pipeline for the planner pick-up: get a fix → prove it's in Mauritius and
 * precise enough → name it well enough for a driver. Composed from pure, separately-tested parts.
 *
 * Order matters: the geographic gate runs BEFORE the (billed) reverse geocode, so a visitor abroad
 * who taps the control costs nothing and is told plainly, rather than getting a foreign address.
 */

/** A GPS fix vaguer than this can't identify a pick-up — on the Belle Mare strip resorts sit a few
 *  hundred metres apart, so a half-kilometre circle names the wrong hotel as readily as the right
 *  one. Reject rather than guess. */
export const MAX_ACCEPTABLE_ACCURACY_M = 500;

export type PickupDetection =
  | { ok: true; id: string; name: string; lat: number; lng: number }
  /** We have a fix, but it isn't usable as a pick-up. */
  | { ok: false; reason: 'outside-mauritius' | 'imprecise' | 'unnamed' }
  /** We never got a fix. */
  | { ok: false; reason: 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure' };

export interface DetectPickupOptions {
  /** True when the visitor explicitly asked (a tap on "Use my current location"). Permits the
   *  coordinate-string fallback name; the silent automatic path must never plant one. */
  explicit?: boolean;
  timeoutMs?: number;
}

/** Resolve the visitor's position into a usable pick-up point, or a typed reason why not. */
export async function detectPickup(opts: DetectPickupOptions = {}): Promise<PickupDetection> {
  const fix = await getCurrentPosition({ timeoutMs: opts.timeoutMs });
  if (!fix.ok) return { ok: false, reason: fix.reason };

  // Gate 2 — authoritative. Whatever the IP said, a fix outside the island is never a pick-up we can
  // serve, so a VPN, a roaming SIM or a stale foreign fix stops here.
  if (!isInMauritius(fix.lat, fix.lng)) return { ok: false, reason: 'outside-mauritius' };
  if (fix.accuracyM > MAX_ACCEPTABLE_ACCURACY_M) return { ok: false, reason: 'imprecise' };

  // Naming must never be able to throw the whole detection — a dead Geocoder is just "no candidates",
  // which the explicit path can still turn into a coordinate fallback.
  let candidates: Awaited<ReturnType<typeof reverseGeocode>> = [];
  try {
    candidates = await reverseGeocode(fix.lat, fix.lng);
  } catch {
    candidates = [];
  }
  const name = pickPickupName(candidates, fix.lat, fix.lng, {
    allowCoordFallback: opts.explicit === true,
  });
  if (!name) return { ok: false, reason: 'unnamed' };

  return { ok: true, id: geoPointId(fix.lat, fix.lng), name, lat: fix.lat, lng: fix.lng };
}

/**
 * True only when geolocation permission is ALREADY granted, so a position can be read without any
 * prompt appearing.
 *
 * This is what makes the automatic path safe to run: an *unrequested* permission prompt is both a
 * GDPR problem (the visitor asked for a trip planner, not location detection) and self-defeating —
 * browsers penalise unrequested prompts, and a dismissal can poison the permission for the origin,
 * losing the feature for exactly the on-island visitors it targets. So we auto-detect only for
 * visitors who have already said yes, and everyone else gets a one-tap button.
 *
 * Returns false whenever the answer isn't a definite yes (including browsers without the Permissions
 * API, e.g. older Safari), so the default is always "show the button, prompt nothing".
 */
export async function geolocationAlreadyGranted(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
