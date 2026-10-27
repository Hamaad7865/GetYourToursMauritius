/** PostgREST caps a response (1,000 rows on Supabase) and truncates SILENTLY: no error, no flag, just
 *  fewer rows. A plain `.limit(n)` read is therefore a quiet ceiling — the Bookings screen once read
 *  "300 of 300" while prod held 466. Every staff list that means "all of them" reads through
 *  {@link readAll} instead.
 *
 *  PAGE sits below the server cap on purpose: a page shorter than PAGE is then proof there is nothing
 *  left. (If max-rows were ever set below PAGE, every page would come back short and the read would
 *  stop after the first one — keep PAGE under the project's API "Max rows".) */
export const PAGE = 500;

/**
 * Read page by page until a short page says there is no more. `page(from, to)` is one inclusive
 * `.range(from, to)` request; its ORDER BY must be total (end on a unique column like `id`), or offset
 * paging can skip or repeat a row whose sort key ties across a page boundary.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/** Newest-first offset paging shifts when a row is inserted mid-read, so the row at a page boundary
 *  comes back twice. Keep the first sighting; the order is otherwise untouched. */
export function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}
