/**
 * Combine a Google Places result into a single "Hotel name, civic address" label — the pickup /
 * drop-off text a driver reads on the voucher.
 *
 * Google keeps an establishment's NAME (`name`, e.g. "Crystals Beach Resort Belle Mare") apart from
 * its civic address (`formatted_address`, e.g. "Coastal Rd, Quatre Cocos 41601, Mauritius"). The
 * checkout maps used to keep only the address, so the driver got a street with no hotel on it. This
 * joins the two, but avoids the two ways a naive `${name}, ${addr}` goes wrong:
 *   - a PLAIN address pick returns `name` equal to the first line of `formatted_address`, so joining
 *     would read "Coastal Rd, Coastal Rd, Quatre Cocos…" — the startsWith guard drops the repeat;
 *   - a foreign-script establishment name is DELETED outright by the voucher PDF encoder (WinAnsi in
 *     src/lib/invoice/pdf.ts), so a name that isn't voucher-safe is skipped and only the
 *     (always-Latin) address is kept — mirroring pickPickupName's contract.
 *
 * Pure + structurally typed (no Google types) so it's unit-testable without a browser.
 */
import { isVoucherSafe } from '@/lib/geo/pickup-name';

/** The slice of a google.maps.places.PlaceResult we build the label from. */
export interface LabeledPlace {
  name?: string | null;
  formatted_address?: string | null;
}

/** Matches the truncation Checkout applies to the pickup param (and pickPickupName's MAX_NAME). */
const MAX_LABEL = 160;

/**
 * @param place    the resolved Places result (name + formatted_address).
 * @param fallback what the visitor typed — used only when the place carries nothing printable.
 */
export function placeLabel(place: LabeledPlace, fallback = ''): string {
  const addr = (place.formatted_address ?? '').trim();
  const name = (place.name ?? '').trim();
  // A name is only worth showing if it's printable on the voucher.
  const nameSafe = name.length > 0 && isVoucherSafe(name);

  if (addr) {
    // Prepend the name only when it ADDS something — not when it's just how the address already begins.
    const nameAdds = nameSafe && !addr.toLowerCase().startsWith(name.toLowerCase());
    return (nameAdds ? `${name}, ${addr}` : addr).slice(0, MAX_LABEL);
  }
  // No civic address: a printable name beats the raw typed text, which beats nothing.
  return (nameSafe ? name : fallback.trim() || name).slice(0, MAX_LABEL);
}
