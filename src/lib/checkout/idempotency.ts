/** Resolve the booking idempotency key, preferring a persisted one so a remount/Back reuses it
 *  (preventing a duplicate booking) over minting a fresh random key.
 *
 *  Precedence: a key persisted for this occurrence (survives a Back/reload) → the hold's key handed
 *  over from Continue → a freshly minted random key. Whitespace-only candidates are ignored so a stray
 *  space can never become the dedup key the server keys on. The surviving key is trimmed for the same
 *  reason. */
export function resolveIdemKey(input: { persisted?: string | null; fromHold?: string | null; fresh: string }): string {
  return input.persisted?.trim() || input.fromHold?.trim() || input.fresh;
}
