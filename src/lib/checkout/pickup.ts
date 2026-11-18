/**
 * Does a vehicle collect this party door to door — i.e. is pickup MANDATORY rather than offered?
 * True for both vehicle pricing modes: 'vehicle' (sightseeing tours) and 'vehicle_custom' (the AI
 * road-trip product). They differ only in which config table the brackets are read from.
 *
 * Lives here, not next to pricingModeSchema, on purpose: this module is deliberately dependency-free
 * so the checkout client bundle can import it without dragging zod and the pricing service in with it.
 *
 * It is also NOT a blanket replacement for the many `pricingMode === 'vehicle'` checks around the
 * catalogue — those describe the sightseeing product specifically, and the planner activity is hidden
 * from every catalogue surface, so they never see it. Use this where the question really is "does a
 * vehicle collect them?".
 *
 * Takes a plain string because it reads a loosely-typed API response; an unknown mode answers false,
 * which is the conservative direction (pickup offered rather than assumed).
 */
export function isVehiclePriced(pricingMode: string | null | undefined): boolean {
  return pricingMode === 'vehicle' || pricingMode === 'vehicle_custom';
}

export interface Step1State {
  wantsPickup: boolean;
  address: string;
  tbd: boolean;
}

/** Step 1 can advance unless pickup is wanted with no address and not flagged "I don't know yet". */
export function canAdvanceStep1(s: Step1State): boolean {
  if (!s.wantsPickup) return true;
  if (s.tbd) return true;
  return s.address.trim().length > 0;
}

/**
 * Must the typed pickup be turned into a map pin before step ① advances? Only for tours whose
 * transport add-on is priced from the pickup's coordinates (per_person / per_group with pickup):
 * api_book charges it ONLY when coords arrive, and silently charges €0 otherwise. Typed text with no
 * pin used to slip through (BMTB1FD2E9A58637, 18 Nov 2026 — €30 never charged). Vehicle tours and
 * transfers price the drive differently, and "I don't know yet" is a deliberate no-address booking.
 */
export function needsPickupPin(s: {
  transportPriced: boolean;
  wantsPickup: boolean;
  tbd: boolean;
  hasCoords: boolean;
}): boolean {
  return s.transportPriced && s.wantsPickup && !s.tbd && !s.hasCoords;
}

/** Step ① defaults to "yes, pickup" when the activity supports pickup, a fee was already computed,
 *  or an upstream entry point pre-filled a pickup address. */
export function defaultWantsPickup(input: {
  pickupCapable: boolean;
  hasTransportHint: boolean;
  hasPickupPrefill: boolean;
}): boolean {
  return input.pickupCapable || input.hasTransportHint || input.hasPickupPrefill;
}
