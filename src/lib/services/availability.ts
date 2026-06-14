import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { availabilitySlotSchema, type AvailabilitySlot } from '@/lib/validation/tours';

export interface CheckAvailabilityInput {
  slug: string;
  /** Inclusive ISO date range (YYYY-MM-DD); defaults to the next 30 days. */
  from?: string;
  to?: string;
}

export async function checkAvailability(
  ctx: ServiceContext,
  input: CheckAvailabilityInput,
): Promise<AvailabilitySlot[]> {
  const data = await callRpc(ctx, 'api_list_availability', {
    slug: input.slug,
    from: input.from ?? null,
    to: input.to ?? null,
  });
  return z.array(availabilitySlotSchema).parse(data);
}
