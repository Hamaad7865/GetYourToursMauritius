/** Shared, pure formatting for the ContactFloat enquiry widget — kept out of the component so the
 *  packed `contact` string, the WhatsApp hand-off message and the owner's email can't drift apart.
 *  Mirrors inquiry.ts, which does the same job for the activity-page InquiryWidget. */

export interface EnquiryDetails {
  name: string;
  email: string;
  phone: string;
  message: string;
  /** Title of the activity being viewed, or '' on a generic page. */
  activityTitle?: string;
  /** Preferred date, 'YYYY-MM-DD' (native date input value) or '' if unset. */
  date?: string;
  /** Party size, or null when the visitor left it blank. */
  people?: number | null;
}

/** True once the form has the minimum a reply needs: who they are, where to answer, and what they ask. */
export function enquiryReady(d: Partial<EnquiryDetails>): boolean {
  return Boolean(d.name?.trim() && d.email?.trim() && d.message?.trim());
}

/**
 * Packs email + phone into the leads table's single 200-char free-text `contact` field. The ' · '
 * separator is load-bearing — renderLeadEnquiryEmail splits on it to label each part in the owner's
 * alert. The message is NOT packed in here: it has its own column precisely so it isn't truncated.
 */
export function packEnquiryContact(d: Pick<EnquiryDetails, 'email' | 'phone'>): string {
  return [d.email.trim(), d.phone.trim()].filter(Boolean).join(' · ').slice(0, 200);
}

/** Message handed to the customer's own WhatsApp app when they pick chat over the form. Names the
 *  activity when there is one, so the owner isn't left guessing what "I have a question" is about. */
export function enquiryWhatsAppMessage(activityTitle?: string | null): string {
  return activityTitle
    ? `Hi Belle Mare Tours! I have a question about ${activityTitle}.`
    : 'Hi Belle Mare Tours! I have a question.';
}
