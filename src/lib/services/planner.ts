import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { plannerPlaceSchema, type PlannerPlace } from '@/lib/validation/planner';

/** Read the curated road-trip places. Public data, so no auth needed. */
export async function listPlannerPlaces(ctx: ServiceContext): Promise<PlannerPlace[]> {
  const data = await callRpc(ctx, 'api_planner_places', {});
  return z.array(plannerPlaceSchema).parse(data);
}
