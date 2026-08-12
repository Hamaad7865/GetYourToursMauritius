import { describe, it, expect } from 'vitest';
import { buildDocument, type DocumentInput } from '@/lib/documents/model';

const ISSUER = { legalName: 'Belle Mare Tours Ltd', brn: 'C09091906', vat: '20529965' };
const CLIENT = { name: 'GLOBALAND (PTY) LTD' };

function base(overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    type: 'invoice',
    number: null,
    currency: 'MUR',
    issuer: ISSUER,
    client: CLIENT,
    lines: [{ description: 'Private full day Catamaran cruise', quantity: 1, unitMinor: 5800000 }],
    vatMode: 'inclusive',
    vatRatePct: 15,
    issueDate: '2026-08-12',
    ...overrides,
  };
}

describe('buildDocument — VAT modes', () => {
  it('backs VAT out of an inclusive total (the GLOBALAND figures ×100)', () => {
    const m = buildDocument(base());
    expect(m.totalMinor).toBe(5800000);
    expect(m.subtotalNetMinor).toBe(5043478);
    expect(m.vatMinor).toBe(756522);
    expect(m.subtotalNetMinor + m.vatMinor).toBe(m.totalMinor);
    expect(m.showVat).toBe(true);
    expect(m.title).toBe('TAX INVOICE');
    expect(m.symbol).toBe('Rs');
  });

  it('adds VAT on top under exclusive mode', () => {
    const m = buildDocument(
      base({
        lines: [{ description: 'Consulting', quantity: 1, unitMinor: 10000 }],
        vatMode: 'exclusive',
      }),
    );
    expect(m.subtotalNetMinor).toBe(10000);
    expect(m.vatMinor).toBe(1500);
    expect(m.totalMinor).toBe(11500);
    expect(m.showVat).toBe(true);
  });

  it('shows no VAT under none mode', () => {
    const m = buildDocument(base({ vatMode: 'none' }));
    expect(m.vatMinor).toBe(0);
    expect(m.showVat).toBe(false);
    expect(m.subtotalNetMinor).toBe(m.totalMinor);
  });
});

describe('buildDocument — totals reconcile', () => {
  it('sums multiple lines and reconciles net + VAT to the total (inclusive)', () => {
    const m = buildDocument(
      base({
        lines: [
          { description: 'Cruise', quantity: 2, unitMinor: 2000000 },
          { description: 'Transfer', quantity: 1, unitMinor: 600000 },
        ],
      }),
    );
    // Σ lineMinor
    expect(m.totalMinor).toBe(2 * 2000000 + 600000);
    expect(m.lines[0]!.lineMinor).toBe(4000000);
    expect(m.subtotalNetMinor + m.vatMinor).toBe(m.totalMinor);
  });
});

describe('buildDocument — paid/due by type', () => {
  it('marks a receipt paid in full with nothing due', () => {
    const m = buildDocument(base({ type: 'receipt' }));
    expect(m.isPaid).toBe(true);
    expect(m.amountDueMinor).toBe(0);
    expect(m.amountPaidMinor).toBe(m.totalMinor);
    expect(m.title).toBe('RECEIPT');
  });

  it('leaves an unpaid invoice fully due', () => {
    const m = buildDocument(base());
    expect(m.isPaid).toBe(false);
    expect(m.amountDueMinor).toBe(m.totalMinor);
    expect(m.amountPaidMinor).toBe(0);
  });

  it('treats an invoice paid in full as paid', () => {
    const m = buildDocument(base({ amountPaidMinor: 5800000 }));
    expect(m.isPaid).toBe(true);
    expect(m.amountDueMinor).toBe(0);
  });

  it('leaves a part-paid invoice with the remainder due', () => {
    const m = buildDocument(base({ amountPaidMinor: 3000000 }));
    expect(m.isPaid).toBe(false);
    expect(m.amountDueMinor).toBe(2800000);
  });

  it('titles quote and proforma documents', () => {
    expect(buildDocument(base({ type: 'quote' })).title).toBe('QUOTATION');
    expect(buildDocument(base({ type: 'proforma' })).title).toBe('PROFORMA INVOICE');
  });
});
