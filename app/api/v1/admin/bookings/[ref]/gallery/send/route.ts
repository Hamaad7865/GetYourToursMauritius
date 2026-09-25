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
import { renderGalleryReadyEmail } from '@/lib/email/photography';
import { isPhotographyCategory } from '@/lib/catalogue/photography';
import { SITE } from '@/lib/seo/site';
import { ConfigError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/gallery/send — "Send gallery link" in /admin/photography's
 * customer-galleries card.
 *
 * Emails the guest a link to their private gallery (/bookings/:ref#gallery), authenticated by
 * their account like every other booking link — no token rides in the URL. Mirrors the
 * photo-balance route's gates: staff only (profiles.role through the service role, never the
 * JWT role), live site URL required, and refusals (409) for anything it should not email about:
 * not a photography booking, or no gallery photos uploaded yet. A send failure is NOT a failed
 * request — the link is simply the gallery URL, returned for the operator to copy.
 */

const bodySchema = z.object({});
const SENDING_ROLES = new Set(['admin', 'staff']);

type Row = Record<string, unknown>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}
interface Client {
  from(table: 'bookings' | 'booking_items' | 'booking_photos' | 'profiles'): {
    select(columns: string): Builder;
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
const fail = (error: unknown, what: string): never => {
  throw new Error(String((error as { message?: string })?.message ?? `${what} failed`));
};

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'admin_gallery_send', 20, 60);
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
    .select('id, ref, status, customer_name, customer_email, locale')
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

  const { data: photos, error: photosError } = await db
    .from('booking_photos')
    .select('id')
    .eq('booking_id', text(booking.id));
  if (photosError) fail(photosError, 'gallery read');
  const photoCount = (photos ?? []).length;
  if (photoCount === 0) {
    throw new ConflictError(`Booking ${ref} has no gallery photos yet — upload some first.`);
  }

  const url = `${SITE.url}/bookings/${encodeURIComponent(text(booking.ref))}#gallery`;
  let emailed = false;
  try {
    const email = renderGalleryReadyEmail({
      ref: text(booking.ref),
      customerName: text(booking.customer_name),
      packageTitle: (activity.title as string | undefined) ?? null,
      photoCount,
      locale: text(booking.locale) || null,
    });
    await getNotificationProvider().send({
      id: crypto.randomUUID(),
      channel: 'email',
      recipient: text(booking.customer_email),
      template: 'photo_gallery',
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

  return jsonOk({ url, emailed, photoCount });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
