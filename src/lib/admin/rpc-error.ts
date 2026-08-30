/**
 * The raw text of a supabase-js RPC failure, WHATEVER shape it arrives in.
 *
 * This is load-bearing, and it has already caused one shipped bug. `.rpc()` resolves its error as a
 * PLAIN OBJECT (`{ message, details, hint, code }`) — NOT an `Error` instance — and the admin helpers
 * rethrow exactly that. So in the browser `err instanceof Error` is false, and a naive `String(err)`
 * reads `"[object Object]"`, matches no token, and silently degrades a specific, actionable failure
 * into a generic "something went wrong" (see commit 9d08ca2, where it cost the reschedule override
 * step its entire confirm flow).
 *
 * Read the token off the object's `message`, with `details`/`code` as belt-and-suspenders.
 *
 * Lives here rather than beside either caller because every admin screen that raises a DB exception
 * to a human needs it, and a second private copy is exactly how the two spellings drift.
 */
export function rpcErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; details?: unknown; code?: unknown };
    return [o.message, o.details, o.code]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
  }
  return String(err);
}
