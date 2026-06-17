import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { authenticateOptional } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
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

  const ctx = buildServiceContext(req);
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const lead = await captureLead(ctx, input, ip);
  return jsonOk(lead, { status: 201 });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
