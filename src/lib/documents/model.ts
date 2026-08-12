import { CURRENCY_SYMBOL, type Currency } from '@/lib/documents/money';

/**
 * The pure Documents model — the single source of truth every renderer consumes (the PDF in `pdf.ts`
 * and the React `DocumentPreview`), so the numbers can never drift between what the operator sees on
 * screen and what the client receives as a PDF.
 *
 * Pure: no I/O, no `Date.now()`/`new Date()`. The caller supplies `issueDate`, exactly as `buildInvoice`
 * takes its timestamp, so tests stay deterministic and the bytes are reproducible.
 *
 * Money is in integer MINOR units throughout (all three currencies are ISO exponent-2). VAT is handled
 * per the document's `vatMode`:
 *   - inclusive: the typed line prices ALREADY include VAT; net is backed out per line and summed, and
 *     VAT is the residual, so the lines always reconcile to the total.
 *   - exclusive: the typed line prices are net; VAT is added on top.
 *   - none: no VAT line is shown (zero-rated / foreign clients).
 */

export type DocumentType = 'quote' | 'invoice' | 'proforma' | 'receipt';
export type VatMode = 'inclusive' | 'exclusive' | 'none';

/** The issuer (our business), frozen onto a document at issue time so a reprint is stable. */
export interface DocumentIssuer {
  legalName: string;
  brn?: string | null;
  vat?: string | null;
  street?: string | null;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** The bill-to party, frozen onto a document at issue time (a snapshot of the saved client). */
export interface DocumentClient {
  name: string;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  locality?: string | null;
  region?: string | null;
  country?: string | null;
  brn?: string | null;
  vat?: string | null;
}

export interface DocumentLineInput {
  description: string;
  quantity: number;
  /** Unit price in MINOR units. Under `inclusive` mode this is VAT-inclusive; under the others, net. */
  unitMinor: number;
}

export interface DocumentInput {
  type: DocumentType;
  /** Null until the document is issued (drafts are unnumbered). */
  number: string | null;
  currency: Currency;
  issuer: DocumentIssuer;
  client: DocumentClient;
  lines: DocumentLineInput[];
  vatMode: VatMode;
  vatRatePct: number;
  /** ISO date supplied by the caller (no wall clock in here). */
  issueDate: string;
  dueDate?: string | null;
  validUntil?: string | null;
  notes?: string | null;
  /** Manual settlement (NOT the Peach ledger): how much has been paid on an invoice/proforma. */
  amountPaidMinor?: number | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  paidAt?: string | null;
}

export interface DocumentModelLine {
  description: string;
  quantity: number;
  unitMinor: number;
  lineMinor: number;
}

export interface DocumentModel {
  type: DocumentType;
  title: string;
  number: string | null;
  currency: Currency;
  symbol: string;
  issuer: DocumentIssuer;
  client: DocumentClient;
  lines: DocumentModelLine[];
  subtotalNetMinor: number;
  vatRatePct: number;
  vatMinor: number;
  totalMinor: number;
  /** False under `none` mode — the renderers omit the VAT line entirely. */
  showVat: boolean;
  amountPaidMinor: number;
  amountDueMinor: number;
  /** A receipt, or an invoice/proforma settled in full — the renderers show a PAID stamp. */
  isPaid: boolean;
  issueDate: string;
  dueDate: string | null;
  validUntil: string | null;
  notes: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
}

const TITLE: Record<DocumentType, string> = {
  quote: 'QUOTATION',
  invoice: 'TAX INVOICE',
  proforma: 'PROFORMA INVOICE',
  receipt: 'RECEIPT',
};

/**
 * Build the document model from its inputs. See the file header for the VAT rules. Every amount in the
 * result is an integer count of minor units; the lines reconcile to `totalMinor` by construction.
 */
export function buildDocument(input: DocumentInput): DocumentModel {
  const rate = input.vatRatePct / 100;

  const lines: DocumentModelLine[] = input.lines.map((line) => {
    const quantity = Number.isFinite(line.quantity) ? line.quantity : 1;
    return {
      description: line.description,
      quantity,
      unitMinor: line.unitMinor,
      lineMinor: Math.round(quantity * line.unitMinor),
    };
  });

  const grossSum = lines.reduce((sum, line) => sum + line.lineMinor, 0);

  let subtotalNetMinor: number;
  let vatMinor: number;
  let totalMinor: number;
  let showVat: boolean;

  if (input.vatMode === 'inclusive') {
    // Back the tax out per line (each rounded to a cent), sum the nets; VAT is the residual so the
    // displayed subtotal never drifts from the line figures and the document always reconciles.
    subtotalNetMinor = lines.reduce(
      (sum, line) => sum + Math.round(line.lineMinor / (1 + rate)),
      0,
    );
    totalMinor = grossSum;
    vatMinor = totalMinor - subtotalNetMinor;
    showVat = true;
  } else if (input.vatMode === 'exclusive') {
    subtotalNetMinor = grossSum;
    vatMinor = Math.round(grossSum * rate);
    totalMinor = subtotalNetMinor + vatMinor;
    showVat = true;
  } else {
    subtotalNetMinor = grossSum;
    vatMinor = 0;
    totalMinor = grossSum;
    showVat = false;
  }

  // A receipt is proof of payment: it settles in full by definition, so an unspecified amount paid
  // defaults to the whole total. An invoice/proforma carries whatever was manually recorded.
  const rawPaid = Math.max(0, input.amountPaidMinor ?? 0);
  const amountPaidMinor = input.type === 'receipt' && rawPaid === 0 ? totalMinor : rawPaid;
  const isPaid = input.type === 'receipt' || (totalMinor > 0 && amountPaidMinor >= totalMinor);
  const amountDueMinor = Math.max(0, totalMinor - amountPaidMinor);

  return {
    type: input.type,
    title: TITLE[input.type],
    number: input.number,
    currency: input.currency,
    symbol: CURRENCY_SYMBOL[input.currency],
    issuer: input.issuer,
    client: input.client,
    lines,
    subtotalNetMinor,
    vatRatePct: input.vatRatePct,
    vatMinor,
    totalMinor,
    showVat,
    amountPaidMinor,
    amountDueMinor,
    isPaid,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    validUntil: input.validUntil ?? null,
    notes: input.notes ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentRef: input.paymentRef ?? null,
    paidAt: input.paidAt ?? null,
  };
}
