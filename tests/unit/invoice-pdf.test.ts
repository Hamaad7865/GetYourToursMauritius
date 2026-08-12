import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildInvoice, type InvoiceBusiness } from '@/lib/invoice/model';
import { renderInvoicePdf, wrapText } from '@/lib/invoice/pdf';
import { StandardFonts } from 'pdf-lib';

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
  email: 'info@bellemaretours.com', // the MONITORED inbox — never the send-only bookings@ sender
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

  it('wraps long line descriptions and spills onto a second page rather than off the first', async () => {
    // A converted quote: several dated tours + long transfer lines (excursion + pickup address), each
    // shown in FULL and carrying its own date. Eight such rows outgrow one A4 sheet, so the totals and
    // the PAID box must move to page 2 rather than render below the bottom margin.
    const longFrom = '· from MU, Coastal Road, Quatre Cocos 41601, Mauritius';
    const model = buildInvoice(
      {
        ref: 'BMT-WRAP',
        customerName: 'Christophe',
        customerEmail: 'c@x.com',
        currency: 'EUR',
        totalEur: 616,
        balanceDueMinor: 30800,
        activityTitle: 'Catamaran Cruise',
        when: '2026-09-06T08:00:00Z',
        pickupLocation: null,
        dropoffLocation: null,
        childSeats: 0,
        transportEur: 0,
        locale: 'fr',
        items: [
          {
            title: 'Full day dolphin swimming Ile aux Bénitiers with lunch',
            priceLabel: 'Adult',
            quantity: 2,
            pax: null,
            subtotalEur: 120,
            when: '2026-09-04T08:00:00Z',
          },
          {
            title: 'Catamaran Cruise – Ile Aux Cerfs',
            priceLabel: 'Adult',
            quantity: 2,
            pax: null,
            subtotalEur: 110,
            when: '2026-09-06T08:00:00Z',
          },
          {
            title: 'Catamaran Cruise 3 Northern Island Adventure',
            priceLabel: 'Adult',
            quantity: 2,
            pax: null,
            subtotalEur: 110,
            when: '2026-09-08T08:00:00Z',
          },
          {
            title: null,
            priceLabel: 'Private South Tour Mauritius - 02/09/2026',
            quantity: 1,
            pax: null,
            subtotalEur: 90,
            when: '2026-09-02T08:00:00Z',
          },
          {
            title: null,
            priceLabel: `Round-trip transfer · Private Full day dolphin swimming Ile aux Bénitiers with lunch ${longFrom}`,
            quantity: 1,
            pax: null,
            subtotalEur: 60,
            when: '2026-09-04T08:00:00Z',
          },
          {
            title: null,
            priceLabel: `Round-trip transfer · Catamaran Cruise – Ile Aux Cerfs ${longFrom}`,
            quantity: 1,
            pax: null,
            subtotalEur: 30,
            when: '2026-09-06T08:00:00Z',
          },
          {
            title: null,
            priceLabel: `Round-trip transfer · Catamaran Cruise 3 Northern Island Adventure ${longFrom}`,
            quantity: 1,
            pax: null,
            subtotalEur: 60,
            when: '2026-09-08T08:00:00Z',
          },
          {
            title: null,
            priceLabel: 'Nissan March · 09 Sept 2026 – 10 Sept 2026 · 1-day rental',
            quantity: 1,
            pax: null,
            subtotalEur: 36,
            when: '2026-09-09T08:00:00Z',
          },
        ],
      },
      {
        chargedAmountMinor: 1674500,
        chargedCurrency: 'MUR',
        paidAt: '2026-08-11T19:42:36Z',
        providerRef: 'x',
      },
      business,
    );

    const bytes = await renderInvoicePdf(model);
    expect(magic(bytes)).toBe('%PDF');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2); // itinerary on page 1, totals + PAID box on page 2
  });

  it('wrapText breaks on words, keeps every word, and hard-splits a word wider than the column', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('Round-trip transfer to the north coast resort', font, 10, 80);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Round-trip transfer to the north coast resort'); // nothing dropped
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(80);
    // A single token longer than the column is split, never left to overflow.
    const oneLong = wrapText('Quatre-Cocos-Coastal-Road-41601-Mauritius', font, 10, 40);
    for (const l of oneLong) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(40);
  });
});
