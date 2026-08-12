import {
  buildDocument,
  type DocumentModel,
  type DocumentType,
  type VatMode,
} from '@/lib/documents/model';
import { parseAmountToMinor, type Currency } from '@/lib/documents/money';
import { DOCUMENT_ISSUER } from '@/lib/documents/issuer';
import type { DocumentSaveInput, DocumentStatus } from '@/lib/admin/documents';
import type { DocumentClient } from '@/lib/documents/model';

/**
 * The Documents editor's form state and its pure transforms. Every money field is held as the TEXT the
 * operator typed and parsed to minor units exactly once (in `documentInputFromForm` /
 * `documentModelFromForm`), so a float euro/rupee never round-trips through the editor — the same
 * discipline `quotes/state.ts` keeps. No I/O here; the two builders are pure and unit-tested.
 */

export type DocumentPaneId = 'client' | 'lines' | 'details' | 'preview';

export const DOCUMENT_PANES: Array<{ id: DocumentPaneId; label: string }> = [
  { id: 'client', label: 'Client' },
  { id: 'lines', label: 'Lines' },
  { id: 'details', label: 'Details' },
  { id: 'preview', label: 'Preview & issue' },
];

export const TYPE_LABEL: Record<DocumentType, string> = {
  quote: 'Quotation',
  invoice: 'Invoice',
  proforma: 'Proforma',
  receipt: 'Receipt',
};

export const VAT_MODE_LABEL: Record<VatMode, string> = {
  inclusive: 'Prices include VAT',
  exclusive: 'Add VAT on top',
  none: 'No VAT',
};

export const CURRENCY_OPTIONS: Currency[] = ['MUR', 'EUR', 'USD'];

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  paid: 'Paid',
  part_paid: 'Part paid',
  void: 'Void',
  converted: 'Converted',
};

export function statusClass(status: DocumentStatus): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-50 text-emerald-700';
    case 'issued':
      return 'bg-teal/10 text-teal-dark';
    case 'part_paid':
      return 'bg-amber-50 text-amber-700';
    case 'void':
    case 'declined':
    case 'expired':
      return 'bg-slate-100 text-slate-500';
    case 'converted':
      return 'bg-gold-light/30 text-ink';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export interface ClientForm {
  name: string;
  email: string;
  phone: string;
  street: string;
  locality: string;
  region: string;
  country: string;
  brn: string;
  vat: string;
}

export interface DocumentLineDraft {
  description: string;
  quantityText: string;
  unitText: string;
}

export interface DocumentFormValues {
  id: string | null;
  type: DocumentType;
  status: DocumentStatus;
  number: string | null;
  currency: Currency;
  clientId: string | null;
  client: ClientForm;
  lines: DocumentLineDraft[];
  vatMode: VatMode;
  vatRatePctText: string;
  issueDate: string;
  dueDate: string;
  validUntil: string;
  notes: string;
  internalNotes: string;
  amountPaidText: string;
  paymentMethod: string;
  paymentRef: string;
  paidAt: string;
  sourceDocumentId: string | null;
}

const EMPTY_CLIENT: ClientForm = {
  name: '',
  email: '',
  phone: '',
  street: '',
  locality: '',
  region: '',
  country: '',
  brn: '',
  vat: '',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function emptyDocumentForm(type: DocumentType): DocumentFormValues {
  return {
    id: null,
    type,
    status: 'draft',
    number: null,
    currency: 'MUR',
    clientId: null,
    client: { ...EMPTY_CLIENT },
    lines: [{ description: '', quantityText: '1', unitText: '' }],
    vatMode: 'inclusive',
    vatRatePctText: '15',
    issueDate: todayIso(),
    // An invoice/proforma is due in a fortnight by default; a quote is valid for a fortnight.
    dueDate: type === 'invoice' || type === 'proforma' ? plusDaysIso(14) : '',
    validUntil: type === 'quote' ? plusDaysIso(14) : '',
    notes: '',
    internalNotes: '',
    // A receipt records money already taken — default it paid today.
    amountPaidText: '',
    paymentMethod: '',
    paymentRef: '',
    paidAt: type === 'receipt' ? todayIso() : '',
    sourceDocumentId: null,
  };
}

/** Reconstruct the form from a stored record (minor units → the text fields the editor holds). */
export function formFromDocument(record: {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  number: string | null;
  currency: Currency;
  clientId: string | null;
  client: DocumentClient;
  lines: Array<{ description: string; quantity: number; unitMinor: number }>;
  vatMode: VatMode;
  vatRatePct: number;
  amountPaidMinor: number;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  issueDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  notes: string | null;
  internalNotes: string | null;
  sourceDocumentId: string | null;
}): DocumentFormValues {
  const c = record.client;
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    number: record.number,
    currency: record.currency,
    clientId: record.clientId,
    client: {
      name: c.name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      street: c.street ?? '',
      locality: c.locality ?? '',
      region: c.region ?? '',
      country: c.country ?? '',
      brn: c.brn ?? '',
      vat: c.vat ?? '',
    },
    lines: record.lines.length
      ? record.lines.map((l) => ({
          description: l.description,
          quantityText: String(l.quantity),
          unitText: (l.unitMinor / 100).toFixed(2),
        }))
      : [{ description: '', quantityText: '1', unitText: '' }],
    vatMode: record.vatMode,
    vatRatePctText: String(record.vatRatePct),
    issueDate: record.issueDate ?? todayIso(),
    dueDate: record.dueDate ?? '',
    validUntil: record.validUntil ?? '',
    notes: record.notes ?? '',
    internalNotes: record.internalNotes ?? '',
    amountPaidText: record.amountPaidMinor ? (record.amountPaidMinor / 100).toFixed(2) : '',
    paymentMethod: record.paymentMethod ?? '',
    paymentRef: record.paymentRef ?? '',
    paidAt: record.paidAt ? record.paidAt.slice(0, 10) : '',
    sourceDocumentId: record.sourceDocumentId,
  };
}

function clientFromForm(form: ClientForm): DocumentClient {
  const s = (v: string): string | null => (v.trim() ? v.trim() : null);
  return {
    name: form.name.trim(),
    email: s(form.email),
    phone: s(form.phone),
    street: s(form.street),
    locality: s(form.locality),
    region: s(form.region),
    country: s(form.country),
    brn: s(form.brn),
    vat: s(form.vat),
  };
}

/** Parse the drafted lines to minor units, dropping wholly-empty rows. Throws on a priced line with no
 *  description, so an amount can never be billed under a blank label. */
function parseLines(
  form: DocumentFormValues,
): Array<{ description: string; quantity: number; unitMinor: number }> {
  const kept = form.lines.filter((l) => l.description.trim() !== '' || l.unitText.trim() !== '');
  return kept.map((l, index) => {
    if (!l.description.trim()) {
      throw new Error(`Line ${index + 1} needs a description.`);
    }
    const quantity = Math.max(1, Math.round(Number(l.quantityText) || 1));
    const unitMinor = l.unitText.trim() ? parseAmountToMinor(l.unitText) : 0;
    return { description: l.description.trim(), quantity, unitMinor };
  });
}

function vatRateOf(form: DocumentFormValues): number {
  const n = Math.round(Number(form.vatRatePctText));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 15;
}

/** Build the {@link DocumentSaveInput} the service persists. Throws (ValidationError-ish) on bad input. */
export function documentInputFromForm(form: DocumentFormValues): DocumentSaveInput {
  const takesPayment = form.type === 'receipt' || form.amountPaidText.trim() !== '';
  return {
    id: form.id ?? undefined,
    type: form.type,
    currency: form.currency,
    clientId: form.clientId,
    client: clientFromForm(form.client),
    lines: parseLines(form),
    vatMode: form.vatMode,
    vatRatePct: vatRateOf(form),
    issueDate: form.issueDate || null,
    dueDate: form.dueDate || null,
    validUntil: form.validUntil || null,
    notes: form.notes.trim() || null,
    internalNotes: form.internalNotes.trim() || null,
    amountPaidMinor:
      takesPayment && form.amountPaidText.trim() ? parseAmountToMinor(form.amountPaidText) : 0,
    paymentMethod: takesPayment ? form.paymentMethod.trim() || null : null,
    paymentRef: takesPayment ? form.paymentRef.trim() || null : null,
    paidAt: takesPayment ? form.paidAt || null : null,
  };
}

/** Build the live model for the preview + the header total. Throws on unparseable input (the caller
 *  catches and shows a "check the amounts" hint rather than a broken preview). */
export function documentModelFromForm(form: DocumentFormValues): DocumentModel {
  const takesPayment = form.type === 'receipt' || form.amountPaidText.trim() !== '';
  return buildDocument({
    type: form.type,
    number: form.number,
    currency: form.currency,
    issuer: DOCUMENT_ISSUER,
    client: clientFromForm(form.client),
    lines: parseLines(form),
    vatMode: form.vatMode,
    vatRatePct: vatRateOf(form),
    issueDate: form.issueDate || '',
    dueDate: form.dueDate || null,
    validUntil: form.validUntil || null,
    notes: form.notes.trim() || null,
    amountPaidMinor:
      takesPayment && form.amountPaidText.trim() ? parseAmountToMinor(form.amountPaidText) : 0,
    paymentMethod: takesPayment ? form.paymentMethod.trim() || null : null,
    paymentRef: takesPayment ? form.paymentRef.trim() || null : null,
    paidAt: takesPayment ? form.paidAt || null : null,
  });
}

/** The document total in minor units, or null while a line is still un-parseable (so nothing shows a
 *  bogus figure mid-type). */
export function formTotalMinor(form: DocumentFormValues): number | null {
  try {
    return documentModelFromForm(form).totalMinor;
  } catch {
    return null;
  }
}

/**
 * PostgREST hands a refusal back as a plain object, not an Error, so the usual
 * `err instanceof Error ? err.message : ...` idiom would turn a real database message into "Action
 * failed". Mirrors `refusalMessage` in quotes/state.ts.
 */
export function refusalMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const message = record.message ?? record.error_description ?? record.error ?? record.details;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
