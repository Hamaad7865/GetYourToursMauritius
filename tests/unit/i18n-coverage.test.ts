import { describe, expect, it } from 'vitest';
import { fr } from '@/lib/i18n/messages';

/**
 * Guard against the P1 i18n regression where core booking/checkout/confirmation strings shipped
 * with no French entry, so French visitors saw English on the money path. Each string below is the
 * EXACT literal passed to t(...) in the named component — including the curly apostrophe (’, U+2019)
 * and the em-dash where present. An exact-match miss (e.g. "Drop-off same as pickup" vs the em-dash
 * "Drop-off — same as pickup") falls back to English at runtime, so this test keys off the same
 * literals the code uses. If you change a literal in a component, change it here too.
 */
const CORE_FLOW_STRINGS = {
  // src/components/gyg/detail/BookingOptionCard.tsx — transport / pickup block
  'BookingOptionCard': [
    'Hotel pickup & drop-off',
    'Add your hotel and we’ll add door-to-door transport based on the distance. Skip it to meet at the boarding point.',
    'Drop-off same as pickup',
    'Drop-off address',
    'I need an SUV / larger vehicle',
    'Pickup',
    'Transport (pickup from {region})',
    'Transport',
    'Enter pickup to see price',
    'All taxes and fees included',
    'Continue',
    'Add to cart',
  ],
  // src/components/checkout/Checkout.tsx
  'Checkout': [
    'Door-to-door transport',
    'Could not start payment.',
    'Do you want pickup?',
    'Drop-off — same as pickup', // em-dash variant — distinct key from the BookingOptionCard one
    'I don’t know yet',
    'Next: Personal details',
    'Go to payment',
    'Review & pay',
    'Continue to payment',
    'Order summary',
    'Total',
  ],
  // src/components/gyg/detail/BookingConfirmation.tsx
  'BookingConfirmation': [
    'Pickup to be arranged',
    'Pickup location',
    'Same as pickup',
    'Drop-off',
    'Reference',
    'Your transfer',
    'Direction',
    'Room or cabin',
    'Return flight',
    'Luggage',
    'Child seat age',
    'Special requests',
    'Arrival (airport to hotel)',
    'Departure (hotel to airport)',
    'Return (both directions)',
    'Download e-voucher (PDF)',
    'Your e-voucher with the meeting-point details and a QR is attached to your confirmation email.',
    // Customer self-service cancel → refund
    'Cancelled — refund on its way',
    'Your cancellation is confirmed and your refund is being processed. We’ll email you once it’s done.',
    'Your refund has been processed. Please allow a few days for it to appear on your statement.',
    'Cancel activity & claim refund',
    'Confirm cancellation',
    'Cancel this booking and claim a refund? Your refund is processed back to your card within a few business days.',
    'Yes, cancel & claim refund',
    'Cancelling…',
    'Keep my booking',
    'Free cancellation has passed.',
    'Message us to cancel',
    'Hi Belle Mare Tours! I need to cancel my booking {ref}.',
    'Could not cancel the booking. Please try again.',
  ],
} as const;

describe('i18n coverage — core booking/checkout/confirmation flow has French entries', () => {
  for (const [component, strings] of Object.entries(CORE_FLOW_STRINGS)) {
    describe(component, () => {
      for (const s of strings) {
        it(`has a French entry for: ${JSON.stringify(s)}`, () => {
          expect(fr[s], `Missing fr entry for ${JSON.stringify(s)}`).toBeTruthy();
        });
      }
    });
  }

  it('preserves the {region} placeholder in the transport-fee key', () => {
    expect(fr['Transport (pickup from {region})']).toContain('{region}');
  });
});
