/**
 * Validates a caller-supplied `?return=` destination down to a same-origin RELATIVE path.
 *
 * /bookings/{ref}/pay defaults to sending the customer back to /bookings/{ref}, which only renders for
 * the booking's OWNER — BookingConfirmation fetches with a bearer token and otherwise says "Sign in to
 * view booking …". A guest who paid a quote has no account, so that default charges them and then shows
 * them a sign-in wall. `?return=` lets the page that minted the checkout name somewhere the guest can
 * actually render.
 *
 * That parameter arrives in a URL anyone can compose and hand to a customer, on the screen immediately
 * after a card number is typed, so an unvalidated one is an open redirect into a convincing phishing
 * page. The two shapes a naive `startsWith('/')` waves through are the ones that matter: `//evil.com`
 * is a protocol-relative URL, and `/\evil.com` is treated as one by every major browser.
 */

/** Longer than any real path here, short enough not to be a header-stuffing vector. */
const MAX_LENGTH = 512;

/**
 * One leading slash whose next character cannot turn it into an authority (`//host`, `/\host`), then
 * printable ASCII only — 0x21..0x7E minus 0x5C (`\`), which browsers normalise to `/`.
 *
 * An ALLOW-list, not a deny-list: it excludes the space, every C0/C1 control character (a header- or
 * log-injection attempt looks exactly like a `\n` in a path) and everything non-ASCII, without having
 * to enumerate them. A destination needing a non-ASCII character must arrive percent-encoded, which
 * this accepts; every path this project actually returns to is ASCII.
 */
const RELATIVE_PATH = /^\/(?![/\\])[\x21-\x5B\x5D-\x7E]*$/;

export function safeReturnPath(raw: string | string[] | undefined, fallback: string): string {
  // A repeated query parameter (`?return=a&return=b`) arrives as an array; there is no single answer,
  // so there is no answer.
  if (typeof raw !== 'string') return fallback;
  if (raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!RELATIVE_PATH.test(raw)) return fallback;
  return raw;
}
