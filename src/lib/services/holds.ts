import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { holdResultSchema, type CreateHoldInput, type HoldResult } from '@/lib/validation/booking';

/** Reserve the spot for a date (anonymous-friendly). The DB computes the qty from the pricing mode. */
export async function createHold(ctx: ServiceContext, input: CreateHoldInput): Promise<HoldResult> {
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
  const data = await callRpc(ctx, 'api_create_hold', {
    occurrenceId: input.occurrenceId,
    expectedSlug: input.expectedSlug ?? null,
    people: input.people,
    idempotencyKey: `${idempotencyKey}:hold`,
  });
  return holdResultSchema.parse(data);
}
