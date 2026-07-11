import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { serviceRoleRpcContext } from '@/lib/http/context';
import { clientIp } from '@/lib/http/rate-limit';
import { captureLeadInputSchema } from '@/lib/validation/booking';
import { captureLead } from '@/lib/services/leads';

export const runtime = 'edge';

/** POST /api/v1/leads — capture a sales lead (public).
 *
 * Public + unauthenticated, so it is abuse-prone. Defence in depth: a hidden honeypot field drops
 * obvious bots, and a per-IP rate limit (enforced in api_capture_lead) caps floods. The primary
 * control should still be a Cloudflare Rate Limiting rule / Turnstile challenge at the edge. */
export const POST = apiHandler(async (req) => {
  await authenticateOptional(req);
  const input = await parseJsonBody(req, captureLeadInputSchema);

  // Honeypot: real users never fill `company`. Pretend success and store nothing.
  if (input.company && input.company.trim().length > 0) {
    return jsonOk({ received: true }, { status: 201 });
  }

  // api_capture_lead is revoked from anon/authenticated and the open `leads_insert` policy is dropped,
  // so both the RPC call and the underlying insert must run as the service role (the RPC is SECURITY
  // DEFINER + identity-free, so this is behaviour-preserving; the per-IP throttle lives inside it).
  const ctx = serviceRoleRpcContext();
  // Length-capped (see clientIp) so a spoofed giant x-forwarded-for can't bloat the lead row.
  const ip = clientIp(req);
  const lead = await captureLead(ctx, input, ip);
  return jsonOk(lead, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
