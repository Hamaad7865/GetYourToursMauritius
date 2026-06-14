import type { ServiceContext } from './context';
import type { PartySelection } from './pricing';
import { NotImplementedError } from './errors';

export type BookingSource = 'web' | 'ai_chat' | 'whatsapp';
export type BookingStatus = 'new' | 'confirmed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'refunded';

export interface CreateBookingInput {
  tourId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  startTime: string | null;
  /** Quantity per price-tier label; total is computed server-side from DB prices. */
  party: PartySelection;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
  };
  source?: BookingSource;
  notes?: string | null;
}

export interface Booking {
  id: string;
  ref: string;
  tourId: string;
  date: string;
  startTime: string | null;
  guests: number;
  totalEur: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  source: BookingSource;
  createdAt: string;
}

export async function createBooking(
  _ctx: ServiceContext,
  _input: CreateBookingInput,
): Promise<Booking> {
  // Phase 4: atomic capacity-check + insert via a Postgres RPC; price from DB only.
  throw new NotImplementedError('createBooking');
}

export async function getBookingStatus(_ctx: ServiceContext, ref: string): Promise<Booking> {
  throw new NotImplementedError(`getBookingStatus("${ref}")`);
}
