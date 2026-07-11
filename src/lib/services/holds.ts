import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { holdResultSchema, type CreateHoldInput, type HoldResult } from '@/lib/validation/booking';

/**
 * Reserve the spot for a date (anonymous-friendly). The DB computes the qty from the pricing mode.
 *
 * `userId` is the route's JWKS-VERIFIED user id (never client input): the route calls this RPC through
 * a service-role client (its anon/authenticated grants are revoked), so auth.uid() is null inside the
 * function and the hold would otherwise land ownerless — unreleasable by the signed-in customer. The
 * RPC stamps it into booking_holds.created_by; null (guest) leaves the hold anonymous as before.
 */
export async function createHold(
  ctx: ServiceContext,
  input: CreateHoldInput,
  userId?: string | null,
): Promise<HoldResult> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const data = await callRpc(ctx, 'api_create_hold', {
    occurrenceId: input.occurrenceId,
    expectedSlug: input.expectedSlug ?? null,
    people: input.people,
    idempotencyKey: `${idempotencyKey}:hold`,
    userId: userId ?? null,
  });
  return holdResultSchema.parse(data);
}
