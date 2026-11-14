import type { GuestHistory } from '@/lib/admin/quotes';

/**
 * The returning-guest hint on the quote editor: read-only, from the earlier quotes and bookings that
 * carry the same email. Pure; `loadGuestHistory` in src/lib/admin/quotes.ts does the reading.
 */

/** Worth looking up: something@something.tld, no spaces. Not a validator — a debounce gate. */
export function looksLikeEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());
}

export type { GuestHistory };

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Returning guest: 2 earlier quotes, 1 booking", leaving out the quote on screen; null if none. */
export function returningGuestNote(
  history: GuestHistory,
  currentQuoteId: string | null,
): string | null {
  const quotes = history.quotes.filter((q) => q.id !== currentQuoteId).length;
  const bookings = history.bookings.length;
  if (quotes === 0 && bookings === 0) return null;
  const parts: string[] = [];
  if (quotes > 0) parts.push(count(quotes, 'earlier quote', 'earlier quotes'));
  if (bookings > 0) parts.push(count(bookings, 'booking', 'bookings'));
  return `Returning guest: ${parts.join(', ')}`;
}
