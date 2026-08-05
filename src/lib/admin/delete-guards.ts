import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Shared helpers for the /admin delete paths that can be blocked by a row somewhere else.
 *
 * Two jobs, both of which were being done ad hoc:
 *
 *  1. RECOGNISING the failure. Postgres words a RESTRICT reference ("violates RESTRICT setting of
 *     foreign key constraint …", SQLSTATE 23001) differently from a plain NO ACTION one ("violates
 *     foreign key constraint …", 23503), and the Supabase browser client surfaces it as a plain
 *     PostgrestError object rather than an Error — so neither `instanceof` nor a single code check is
 *     enough on its own.
 *
 *  2. COUNTING what still references the row, so the operator is told how much stands in their way
 *     rather than a constraint name. The quotes module's tables (20260909000000) are not in the
 *     generated src/lib/supabase/types.ts, so those reads go through a structural cast rather than
 *     dragging a types regeneration into a delete-error message.
 *
 * A count that FAILS returns null, never 0: "appears on 0 booking lines and cannot be removed" is a
 * self-contradiction that hides the real cause (a schema cache that has not caught up with a deploy,
 * an RLS denial, a dropped connection). Callers drop the number instead.
 */

/** True for a Postgres integrity violation caused by a foreign key, whichever transport surfaced it. */
export function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  // 23503 = foreign_key_violation (NO ACTION), 23001 = restrict_violation (ON DELETE RESTRICT).
  if (code === '23503' || code === '23001') return true;
  const message = errorMessage(error);
  return /foreign key constraint/i.test(message);
}

/** The human-readable text of a thrown Error OR of a PostgrestError-shaped object. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}

type CountResponse = { count?: number | null; error?: unknown };
interface UntypedCountClient {
  from(table: string): {
    select(
      cols: string,
      opts: { count: 'exact'; head: true },
    ): {
      eq(column: string, value: string): PromiseLike<CountResponse>;
      in(column: string, values: readonly string[]): PromiseLike<CountResponse>;
    };
  };
}

function untypedClient(): UntypedCountClient {
  return getBrowserSupabase() as unknown as UntypedCountClient;
}

/**
 * How many rows of `table` have `column = value`. Counted in the database (`head: true`) rather than
 * by materialising rows, so it cannot under-report past PostgREST's default row cap.
 * Null means the count could not be taken — NOT that there are none.
 */
export async function countRowsEq(
  table: string,
  column: string,
  value: string,
): Promise<number | null> {
  const { count, error } = await untypedClient()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value);
  return error ? null : (count ?? null);
}

/** As `countRowsEq`, for `column in (…)`. An empty list is zero without touching the database. */
export async function countRowsIn(
  table: string,
  column: string,
  values: readonly string[],
): Promise<number | null> {
  if (values.length === 0) return 0;
  const { count, error } = await untypedClient()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .in(column, values);
  return error ? null : (count ?? null);
}
