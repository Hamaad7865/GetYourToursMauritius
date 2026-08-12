import { getBrowserSupabase } from '@/lib/supabase/browser';
import { ValidationError } from '@/lib/services/errors';
import {
  buildDocument,
  type DocumentClient,
  type DocumentLineInput,
  type DocumentType,
  type VatMode,
} from '@/lib/documents/model';
import type { Currency } from '@/lib/documents/money';
import { DOCUMENT_ISSUER } from '@/lib/documents/issuer';
import type { Json } from '@/lib/supabase/types';

/**
 * Staff-side Documents service: draft, save, issue, convert, void, and the saved-client list. The
 * authenticated admin talks to Supabase directly through the browser client and the `*_staff` RLS
 * policies (20260927000000) are the gate — no service-role key in the browser, exactly like
 * `src/lib/admin/quotes.ts`.
 *
 * Money is in MINOR units across the module (parsing a typed euro/rupee string to minor is the
 * editor's job, in `documents/state.ts`). The stored `subtotal_net_minor / vat_minor / total_minor`
 * are DERIVED here through `buildDocument`, so a browser-supplied total can never disagree with the
 * lines; the PDF renderer recomputes from the lines again on every download.
 *
 * Two transitions do NOT happen here because they must be atomic or gapless, and go through a
 * SECURITY DEFINER RPC instead: ISSUE (allocates the number + freezes the issuer) and CONVERT
 * (clones a quote into an invoice draft). VOID is an RPC too, for its draft-guard.
 */

export type DocumentStatus =
  | 'draft'
  | 'issued'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'paid'
  | 'part_paid'
  | 'void'
  | 'converted';

export interface DocumentClientRecord extends DocumentClient {
  id: string;
}

/** A row as the list + editor hold it (camelCase; money in minor units). */
export interface DocumentRecord {
  id: string;
  type: DocumentType;
  number: string | null;
  status: DocumentStatus;
  currency: Currency;
  clientId: string | null;
  client: DocumentClient;
  lines: DocumentLineInput[];
  vatMode: VatMode;
  vatRatePct: number;
  subtotalNetMinor: number;
  vatMinor: number;
  totalMinor: number;
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
  createdAt: string;
  updatedAt: string;
}

/** What the editor hands `saveDocument` — amounts already parsed to minor units. */
export interface DocumentSaveInput {
  /** Absent for a new draft; present to update an existing one. */
  id?: string;
  type: DocumentType;
  currency: Currency;
  clientId?: string | null;
  client: DocumentClient;
  lines: DocumentLineInput[];
  vatMode: VatMode;
  vatRatePct: number;
  issueDate: string | null;
  dueDate: string | null;
  validUntil: string | null;
  notes: string | null;
  internalNotes: string | null;
  amountPaidMinor: number;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
}

function db() {
  return getBrowserSupabase();
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function nstr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Map a stored row (snake_case, JSON columns) into the camelCase record the UI holds. */
function mapDocument(raw: Record<string, unknown>): DocumentRecord {
  const client = (raw.client_snapshot ?? {}) as DocumentClient;
  const lines = Array.isArray(raw.lines) ? (raw.lines as DocumentLineInput[]) : [];
  return {
    id: String(raw.id),
    type: raw.type as DocumentType,
    number: nstr(raw.number),
    status: raw.status as DocumentStatus,
    currency: raw.currency as Currency,
    clientId: nstr(raw.client_id),
    client: { ...client, name: client.name ?? '' },
    lines,
    vatMode: (raw.vat_mode as VatMode) ?? 'inclusive',
    vatRatePct: num(raw.vat_rate_pct) || 15,
    subtotalNetMinor: num(raw.subtotal_net_minor),
    vatMinor: num(raw.vat_minor),
    totalMinor: num(raw.total_minor),
    amountPaidMinor: num(raw.amount_paid_minor),
    paymentMethod: nstr(raw.payment_method),
    paymentRef: nstr(raw.payment_ref),
    paidAt: nstr(raw.paid_at),
    issueDate: nstr(raw.issue_date),
    dueDate: nstr(raw.due_date),
    validUntil: nstr(raw.valid_until),
    notes: nstr(raw.notes),
    internalNotes: nstr(raw.internal_notes),
    sourceDocumentId: nstr(raw.source_document_id),
    createdAt: String(raw.created_at ?? ''),
    updatedAt: String(raw.updated_at ?? ''),
  };
}

function mapClient(raw: Record<string, unknown>): DocumentClientRecord {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    email: nstr(raw.email),
    phone: nstr(raw.phone),
    street: nstr(raw.street),
    locality: nstr(raw.locality),
    region: nstr(raw.region),
    country: nstr(raw.country),
    brn: nstr(raw.brn),
    vat: nstr(raw.vat),
  };
}

export async function loadDocuments(): Promise<DocumentRecord[]> {
  const { data, error } = await db()
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapDocument(r as unknown as Record<string, unknown>));
}

export async function loadDocument(id: string): Promise<DocumentRecord | null> {
  const { data, error } = await db().from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapDocument(data as unknown as Record<string, unknown>) : null;
}

/**
 * Insert a new draft, or update an existing one. Totals are DERIVED via `buildDocument` (never taken
 * from the caller). A payment is stored only where it makes sense — a receipt, or an invoice/proforma
 * the operator marked (partly) paid — and cleared to zero on a quote. Returns the row id.
 */
export async function saveDocument(input: DocumentSaveInput): Promise<string> {
  if (!input.client.name?.trim()) {
    throw new ValidationError('The document needs a client name.');
  }
  // Derive the totals from the lines under the chosen VAT mode.
  const model = buildDocument({
    type: input.type,
    number: null,
    currency: input.currency,
    issuer: DOCUMENT_ISSUER,
    client: input.client,
    lines: input.lines,
    vatMode: input.vatMode,
    vatRatePct: input.vatRatePct,
    issueDate: input.issueDate ?? '',
    amountPaidMinor: input.amountPaidMinor,
  });

  const takesPayment = input.type === 'receipt' || input.amountPaidMinor > 0;
  const payload = {
    type: input.type,
    currency: input.currency,
    client_id: input.clientId ?? null,
    client_snapshot: input.client as unknown as Json,
    lines: input.lines as unknown as Json,
    vat_mode: input.vatMode,
    vat_rate_pct: input.vatRatePct,
    subtotal_net_minor: model.subtotalNetMinor,
    vat_minor: model.vatMinor,
    total_minor: model.totalMinor,
    amount_paid_minor: takesPayment ? input.amountPaidMinor : 0,
    payment_method: takesPayment ? (input.paymentMethod ?? null) : null,
    payment_ref: takesPayment ? (input.paymentRef ?? null) : null,
    paid_at: takesPayment ? (input.paidAt ?? null) : null,
    issue_date: input.issueDate ?? null,
    due_date: input.dueDate ?? null,
    valid_until: input.validUntil ?? null,
    notes: input.notes ?? null,
    internal_notes: input.internalNotes ?? null,
  };

  if (input.id) {
    const { data, error } = await db()
      .from('documents')
      .update(payload)
      .eq('id', input.id)
      .select('id')
      .single();
    if (error) throw error;
    return String((data as Record<string, unknown>).id);
  }
  const { data, error } = await db().from('documents').insert(payload).select('id').single();
  if (error) throw error;
  return String((data as Record<string, unknown>).id);
}

/** Allocate the number, freeze the issuer, move off draft. Returns the issued row. */
export async function issueDocument(id: string): Promise<DocumentRecord> {
  const { data, error } = await db().rpc('issue_document', {
    p_id: id,
    p_issuer: DOCUMENT_ISSUER as unknown as Json,
  });
  if (error) throw error;
  return mapDocument(data as unknown as Record<string, unknown>);
}

/** Clone a quote into a fresh invoice draft; returns the NEW document's id. */
export async function convertDocument(id: string): Promise<string> {
  const { data, error } = await db().rpc('convert_document', { p_id: id });
  if (error) throw error;
  return String((data as unknown as Record<string, unknown>).id);
}

/** Void a numbered document (a draft is deleted instead — see `deleteDraft`). */
export async function voidDocument(id: string): Promise<void> {
  const { error } = await db().rpc('void_document', { p_id: id });
  if (error) throw error;
}

/** Delete a draft outright (only a draft — an issued document is voided, never removed). */
export async function deleteDraft(id: string): Promise<void> {
  const { error } = await db().from('documents').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Email the document to its client with the PDF attached. Goes through the staff route (which holds
 * the mail secret and renders the PDF server-side); the browser only carries the session token. The
 * route refuses a document with no client email.
 */
export async function emailDocument(id: string): Promise<{ recipient: string }> {
  const { data: sessionData } = await db().auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(`/api/v1/admin/documents/${id}/email`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: { emailed?: boolean; recipient?: string };
    error?: { message?: string };
  } | null;
  if (!res.ok || !body?.ok || !body.data?.emailed) {
    throw new Error(body?.error?.message ?? 'Could not email the document.');
  }
  return { recipient: body.data.recipient ?? '' };
}

export async function loadClients(): Promise<DocumentClientRecord[]> {
  const { data, error } = await db()
    .from('document_clients')
    .select('id, name, email, phone, street, locality, region, country, brn, vat')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapClient(r as Record<string, unknown>));
}

/** Insert or update a saved client (the "remember this client" path). Returns the stored row. */
export async function upsertClient(
  client: DocumentClient & { id?: string },
): Promise<DocumentClientRecord> {
  if (!client.name?.trim()) throw new ValidationError('A client needs a name.');
  const payload = {
    name: client.name,
    email: client.email ?? null,
    phone: client.phone ?? null,
    street: client.street ?? null,
    locality: client.locality ?? null,
    region: client.region ?? null,
    country: client.country ?? null,
    brn: client.brn ?? null,
    vat: client.vat ?? null,
    updated_at: new Date().toISOString(),
  };
  if (client.id) {
    const { data, error } = await db()
      .from('document_clients')
      .update(payload)
      .eq('id', client.id)
      .select('id, name, email, phone, street, locality, region, country, brn, vat')
      .single();
    if (error) throw error;
    return mapClient(data as Record<string, unknown>);
  }
  const { data, error } = await db()
    .from('document_clients')
    .insert(payload)
    .select('id, name, email, phone, street, locality, region, country, brn, vat')
    .single();
  if (error) throw error;
  return mapClient(data as Record<string, unknown>);
}
