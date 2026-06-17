/**
 * Pure helpers for the planner's shareable / deep-link URL (`?stops=a,b,c`). A sightseeing tour links
 * into the planner with its itinerary pre-filled, and the planner keeps the URL in sync so a visitor
 * can copy/share their day. Kept pure (no DOM) so it unit-tests and runs on both server and client.
 */

/**
 * Parse the `?stops=` value into a clean, de-duplicated id list, keeping ONLY ids that exist in the
 * curated set — so a stale or hand-edited link can never inject unknown places into the planner.
 * Order is preserved (the link encodes the intended visiting order).
 */
export function parseStopsParam(
  raw: string | null | undefined,
  validIds: Iterable<string>,
): string[] {
  if (!raw) return [];
  const valid = new Set(validIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id && valid.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Serialize the current itinerary's place ids back into a `stops` query value (order-preserving). */
export function stopsToParam(ids: string[]): string {
  return ids.join(',');
}
