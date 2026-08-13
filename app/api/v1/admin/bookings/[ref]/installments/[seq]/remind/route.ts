import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { getNotificationProvider } from '@/lib/notifications';
import { renderInstallmentReminderEmail } from '@/lib/email/quote';
import { mintInstallmentToken } from '@/lib/quotes/installment-token';
import { installmentChargeMinor } from '@/lib/quotes/payment-schedule';
import { installmentSeqLooksValid } from '@/lib/quotes/link-cookie';
import { ConfigError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string; seq: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/installments/:seq/remind — the operator's "Send reminder now" button
 * on a per-date booking's payment schedule (src/components/booking/PaymentSchedule.tsx).
 *
 * The automated chase (api_enqueue_installment_reminders) only fires ~3 days before each date; this lets
 * the operator send the SAME reminder for a chosen installment on demand — to chase early, or to re-send
 * one that bounced. The email is byte-identical to the cron's because it renders through the same
 * {@link renderInstallmentReminderEmail} with the same deterministic HMAC link
 * ({@link mintInstallmentToken}), and asks for the same {@link installmentChargeMinor} the pay link
 * charges (the running total up to this installment, minus what is settled).
 *
 * SENT IN-REQUEST, not via the notification_outbox — exactly like the balance-link route, and here for a
 * second reason too: the hosted sandbox has no cron to drain the outbox, so a queued reminder would never
 * leave. Rendering + sending here means the button works everywhere and gives the operator an immediate
 * "emailed" answer. The installment token is a deterministic HMAC recomputed at render time and never
 * persisted, so nothing sensitive is written anywhere by this path.
 *
 * STAFF ONLY, and the check is `profiles.role` looked up through the service-role client — never the
 * JWT's Postgres role (which is 'authenticated' for staff and customer alike). 'seo' is not admitted: a
 * booking carries the guest's name, email and the money owed. Every refusal is a readable 404/409 taken
 * from the booking's own state, so the button never claims to have sent a reminder the data can't support.
 */

const bodySchema = z.object({});

/** The business roles allowed to email a guest on the company's behalf. */
const SENDING_ROLES = new Set(['admin', 'staff']);

type Row = Record<string, unknown>;
interface ReadBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): ReadBuilder;
  order(column: string, opts: { ascending: boolean }): ReadBuilder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}
interface RemindClient {
  from(table: 'bookings' | 'quotes' | 'profiles' | 'booking_installments'): {
    select(columns: string): ReadBuilder;
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}
function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}
function minor(value: unknown): number {
  return Number(value ?? 0);
}

/** The caller's business role, read through the SERVICE-ROLE client (profiles is RLS-protected). */
async function callerRole(db: RemindClient, userId: string): Promise<string | null> {
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error)
    throw new Error(String((error as { message?: string }).message ?? 'profile read failed'));
  return textOrNull(data?.role ?? null);
}

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'admin_installment_remind', 30, 60);

  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as RemindClient;
  const role = await callerRole(db, user.id);
  if (!role || !SENDING_ROLES.has(role)) throw new ForbiddenError('Staff only');

  await parseJsonBody(req, bodySchema);

  const { ref, seq } = await params;
  if (!installmentSeqLooksValid(seq)) throw new NotFoundError('Not found');
  const seqNum = Number(seq);

  // The link the guest clicks is absolute; refuse to send one pointing at localhost on a live runtime.
  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime — refusing to email a reminder whose pay link would be localhost.',
      { code: 'site_url_not_configured' },
    );
  }

  const { data: booking, error: bErr } = await db
    .from('bookings')
    .select('id, status, customer_email, customer_name, total_minor, balance_due_minor')
    .eq('ref', ref)
    .maybeSingle();
  if (bErr)
    throw new Error(String((bErr as { message?: string }).message ?? 'booking read failed'));
  if (!booking) throw new NotFoundError('Not found');

  const bookingId = text(booking.id);
  const status = text(booking.status);
  const totalMinor = minor(booking.total_minor);
  const balanceDueMinor = minor(booking.balance_due_minor);
  const recipient = textOrNull(booking.customer_email);

  if (status !== 'confirmed') {
    throw new ConflictError(
      `Booking ${ref} is ${status}, not confirmed — its deposit has not settled, so there is no ` +
        `installment to chase yet.`,
    );
  }
  if (!recipient) {
    throw new ConflictError(
      `Booking ${ref} has no email address on file, so a reminder cannot be sent.`,
    );
  }

  // The QUOTE ref — the installment link + its token are keyed on it (the booking has no account).
  const { data: quote, error: qErr } = await db
    .from('quotes')
    .select('ref')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (qErr) throw new Error(String((qErr as { message?: string }).message ?? 'quote read failed'));
  const quoteRef = textOrNull(quote?.ref ?? null);
  if (!quoteRef) {
    throw new ConflictError(
      `Booking ${ref} has no quote behind it, so there is no installment link to send.`,
    );
  }

  // The whole schedule — to find this installment's label and size the running-total charge exactly as
  // the pay link and the cron do (installmentChargeMinor).
  const { data: rows, error: iErr } = await db
    .from('booking_installments')
    .select('seq, label, amount_minor')
    .eq('booking_id', bookingId)
    .order('seq', { ascending: true });
  if (iErr)
    throw new Error(String((iErr as { message?: string }).message ?? 'schedule read failed'));
  const installments = (rows ?? []).map((r) => ({
    seq: Number(r.seq ?? 0),
    label: text(r.label),
    amountMinor: minor(r.amount_minor),
  }));
  const target = installments.find((i) => i.seq === seqNum);
  if (!target) throw new NotFoundError('Not found');

  const amountDueMinor = installmentChargeMinor(installments, seqNum, totalMinor, balanceDueMinor);
  if (amountDueMinor <= 0) {
    throw new ConflictError(
      `Installment ${seqNum} on booking ${ref} is already covered by what has been paid — there is ` +
        `nothing to remind about.`,
    );
  }

  // Render from the deterministic HMAC token (never persisted) and send in-request. A send failure is
  // reported as emailed:false, not a 500 — the operator can retry — matching the balance-link route.
  let emailed = false;
  try {
    const token = await mintInstallmentToken(bookingId, seqNum);
    const email = renderInstallmentReminderEmail({
      ref: quoteRef,
      seq: seqNum,
      linkToken: token,
      customerName: text(booking.customer_name),
      currency: 'EUR',
      amountMinor: amountDueMinor,
      label: target.label,
    });
    await getNotificationProvider().send({
      id: crypto.randomUUID(),
      channel: 'email',
      recipient,
      template: 'installment_reminder',
      from: getServerEnv().QUOTE_FROM ?? SITE.email,
      payload: {},
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    emailed = true;
  } catch {
    emailed = false;
  }

  return jsonOk({ emailed, recipient, amountDueMinor, label: target.label, seq: seqNum });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
