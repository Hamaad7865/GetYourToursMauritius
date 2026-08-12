import type { DocumentModel } from '@/lib/documents/model';
import { formatMinor } from '@/lib/documents/money';

/**
 * The covering email that carries a document (quote / invoice / proforma / receipt) to a client, with
 * the PDF attached. Pure: it takes the already-built {@link DocumentModel} and returns subject + text +
 * html, so it is unit-testable and the renderer that draws the PDF and the email that describes it
 * cannot disagree about the figures.
 */

const NOUN: Record<DocumentModel['type'], string> = {
  quote: 'quotation',
  invoice: 'invoice',
  proforma: 'proforma invoice',
  receipt: 'receipt',
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DocumentEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderDocumentEmail(model: DocumentModel): DocumentEmail {
  const noun = NOUN[model.type];
  const ref = model.number ? ` ${model.number}` : '';
  const money = (minor: number) => `${model.symbol} ${formatMinor(minor)}`;
  const greetingName = model.client.name?.trim() || 'there';

  const subject =
    model.type === 'quote'
      ? `Your quotation from ${model.issuer.legalName}`
      : `${noun.charAt(0).toUpperCase()}${noun.slice(1)}${ref} from ${model.issuer.legalName}`;

  // The one figure line that matters for each type: a receipt shows what was paid, everything else what
  // is owed (or the total, when it is already settled).
  const figureLine =
    model.type === 'receipt'
      ? `Amount paid: ${money(model.amountPaidMinor)}.`
      : model.isPaid
        ? `Total: ${money(model.totalMinor)} — paid in full, thank you.`
        : `Total: ${money(model.totalMinor)}. Amount due: ${money(model.amountDueMinor)}.`;

  const lead =
    model.type === 'receipt'
      ? `Please find attached your receipt${ref} — thank you for your payment.`
      : model.type === 'quote'
        ? `Please find attached our quotation for your consideration.`
        : `Please find attached your ${noun}${ref}.`;

  const text = [
    `Dear ${greetingName},`,
    '',
    lead,
    '',
    figureLine,
    model.notes ? `\n${model.notes}\n` : '',
    `Kind regards,`,
    model.issuer.legalName,
    [model.issuer.email, model.issuer.phone].filter(Boolean).join(' · '),
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1f;max-width:560px">
  <p>Dear ${esc(greetingName)},</p>
  <p>${esc(lead)}</p>
  <p style="font-weight:bold">${esc(figureLine)}</p>
  ${model.notes ? `<p style="white-space:pre-wrap;color:#333">${esc(model.notes)}</p>` : ''}
  <p style="margin-top:24px">Kind regards,<br/><strong>${esc(model.issuer.legalName)}</strong><br/>
  <span style="color:#6a6a70">${esc([model.issuer.email, model.issuer.phone].filter(Boolean).join(' · '))}</span></p>
</div>`;

  return { subject, text, html };
}
