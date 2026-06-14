import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { createBookingInputSchema } from '@/lib/validation/booking';
import { createBooking } from '@/lib/services/bookings';

export const runtime = 'edge';

/** POST /api/v1/bookings — create a payment_pending booking (guest or authenticated). */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, createBookingInputSchema);
  const ctx = buildServiceContext(req);
  const booking = await createBooking(ctx, input);
  return jsonOk(booking, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
