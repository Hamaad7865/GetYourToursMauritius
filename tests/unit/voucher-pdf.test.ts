import { describe, it, expect } from 'vitest';
import {
  buildInvoice,
  type InvoiceBookingInput,
  type InvoicePaymentInput,
  type TransferDetails,
} from '@/lib/invoice/model';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { renderVoucherPdf } from '@/lib/invoice/voucher-pdf';

const payment: InvoicePaymentInput = {
  chargedAmountMinor: 3850,
  chargedCurrency: 'USD',
  paidAt: '2026-07-10T08:00:00Z',
  providerRef: 'pay_1',
};

function transferBooking(over: Partial<TransferDetails> = {}): InvoiceBookingInput {
  return {
    ref: 'GYT-TEST01',
    customerName: 'Test User',
    customerEmail: 't@example.com',
    currency: 'EUR',
    totalEur: 35,
    activityTitle: 'Airport transfer',
    when: '2026-07-14T09:40:00Z',
    pickupLocation: 'SSR International Airport (MRU)',
    dropoffLocation: 'Shandrani, Blue Bay',
    transfer: {
      direction: 'arrival',
      flightNumber: 'BA 2129',
      arrivalTime: '13:40',
      roomOrCabin: 'Room 214',
      luggageDetails: '2 cases',
      childSeatAge: 3,
      travellerCountry: 'United Kingdom',
      specialNotes: 'Honeymoon — flexible if late.',
      ...over,
    },
    items: [{ priceLabel: 'Standard car', quantity: 1, pax: 2, subtotalEur: 35 }],
  };
}

const pdfHeader = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 5));

describe('renderVoucherPdf', () => {
  it('renders a PDF for an arrival transfer', async () => {
    const model = buildInvoice(transferBooking(), payment, INVOICE_BUSINESS);
    const bytes = await renderVoucherPdf(model, 'https://example.com/bookings/GYT-TEST01');
    expect(pdfHeader(bytes)).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it('renders a return transfer with a departure flight and only minimal fields', async () => {
    const model = buildInvoice(
      transferBooking({
        direction: 'return',
        departureFlightNumber: 'BA 2130',
        returnDate: '2026-07-21',
        returnTime: '06:15',
        roomOrCabin: null,
        luggageDetails: null,
        childSeatAge: null,
        travellerCountry: null,
        specialNotes: null,
      }),
      payment,
      INVOICE_BUSINESS,
    );
    const bytes = await renderVoucherPdf(model, 'https://example.com/bookings/GYT-TEST01');
    expect(pdfHeader(bytes)).toBe('%PDF-');
  });

  it('is deterministic — identical input renders identical bytes even across a clock tick', async () => {
    const model = buildInvoice(transferBooking(), payment, INVOICE_BUSINESS);
    const a = await renderVoucherPdf(model, 'https://example.com/x');
    // Let real time cross a second boundary; a wall-clock metadata stamp would diverge the bytes here.
    await new Promise((r) => setTimeout(r, 1100));
    const b = await renderVoucherPdf(model, 'https://example.com/x');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
