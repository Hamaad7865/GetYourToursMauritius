/** Return a copy of `arr` with the element at `from` moved to index `to`. Out-of-range
 *  `from` or `to` is a no-op (returns an unchanged copy), so callers can wire up
 *  move-up / move-down buttons without guarding the array ends themselves. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = arr.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
