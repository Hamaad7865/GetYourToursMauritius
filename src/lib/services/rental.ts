import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { rentalVehiclesSchema, type RentalVehicle } from '@/lib/validation/rental';

/** The active rental fleet for the public /rent page, ordered for display. WhatsApp-only — there is no
 *  booking/charge, so this is the only server read the rental feature needs. */
export async function listRentalVehicles(ctx: ServiceContext): Promise<RentalVehicle[]> {
  const data = await callRpc(ctx, 'api_list_rental_vehicles', {});
  return rentalVehiclesSchema.parse(data ?? []);
}
