import { describe, it, expect } from 'vitest';
import {
  documentInputFromForm,
  documentModelFromForm,
  emptyDocumentForm,
  formFromDocument,
  formTotalMinor,
  type DocumentFormValues,
} from '@/components/admin/documents/state';

function filledInvoice(overrides: Partial<DocumentFormValues> = {}): DocumentFormValues {
  return {
    ...emptyDocumentForm('invoice'),
    client: { ...emptyDocumentForm('invoice').client, name: 'GLOBALAND (PTY) LTD' },
    lines: [
      { description: 'Private full day Catamaran cruise', quantityText: '1', unitText: '58000' },
      { description: '', quantityText: '1', unitText: '' }, // trailing empty — should be dropped
    ],
    ...overrides,
  };
}

describe('documentInputFromForm', () => {
  it('parses amounts to minor units and drops empty trailing lines', () => {
    const input = documentInputFromForm(filledInvoice());
    expect(input.lines).toHaveLength(1);
    expect(input.lines[0]).toMatchObject({ quantity: 1, unitMinor: 5800000 });
    expect(input.client.name).toBe('GLOBALAND (PTY) LTD');
    expect(input.currency).toBe('MUR');
  });

  it('leaves an unpaid invoice with no recorded payment', () => {
    const input = documentInputFromForm(filledInvoice());
    expect(input.amountPaidMinor).toBe(0);
    expect(input.paymentMethod).toBeNull();
  });

  it('records payment on a receipt', () => {
    const form = {
      ...filledInvoice(),
      type: 'receipt' as const,
      amountPaidText: '58000',
      paymentMethod: 'bank transfer',
      paidAt: '2026-08-12',
    };
    const input = documentInputFromForm(form);
    expect(input.amountPaidMinor).toBe(5800000);
    expect(input.paymentMethod).toBe('bank transfer');
  });

  it('throws on a priced line with no description', () => {
    const form = filledInvoice({
      lines: [{ description: '', quantityText: '1', unitText: '5000' }],
    });
    expect(() => documentInputFromForm(form)).toThrow(/description/i);
  });
});

describe('formTotalMinor + VAT modes', () => {
  it('totals a VAT-inclusive invoice (the GLOBALAND figure)', () => {
    const model = documentModelFromForm(filledInvoice());
    expect(model.totalMinor).toBe(5800000);
    expect(model.subtotalNetMinor).toBe(5043478);
    expect(model.vatMinor).toBe(756522);
  });

  it('reflects the VAT mode in the total', () => {
    expect(formTotalMinor(filledInvoice({ vatMode: 'inclusive' }))).toBe(5800000);
    // exclusive adds 15% on top
    expect(formTotalMinor(filledInvoice({ vatMode: 'exclusive' }))).toBe(5800000 + 870000);
    // none leaves it flat
    expect(formTotalMinor(filledInvoice({ vatMode: 'none' }))).toBe(5800000);
  });

  it('returns null while a line amount is un-parseable', () => {
    expect(
      formTotalMinor(
        filledInvoice({ lines: [{ description: 'x', quantityText: '1', unitText: 'abc' }] }),
      ),
    ).toBeNull();
  });
});

type ElementLike = { type: unknown; props: Record<string, unknown> };
function isElement(node: unknown): node is ElementLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}
/** Every element of `target` in an un-rendered React element tree. Invokes no component. */
function findAll(node: unknown, target: unknown, out: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, target, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === target) out.push(node);
  findAll(node.props?.children, target, out);
  return out;
}

describe('the documents screen is reachable', () => {
  it('renders AdminDocuments at /admin/documents — the page and its whole import graph load', async () => {
    // Importing the page pulls in AdminDocuments and, transitively, every pane, the data layer, the
    // model, the renderer and the issuer — so a broken import anywhere fails here, not only in the browser.
    const { default: DocumentsPage } = await import('../../app/(site)/admin/documents/page');
    const { AdminDocuments } = await import('@/components/admin/AdminDocuments');
    expect(findAll(DocumentsPage(), AdminDocuments)).toHaveLength(1);
  }, 60_000);
});

describe('formFromDocument round-trip', () => {
  it('reconstructs the form and re-derives the same input', () => {
    const original = documentInputFromForm(filledInvoice());
    const record = {
      id: 'doc-1',
      type: 'invoice' as const,
      status: 'draft' as const,
      number: null,
      currency: original.currency,
      clientId: null,
      client: original.client,
      lines: original.lines,
      vatMode: original.vatMode,
      vatRatePct: original.vatRatePct,
      amountPaidMinor: original.amountPaidMinor,
      paymentMethod: original.paymentMethod,
      paymentRef: original.paymentRef,
      paidAt: original.paidAt,
      issueDate: original.issueDate,
      dueDate: original.dueDate,
      validUntil: original.validUntil,
      notes: original.notes,
      internalNotes: original.internalNotes,
      sourceDocumentId: null,
    };
    const roundTripped = documentInputFromForm(formFromDocument(record));
    expect(roundTripped.lines).toEqual(original.lines);
    expect(roundTripped.client.name).toBe(original.client.name);
    expect(roundTripped.vatMode).toBe(original.vatMode);
  });
});
