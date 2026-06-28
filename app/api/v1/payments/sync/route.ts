import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { rateLimit } from '@/lib/http/rate-limit';
import { syncPaymentInputSchema } from '@/lib/validation/booking';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';

export const runtime = 'edge';

/**
 * POST /api/v1/payments/sync — confirm a booking from the provider's AUTHORITATIVE status, without
 * waiting on (or trusting) a webhook. The client calls this once the embedded checkout completes; we
 * re-query the provider by its checkout id and, if it's a successful payment, append the verified
 * event to the ledger (which confirms the booking). Requires the booking's owner.
 *
 * Safe by construction: the status comes from an authenticated call to the provider (never the
 * client), so a caller cannot fake a payment — and they may only sync a checkout for a booking they
 * own. Idempotent: re-syncing a confirmed booking is a no-op at the ledger.
 */
export const POST = apiHandler(async (req) => {
  const user = await requireUser(req);
  const ctx = buildServiceContext(req);
  // Throttle BEFORE the billed Peach round-trip below: a valid login otherwise lets a caller force
  // unbounded provider status queries for arbitrary checkout ids (cost / merchant rate-limit pressure).
  await rateLimit(req, ctx, 'payments:sync', 20);
  const { checkoutId } = await parseJsonBody(req, syncPaymentInputSchema);

  const event = await ctx.payments.getCheckoutStatus(checkoutId);
  if (!event.bookingRef) {
    return jsonError(404, 'not_found', 'No booking is linked to this checkout');
  }

  const admin = createServiceRoleClient();
  const { data: booking, error: bookingErr } = await admin
    .from('bookings')
    .select('id, user_id')
    .eq('ref', event.bookingRef)
    .maybeSingle();
  if (bookingErr) throw new Error(bookingErr.message);
  if (!booking) return jsonError(404, 'not_found', 'Booking not found');
  // Authorize: only the booking's owner may sync it (the checkout id is not a bearer credential).
  if (booking.user_id !== user.id) {
    return jsonError(403, 'forbidden', 'You do not own this booking');
  }

  const result = await reconcilePaymentEvent(admin, event);
  return jsonOk({ outcome: event.outcome, confirmed: result.confirmed });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
