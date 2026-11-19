/** Enough to catch a slip before Pay. The server's Zod check is the real one. */
export const GUEST_EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type MissingDetail = 'name' | 'email' | 'phone';

/**
 * What checkout step ② still needs before "Go to payment" may advance, or null when nothing is
 * missing. A guest needs a name and a valid email (there is no account to fall back on); anyone
 * whose booking has a pickup or a transfer needs a phone. `phone` is the composed number, empty
 * when no digits were typed.
 */
export function missingDetail(input: {
  guestMode: boolean;
  phoneRequired: boolean;
  name: string;
  email: string;
  phone: string;
}): MissingDetail | null {
  if (input.guestMode && input.name.trim().length === 0) return 'name';
  if (input.guestMode && !GUEST_EMAIL_SHAPE.test(input.email.trim())) return 'email';
  if (input.phoneRequired && input.phone.trim().length === 0) return 'phone';
  return null;
}
