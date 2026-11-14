import { SITE } from '@/lib/seo/site';

/**
 * "Send on WhatsApp", without the WhatsApp Business API: a `https://wa.me/<number>?text=<message>`
 * link that opens WhatsApp with the message typed and the operator presses send. Pure.
 *
 * ── THE LINK IN THE MESSAGE IS ALWAYS A FRESH ONE ──────────────────────────────────────────────
 * The raw quote token exists only in the send route's response (and the guest's email). The screen
 * passes that `url` straight in here and renders the result as a link; nothing builds, stores or logs
 * a token. A quote that has not just been sent has no link to share, so there is no WhatsApp button
 * that works without sending.
 *
 * ── A NUMBER IS USED ONLY WHEN IT CARRIES ITS COUNTRY CODE ─────────────────────────────────────
 * wa.me needs the full international number. A number typed without one ('5772 9919', '0612345678')
 * is refused rather than guessed: a wrong guess opens a chat with a stranger and hands them a
 * payment link. `whatsappUrl` in src/lib/seo/site.ts is not used here because it falls back to the
 * company's own number when the one given is empty.
 */

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

/** `https://wa.me/<digits>?text=<message>`, the message URL-encoded. */
export function whatsappHref(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** The message that carries a freshly sent quote link, in the quote's language. */
export function quoteWhatsAppText(input: {
  customerName: string;
  ref: string;
  url: string;
  locale: string | null;
}): string {
  const name = firstName(input.customerName);
  if (input.locale === 'fr') {
    return (
      `Bonjour${name ? ` ${name}` : ''}, voici votre devis ${input.ref} de ${SITE.name}. ` +
      `Vous pouvez le consulter et le régler en ligne ici : ${input.url}`
    );
  }
  return (
    `Hello${name ? ` ${name}` : ''}, here is your quote ${input.ref} from ${SITE.name}. ` +
    `You can look it over and pay securely here: ${input.url}`
  );
}

/** The message that carries a balance payment link, in the quote's language. */
export function balanceWhatsAppText(input: {
  customerName: string;
  url: string;
  locale: string | null;
}): string {
  const name = firstName(input.customerName);
  if (input.locale === 'fr') {
    return (
      `Bonjour${name ? ` ${name}` : ''}, voici le lien pour régler le solde de votre réservation ` +
      `avec ${SITE.name} : ${input.url}`
    );
  }
  return (
    `Hello${name ? ` ${name}` : ''}, here is the link to pay the balance of your booking with ` +
    `${SITE.name}: ${input.url}`
  );
}
