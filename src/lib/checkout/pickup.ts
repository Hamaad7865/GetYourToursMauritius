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

/** Step ① defaults to "yes, pickup" when the activity supports pickup, a fee was already computed,
 *  or an upstream entry point pre-filled a pickup address. */
export function defaultWantsPickup(input: {
  pickupCapable: boolean;
  hasTransportHint: boolean;
  hasPickupPrefill: boolean;
}): boolean {
  return input.pickupCapable || input.hasTransportHint || input.hasPickupPrefill;
}
