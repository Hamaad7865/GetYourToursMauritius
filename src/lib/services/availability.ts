import type { ServiceContext } from './context';
import { NotImplementedError } from './errors';

export interface AvailabilitySlot {
  id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Local start time (HH:MM), or null for all-day items. */
  startTime: string | null;
  capacity: number;
  seatsLeft: number;
}

export interface CheckAvailabilityInput {
  tourId: string;
  /** Inclusive ISO date range. */
  from: string;
  to: string;
}

export async function checkAvailability(
  _ctx: ServiceContext,
  input: CheckAvailabilityInput,
): Promise<AvailabilitySlot[]> {
  // Phase 2: query the `availability` table; capacity/seats_left logic lives here.
  throw new NotImplementedError(`checkAvailability("${input.tourId}")`);
}
