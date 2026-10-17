/**
 * The opening-hours nudge's "Yes, reorder": move EVERY stop with a closing time forward in one go,
 * earliest-closing first. Moving only the flagged stop pushed the next early-closer late, which
 * re-nudged, whose fix pushed the first one late again — a loop. A non-closing first stop (nearest
 * the pick-up) keeps its place, as the single-stop move always did.
 */
export function frontLoadClosingStops(ids: string[], closeById: Map<string, string>): string[] {
  const closers = ids
    .filter((id) => closeById.has(id))
    .sort((a, b) => closeById.get(a)!.localeCompare(closeById.get(b)!));
  const rest = ids.filter((id) => !closeById.has(id));
  return rest.length && rest[0] === ids[0]
    ? [rest[0]!, ...closers, ...rest.slice(1)]
    : [...closers, ...rest];
}

/** The stop to nudge about: the earliest-closing one sitting third or later that the visitor has not
 *  already answered a nudge for. */
export function findBoost(
  stops: { id: string; name: string; closesAt?: string | null }[],
  handled: ReadonlySet<string>,
): { place: string; close: string; id: string } | null {
  let found: { place: string; close: string; id: string } | null = null;
  stops.forEach((p, idx) => {
    if (p.closesAt && idx >= 2 && !handled.has(p.id) && (!found || p.closesAt < found.close)) {
      found = { place: p.name, close: p.closesAt, id: p.id };
    }
  });
  return found;
}
