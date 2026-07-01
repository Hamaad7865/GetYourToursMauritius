/**
 * Compact, URL-safe encoding for a multi-tier party map ({ Adult: 2, Child: 1, Infant: 1 }) so the
 * age-band selection survives the widget → /checkout hop (and the cart line). The server still
 * re-derives every price from the DB (zero-trust) — this only carries the customer's chosen counts.
 * Format: `Adult:2~Child:1~Infant:1` (label url-encoded, `~` between tiers).
 */

export function encodeParty(party: Record<string, number>): string {
  return Object.entries(party)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${encodeURIComponent(label)}:${Math.round(n)}`)
    .join('~');
}

export function decodeParty(s: string | null | undefined): Record<string, number> | null {
  if (!s) return null;
  const out: Record<string, number> = {};
  for (const part of s.split('~')) {
    const i = part.indexOf(':'); // the label is url-encoded, so the first ':' is the separator
    if (i <= 0) continue;
    const label = decodeURIComponent(part.slice(0, i));
    const n = parseInt(part.slice(i + 1), 10);
    if (label && Number.isInteger(n) && n > 0) out[label] = (out[label] ?? 0) + n;
  }
  return Object.keys(out).length ? out : null;
}

/** Total headcount across all tiers (infants included — everyone takes a seat). */
export function partyGuests(party: Record<string, number>): number {
  return Object.values(party).reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
}
