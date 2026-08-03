import { itemTotal, type CartItem } from './useCart';
import { encodeParty } from '@/lib/services/party';

/**
 * The /checkout URL for a cart line.
 *
 * Everything that DEFINES the line has to survive the round-trip through the cart, because the
 * server re-derives the price from what it receives. That bit is subtle for transfers: api_book
 * decides a booking is an airport transfer from the ACTIVITY, not the payload, so it overrides the
 * total whether or not the transfer fields arrived — and with no `dropoffSlug` and no `tripType` it
 * falls back to zone 1 and a single leg. A return transfer to a far hotel, added to the cart and
 * checked out from there, was silently charged as a one-way short hop.
 *
 * Nothing here is trusted as a price: `total` is a display hint the checkout reconciles, and the
 * transfer fields are inputs to the server's own fare derivation.
 */
export function checkoutHref(i: CartItem): string {
  const q = new URLSearchParams({
    // Line-defining extras (the airport-transfer set: dropoffSlug, tripType, region, chosen legs).
    // Spread FIRST so the canonical cart-derived values below win any collision.
    ...(i.checkoutParams ?? {}),
    occ: i.occurrenceId,
    label: i.priceLabel,
    qty: String(i.guests),
    slug: i.slug,
    title: i.title,
    lang: i.lang,
    total: String(itemTotal(i)),
    when: i.dateLabel,
    guests: String(i.guests),
    unit: i.unit,
    // Carry the SUV upgrade so a cart line added as an SUV isn't silently downgraded to the Sedan
    // price at checkout. (holdId/idem are intentionally absent from the URL — the hold reserved in
    // proceed() is handed to checkout via sessionStorage so its tokens don't leak via Referer/history.)
    ...(i.suv ? { suv: '1' } : {}),
    ...(i.childSeats ? { childSeats: String(i.childSeats) } : {}),
    ...(i.supplementQty ? { supplementQty: String(i.supplementQty) } : {}),
    ...(i.supplementQty && i.supplementName ? { supplementName: i.supplementName } : {}),
    // Age-banded line: carry the per-band map so the server prices each band (Adult/Child/Infant).
    ...(i.party ? { party: encodeParty(i.party) } : {}),
    // Signal checkout this is a CART line: read this line's captured route AND reuse the hold proceed()
    // reserved for this occurrence (both staged to sessionStorage by occurrence). Always present — NOT
    // `from=widget` (a distinct stash + price hints) — so the cart hold is reused instead of re-minted.
    from: 'cart',
  });
  return `/checkout?${q.toString()}`;
}
