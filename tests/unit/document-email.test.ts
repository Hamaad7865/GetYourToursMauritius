import { describe, it, expect } from 'vitest';
import { buildDocument, type DocumentInput, type DocumentType } from '@/lib/documents/model';
import { renderDocumentEmail } from '@/lib/email/document';

function model(type: DocumentType, overrides: Partial<DocumentInput> = {}) {
  return buildDocument({
    type,
    number: type === 'invoice' ? 'INV-2026-0007' : type === 'receipt' ? 'RCT-2026-0003' : null,
    currency: 'MUR',
    issuer: { legalName: 'Belle Mare Tours Ltd', email: 'info@bellemaretours.com' },
    client: { name: 'GLOBALAND (PTY) LTD', email: 'accounts@globaland.com' },
    lines: [{ description: 'Private catamaran cruise', quantity: 1, unitMinor: 5800000 }],
    vatMode: 'inclusive',
    vatRatePct: 15,
    issueDate: '2026-08-12',
    ...overrides,
  });
}

describe('renderDocumentEmail', () => {
  it('names the invoice and its amount due, addressed to the client', () => {
    const email = renderDocumentEmail(model('invoice'));
    expect(email.subject).toBe('Invoice INV-2026-0007 from Belle Mare Tours Ltd');
    expect(email.text).toContain('Dear GLOBALAND (PTY) LTD');
    expect(email.text).toContain('Amount due: Rs 58,000.00');
    expect(email.html).toContain('Belle Mare Tours Ltd');
  });

  it('describes a receipt as paid', () => {
    const email = renderDocumentEmail(model('receipt'));
    expect(email.subject).toContain('Receipt RCT-2026-0003');
    expect(email.text).toContain('Amount paid: Rs 58,000.00');
    expect(email.text.toLowerCase()).toContain('thank you');
  });

  it('titles a quotation without a number', () => {
    const email = renderDocumentEmail(model('quote'));
    expect(email.subject).toBe('Your quotation from Belle Mare Tours Ltd');
  });

  it('shows a fully-paid invoice as settled, not owed', () => {
    const email = renderDocumentEmail(model('invoice', { amountPaidMinor: 5800000 }));
    expect(email.text).toContain('paid in full');
    expect(email.text).not.toContain('Amount due');
  });

  it('escapes HTML in the client name', () => {
    const email = renderDocumentEmail(
      model('invoice', { client: { name: 'A & B <Ltd>', email: 'x@y.com' } }),
    );
    expect(email.html).toContain('A &amp; B &lt;Ltd&gt;');
    expect(email.html).not.toContain('<Ltd>');
  });
});
