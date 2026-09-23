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
import { renderPhotoBalanceEmail } from '@/lib/email/photography';
import { isPhotographyCategory } from '@/lib/catalogue/photography';
import { SITE } from '@/lib/seo/site';
import { ConfigError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/photo-balance — "Photos delivered — request balance" in
 * /admin/photography.
 *
 * A photography booking is paid in two halves (20261010000000): the deposit confirmed it; the balance
 * is due when the photos are delivered. This emails the guest a link to their OWN booking page, where
 * the signed-in owner presses "Pay the balance" (create_payment purpose='balance' — the owner is allowed
 * by its identity check, and the amount is the booking's balance_due_minor, never anything sent here).
 * No bearer token is minted or emailed: the booking page is authenticated by the guest's account.
 *
 * Staff only — the same gate as the quote balance route: the JWT role is always 'authenticated', so the
 * business role is read from `profiles` through the service-role client. 'seo' is not admitted.
 *
 * Refuses (409) anything it should not email about: a booking that is not a photography package, not
 * confirmed (the deposit has not settled), carries no partial deposit, or owes nothing. A send failure
 * is NOT a failed request — the link is simply the booking URL, returned for the operator to copy.
 */

const bodySchema = z.object({});
const SENDING_ROLES = new Set(['admin', 'staff']);

type Row = Record<string, unknown>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}
interface Client {
  from(table: 'bookings' | 'booking_items' | 'profiles'): { select(columns: string): Builder };
}

const text = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const minor = (v: unknown) => Number(v ?? 0);
const fail = (error: unknown, what: string): never => {
  throw new Error(String((error as { message?: string })?.message ?? `${what} failed`));
};

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'admin_photo_balance', 20, 60);
  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as Client;

  const { data: profile, error: roleError } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (roleError) fail(roleError, 'profile read');
  if (!SENDING_ROLES.has(text(profile?.role))) throw new ForbiddenError('Staff only');

  await parseJsonBody(req, bodySchema);
  const { ref } = await params;

  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime; refusing to email the guest a localhost link.',
      { code: 'site_url_not_configured' },
    );
  }

  const { data: booking, error } = await db
    .from('bookings')
    .select(
      'id, ref, status, customer_name, customer_email, currency, locale, total_minor, deposit_minor, balance_due_minor',
    )
    .eq('ref', ref)
    .maybeSingle();
  if (error) fail(error, 'booking read');
  if (!booking) throw new NotFoundError('Not found');

  const { data: items, error: itemsError } = await db
    .from('booking_items')
    .select('activity_options(activities(title, category))')
    .eq('booking_id', text(booking.id));
  if (itemsError) fail(itemsError, 'booking items read');
  const activity = (items ?? [])
    .map(
      (i) =>
        (i.activity_options as { activities?: { title?: string; category?: string } } | null)
          ?.activities,
    )
    .find((a) => isPhotographyCategory(a?.category));
  if (!activity) {
    throw new ConflictError(`Booking ${ref} is not a photography booking.`);
  }

  const status = text(booking.status);
  const total = minor(booking.total_minor);
  const deposit = minor(booking.deposit_minor);
  const balance = minor(booking.balance_due_minor);
  if (status !== 'confirmed') {
    throw new ConflictError(
      `Booking ${ref} is ${status}, not confirmed — the deposit has not settled, so there is no balance to request yet.`,
    );
  }
  if (!(deposit > 0 && deposit < total)) {
    throw new ConflictError(`Booking ${ref} was paid in full — there is no balance to request.`);
  }
  if (balance <= 0) {
    throw new ConflictError(`Booking ${ref} is fully paid — nothing is owed.`);
  }

  const url = `${SITE.url}/bookings/${encodeURIComponent(text(booking.ref))}`;
  let emailed = false;
  try {
    const email = renderPhotoBalanceEmail({
      ref: text(booking.ref),
      customerName: text(booking.customer_name),
      packageTitle: activity.title ?? null,
      currency: text(booking.currency) || 'EUR',
      balanceDueMinor: balance,
      locale: text(booking.locale) || null,
    });
    await getNotificationProvider().send({
      // A fresh id per send — re-requesting the balance is a new email, not a retry of the last one.
      id: crypto.randomUUID(),
      channel: 'email',
      recipient: text(booking.customer_email),
      template: 'photo_balance',
      // From the monitored info@ inbox, so the guest can simply reply.
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

  return jsonOk({ url, emailed, balanceDueMinor: balance });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
