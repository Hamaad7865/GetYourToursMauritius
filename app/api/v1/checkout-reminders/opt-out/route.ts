import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { rateLimit } from '@/lib/http/rate-limit';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { checkoutRecoveryOptOutSchema } from '@/lib/validation/checkout-recovery';
import { optOutOfCheckoutRecovery } from '@/lib/services/checkout-recovery';

export const runtime = 'edge';

/**
 * POST /api/v1/checkout-reminders/opt-out — the "stop these" link in the checkout-recovery email.
 * The 64-hex token IS the credential (the shopper may not be signed in on the device they read mail
 * on). A POST, not a GET, so a mail scanner pre-fetching links can't opt anyone out by accident.
 * Per-IP rate limited; an unknown token is `{ stopped: false }`, never an error.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'checkout_recovery_opt_out', 20, 60);
  const { token } = await parseJsonBody(req, checkoutRecoveryOptOutSchema);
  const stopped = await optOutOfCheckoutRecovery(serviceRoleRpcContext(), token);
  return jsonOk({ stopped });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
