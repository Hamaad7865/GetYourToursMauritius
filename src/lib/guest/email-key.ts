/**
 * "The same address", for guest bookings. {@link guestEmailKey} must stay identical to SQL's
 * quote_email_key(): lower + trim, null for blank, so a claim here and the confirmed-account match
 * in quote_owner_for_email can never disagree about which mailbox they mean.
 */
export function guestEmailKey(email: string | null | undefined): string | null {
  const key = (email ?? '').trim().toLowerCase();
  return key || null;
}

/**
 * The key the per-email CAPS count by: {@link guestEmailKey} without a `+tag`, so ten plus-addressed
 * copies of one mailbox count as one. FOR COUNTING ONLY. A claim must use the exact key, because
 * `anna+trip@` and `anna@` are different addresses to the account system.
 */
export function guestEmailCountKey(email: string | null | undefined): string | null {
  const key = guestEmailKey(email);
  if (!key) return null;
  const at = key.lastIndexOf('@');
  if (at <= 0) return key;
  return `${key.slice(0, at).split('+')[0]}${key.slice(at)}`;
}

const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
};

/**
 * A guest has no account to fall back on: a mistyped address means no confirmation and no way back to
 * the booking from another device. Returns the corrected address for a known slip of the domain, or
 * null. Display only; the guest decides.
 */
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const fix = DOMAIN_TYPOS[trimmed.slice(at + 1).toLowerCase()];
  return fix ? `${trimmed.slice(0, at)}@${fix}` : null;
}
