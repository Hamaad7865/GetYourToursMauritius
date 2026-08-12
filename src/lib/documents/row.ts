import type { DocumentClient, DocumentInput, DocumentIssuer, DocumentType, VatMode } from './model';
import type { Currency } from './money';

/**
 * Map a stored `documents` row into the pure {@link DocumentInput} the model + renderers consume.
 * Kept separate from `model.ts` so the model stays free of any storage or business-identity concern;
 * this is the one place that knows a row's JSON columns and supplies a fallback issuer for a draft
 * (whose `issuer_snapshot` is only frozen at issue time).
 */

/** The subset of a `documents` row this mapper reads (loosely typed — the JSON columns are `unknown`). */
export interface DocumentRowLike {
  type: string;
  number: string | null;
  currency: string;
  client_snapshot: unknown;
  issuer_snapshot: unknown;
  lines: unknown;
  vat_mode: string;
  vat_rate_pct: number | null;
  amount_paid_minor: number | null;
  payment_method: string | null;
  payment_ref: string | null;
  paid_at: string | null;
  issue_date: string | null;
  due_date: string | null;
  valid_until: string | null;
  notes: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function clientFromSnapshot(snapshot: unknown): DocumentClient {
  const s = isObject(snapshot) ? snapshot : {};
  return {
    name: typeof s.name === 'string' ? s.name : '',
    email: str(s.email),
    phone: str(s.phone),
    street: str(s.street),
    locality: str(s.locality),
    region: str(s.region),
    country: str(s.country),
    brn: str(s.brn),
    vat: str(s.vat),
  };
}

function issuerFromSnapshot(snapshot: unknown, fallback: DocumentIssuer): DocumentIssuer {
  if (!isObject(snapshot) || typeof snapshot.legalName !== 'string' || !snapshot.legalName.trim()) {
    return fallback;
  }
  const s = snapshot;
  return {
    legalName: s.legalName as string,
    brn: str(s.brn),
    vat: str(s.vat),
    street: str(s.street),
    locality: str(s.locality),
    region: str(s.region),
    country: str(s.country),
    email: str(s.email),
    phone: str(s.phone),
  };
}

function linesFromJson(value: unknown): DocumentInput['lines'] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const l = isObject(raw) ? raw : {};
    return {
      description: typeof l.description === 'string' ? l.description : '',
      quantity: Number.isFinite(Number(l.quantity)) ? Number(l.quantity) : 1,
      unitMinor: Number.isFinite(Number(l.unitMinor)) ? Number(l.unitMinor) : 0,
    };
  });
}

export function documentInputFromRow(
  row: DocumentRowLike,
  fallbackIssuer: DocumentIssuer,
): DocumentInput {
  return {
    type: row.type as DocumentType,
    number: row.number,
    currency: row.currency as Currency,
    issuer: issuerFromSnapshot(row.issuer_snapshot, fallbackIssuer),
    client: clientFromSnapshot(row.client_snapshot),
    lines: linesFromJson(row.lines),
    vatMode: (row.vat_mode as VatMode) ?? 'inclusive',
    vatRatePct: row.vat_rate_pct ?? 15,
    issueDate: row.issue_date ?? '',
    dueDate: row.due_date,
    validUntil: row.valid_until,
    notes: row.notes,
    amountPaidMinor: row.amount_paid_minor ?? 0,
    paymentMethod: row.payment_method,
    paymentRef: row.payment_ref,
    paidAt: row.paid_at,
  };
}
