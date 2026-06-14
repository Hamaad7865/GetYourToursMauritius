import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { leadSchema, type CaptureLeadInput, type Lead } from '@/lib/validation/booking';

/** Capture a sales lead (also reachable from the AI assistant in Phase 5). */
export async function captureLead(ctx: ServiceContext, input: CaptureLeadInput): Promise<Lead> {
  const data = await callRpc(ctx, 'api_capture_lead', {
    name: input.name,
    contact: input.contact,
    interestActivityId: input.interestActivityId ?? null,
    source: input.source ?? 'web',
  });
  return leadSchema.parse(data);
}
