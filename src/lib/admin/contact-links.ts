/**
 * How the back office turns a guest's stored email and phone into links — the ONE rule, shared by
 * the Bookings detail, the calendar's day sheet, the enquiries inbox and the quotes worklist. Pure.
 *
 * ── AN EMAIL LINK ONLY FOR EXACTLY ONE ADDRESS ─────────────────────────────────────────────────
 * Contact fields are free text a visitor typed. Turned blindly into `mailto:`, a value like
 * `a@b.com?cc=x@y.com&body=…` lets whoever typed it pre-fill the message a staff member sends. So a
 * link is made only when the whole value is strictly one address; anything else stays plain text.
 *
 * ── A WHATSAPP LINK ONLY WHEN THE NUMBER CARRIES ITS COUNTRY CODE ──────────────────────────────
 * wa.me needs the full international number. A number typed without one ('5772 9919',
 * '0612345678') is refused rather than guessed: a wrong guess opens a chat with a stranger (and, on
 * the quotes screen, hands them a payment link). The links made here carry NO pre-written message —
 * nothing with a link or token in it is ever put into a URL from these screens.
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** `mailto:<address>` when the value is strictly one email address, else null. */
export function mailtoHref(contact: string | null | undefined): string | null {
  const trimmed = String(contact ?? '').trim();
  return EMAIL_RE.test(trimmed) ? `mailto:${trimmed}` : null;
}

export type WhatsAppNumber = { digits: string } | { reason: string };

const NEEDS_CODE =
  'Add the country code to the guest’s phone number (for example +44 7700 900123) to send on WhatsApp.';

/** The digits wa.me dials, or why this phone number cannot be used. */
export function whatsappNumber(phone: string | null | undefined): WhatsAppNumber {
  const raw = String(phone ?? '').trim();
  if (!raw) {
    return { reason: 'No phone number on this quote. Add the guest’s WhatsApp number to use it.' };
  }
  // Spacing and punctuation people type; a national "(0)" trunk digit after the country code.
  const compact = raw.replace(/\(0\)/g, '').replace(/[\s().\-/]/g, '');
  let digits: string;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else return { reason: NEEDS_CODE };
  if (!/^\d+$/.test(digits)) {
    return {
      reason: 'The guest’s phone number has letters or an extension in it. Keep only the number.',
    };
  }
  if (digits.startsWith('0') || digits.length < 8 || digits.length > 15) {
    return {
      reason: 'The guest’s phone number is not a full international number. Check the digits.',
    };
  }
  return { digits };
}

/** `https://wa.me/<digits>` to open a chat — no message — or null when the number has no country
 *  code (see above). */
export function whatsappChatHref(phone: string | null | undefined): string | null {
  const n = whatsappNumber(phone);
  return 'digits' in n ? `https://wa.me/${n.digits}` : null;
}

/** `tel:<number>` with the spaces taken out, or null with no number. */
export function telHref(phone: string | null | undefined): string | null {
  const compact = String(phone ?? '').replace(/\s+/g, '');
  return compact ? `tel:${compact}` : null;
}
