import { describe, it, expect } from 'vitest';
import { buildDocument, type DocumentInput, type DocumentType } from '@/lib/documents/model';
import { renderDocumentPdf } from '@/lib/documents/pdf';

function input(type: DocumentType, overrides: Partial<DocumentInput> = {}): DocumentInput {
  return {
    type,
    number: type === 'invoice' ? 'INV-2026-0007' : null,
    currency: 'MUR',
    issuer: {
      legalName: 'Belle Mare Tours Ltd',
      brn: 'C09091906',
      vat: '20529965',
      street: 'Royal Road, Belle Mare',
      region: 'Flacq',
      country: 'Mauritius',
      email: 'info@bellemaretours.com',
      phone: '+230 5772 9919',
    },
    client: {
      name: 'GLOBALAND (PTY) LTD',
      street: 'Coastal Road, Quatre Cocos',
      country: 'Mauritius',
    },
    lines: [
      {
        description: 'Private full day Catamaran cruise - 3 Northern Islands',
        quantity: 1,
        unitMinor: 5800000,
      },
    ],
    vatMode: 'inclusive',
    vatRatePct: 15,
    issueDate: '2026-08-12',
    validUntil: '2026-08-31',
    dueDate: '2026-08-26',
    ...overrides,
  };
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

describe('renderDocumentPdf', () => {
  for (const type of ['quote', 'invoice', 'proforma', 'receipt'] as DocumentType[]) {
    it(`renders a ${type} to a non-empty PDF`, async () => {
      const bytes = await renderDocumentPdf(buildDocument(input(type)));
      expect(bytes.length).toBeGreaterThan(500);
      expect(Array.from(bytes.slice(0, 4))).toEqual(PDF_MAGIC);
    });
  }

  it('handles every currency and a VAT-free document without throwing', async () => {
    for (const currency of ['MUR', 'EUR', 'USD'] as const) {
      const bytes = await renderDocumentPdf(
        buildDocument(input('invoice', { currency, vatMode: 'none' })),
      );
      expect(Array.from(bytes.slice(0, 4))).toEqual(PDF_MAGIC);
    }
  });

  it('does not throw on an accented client name or a long wrapped note', async () => {
    const bytes = await renderDocumentPdf(
      buildDocument(
        input('invoice', {
          client: { name: 'Société Générale de Croisière — Réunion' },
          notes:
            'Merci pour votre confiance. This covering note is deliberately long so it wraps across ' +
            'several lines and exercises the word-wrap path in the renderer without overflowing the page.',
        }),
      ),
    );
    expect(Array.from(bytes.slice(0, 4))).toEqual(PDF_MAGIC);
  });

  it('renders a part-paid invoice (amount paid + amount due)', async () => {
    const bytes = await renderDocumentPdf(
      buildDocument(input('invoice', { amountPaidMinor: 2000000, paymentMethod: 'bank transfer' })),
    );
    expect(Array.from(bytes.slice(0, 4))).toEqual(PDF_MAGIC);
  });
});
