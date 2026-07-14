import { describe, expect, it } from 'vitest';
import { buildInvoice, type InvoiceBusiness } from '@/lib/invoice/model';
import { renderInvoicePdf } from '@/lib/invoice/pdf';

/**
 * `renderInvoicePdf` turns the pure invoice model (Task 2) into an edge-safe combined
 * Tax Invoice / Receipt PDF via pdf-lib (no headless browser, no Node fs). These are SMOKE
 * tests: we assert the bytes are a real PDF and that the renderer never throws — not pixel
 * layout. We reuse `buildInvoice` so the fixture matches the real model shape exactly.
 */
/** The first four bytes of a PDF spell `%PDF`. Read them defensively (typed-array access is
 * `number | undefined` under noUncheckedIndexedAccess). */
function magic(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
}

const business: InvoiceBusiness = {
  legalName: 'Belle Mare Tours Ltd',
  brn: 'C09091906',
  vat: '20529965',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  email: 'bookings@bellemaretours.com',
  phone: '+230 5772 9919',
};

describe('renderInvoicePdf', () => {
  it('renders a multi-line invoice (items + transport + child seats, USD charge, pickup + dropoff) to a real PDF', async () => {
    const model = buildInvoice(
      {
        ref: 'BMT-1001',
        customerName: 'Jean-Philippe de la Fontaine',
        customerEmail: 'jp@example.com',
        currency: 'EUR',
        totalEur: 191,
        activityTitle: 'Catamaran Cruise to Île aux Cerfs with BBQ Lunch',
        when: '2026-08-09T06:00:00Z',
        pickupLocation: 'Le Touessrok Hotel, Trou d’Eau Douce',
        dropoffLocation: 'Belle Mare Plage Resort',
        childSeats: 2, // first free + 1 extra @ €6 -> a child-seat line
        transportEur: 30,
        items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 155 }],
      },
      {
        chargedAmountMinor: 20700,
        chargedCurrency: 'USD',
        paidAt: '2026-06-20T10:00:00Z',
        providerRef: 'pe_8f3a91c2',
      },
      business,
    );

    const bytes = await renderInvoicePdf(model);

    expect(bytes.length).toBeGreaterThan(800);
    expect(magic(bytes)).toBe('%PDF');
  });

  it('does not throw on the minimal edge case: no pickup/dropoff and a single line', async () => {
    const model = buildInvoice(
      {
        ref: 'BMT-2',
        customerName: 'A',
        customerEmail: 'a@x.com',
        currency: 'EUR',
        totalEur: 115,
        activityTitle: 'Boat Trip',
        when: '2026-09-01T08:00:00Z',
        pickupLocation: null,
        dropoffLocation: null,
        childSeats: 0,
        transportEur: 0,
        items: [{ priceLabel: 'Adult', quantity: 1, pax: null, subtotalEur: 115 }],
      },
      // omit paidAt + providerRef so the PAID stamp must degrade gracefully
      { chargedAmountMinor: 11500, chargedCurrency: 'EUR', issuedAt: '2026-09-01T00:00:00Z' },
      business,
    );

    const bytes = await renderInvoicePdf(model);
    expect(magic(bytes)).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(800);
  });
});
