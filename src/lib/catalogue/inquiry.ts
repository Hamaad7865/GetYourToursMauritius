/** Trip-request details collected by InquiryWidget for an `extra.inquiryOnly` activity (e.g.
 *  skydiving) — no hold, no checkout, no payment. Shared, pure formatting so the WhatsApp message,
 *  email body and the lead's `contact` string can't drift from each other or the component. */
export interface InquiryDetails {
  activityTitle: string;
  name: string;
  email: string;
  phone: string;
  /** Preferred date, 'YYYY-MM-DD' (native date input value) or '' if unset. */
  date: string;
  people: number;
}

/** True once every field the request needs is present — gates the WhatsApp/email submit buttons. */
export function inquiryReady(d: Partial<InquiryDetails>): boolean {
  return Boolean(
    d.name?.trim() && d.email?.trim() && d.phone?.trim() && d.date && (d.people ?? 0) >= 1,
  );
}

/** Multi-line body shared by the WhatsApp message and the email fallback. */
export function buildInquiryMessage(d: InquiryDetails): string {
  return [
    `Trip request: ${d.activityTitle}`,
    '',
    `Name: ${d.name.trim()}`,
    `Preferred date: ${d.date || 'Flexible'}`,
    `People: ${d.people}`,
    `Phone: ${d.phone.trim()}`,
    `Email: ${d.email.trim()}`,
  ].join('\n');
}

/** Packs phone/email/date/party-size into the leads table's single free-text `contact` field
 *  (capped at the schema's 200 chars — name has its own field, so it isn't repeated here). */
export function packInquiryContact(
  d: Pick<InquiryDetails, 'phone' | 'email' | 'date' | 'people'>,
): string {
  return [
    d.phone.trim(),
    d.email.trim(),
    d.date ? `Date: ${d.date}` : null,
    `${d.people} ${d.people === 1 ? 'person' : 'people'}`,
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 200);
}
