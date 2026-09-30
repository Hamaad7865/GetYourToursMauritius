import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { renderGalleryReadyEmail, renderPhotoBalanceEmail } from '@/lib/email/photography';
import { SITE } from '@/lib/seo/site';
import { ConfigError, ConflictError } from '@/lib/services/errors';
import {
  assertDeliverable,
  countGalleryPhotos,
  galleryCompletionKind,
  loadPhotographyBookingDelivery,
  markGalleryReady,
  requireStaffSender,
  sendPhotographyEmail,
  type PhotoDeliveryClient,
} from '@/lib/admin/photography-mail';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/gallery/complete — "Confirm gallery complete" in
 * /admin/photography's customer-galleries card.
 *
 * The one-press delivery flow. Stamps bookings.gallery_ready_at (20261013000000), then emails the
 * guest ONE of two things, decided purely off the live balance_due_minor (never a client-sent
 * amount): the balance-request email — identical to the photo-balance route's — when the booking
 * still owes its photography balance, or, when it is already settled in full, the gallery-ready
 * email directly, because a paid guest is only waiting for photos, not a payment page. The guest's
 * full-payment webhook (notify_balance_paid's settled branch) is the automatic counterpart for the
 * common path; this route covers everything else.
 *
 * Mirrors gallery/send's gates: staff only (profiles.role through the service role, never the
 * JWT role), live site URL required, and 409s for a non-photography booking or one with no photos
 * uploaded yet. A send failure is NOT a failed request — the link comes back with emailed:false
 * for the operator to copy, exactly like the send and photo-balance routes.
 */

const bodySchema = z.object({});

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'admin_gallery_complete', 20, 60);
  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as PhotoDeliveryClient;

  await requireStaffSender(db, user.id);

  await parseJsonBody(req, bodySchema);
  const { ref } = await params;

  if (!isSiteUrlConfiguredForLive(getServerEnv())) {
    throw new ConfigError(
      'site_url_not_configured: NEXT_PUBLIC_SITE_URL is unset or points at localhost on a ' +
        'production-like runtime; refusing to email the guest a localhost link.',
      { code: 'site_url_not_configured' },
    );
  }

  const booking = await loadPhotographyBookingDelivery(db, ref);
  assertDeliverable(booking);

  const photoCount = await countGalleryPhotos(db, booking.id);
  if (photoCount === 0) {
    throw new ConflictError(`Booking ${ref} has no gallery photos yet — upload some first.`);
  }

  // The delivery stamp comes before the email: pressing the button IS the confirmation, and a
  // flaky provider must not roll it back — the operator sees emailed:false and re-sends. The email
  // is decided off the balance the stamp itself returned, not the earlier read.
  const { balanceDueMinor } = await markGalleryReady(db, booking.id);

  let url: string;
  let emailed: boolean;
  if (galleryCompletionKind(balanceDueMinor) === 'balance') {
    url = `${SITE.url}/bookings/${encodeURIComponent(booking.ref)}#balance-payment`;
    const email = renderPhotoBalanceEmail({
      ref: booking.ref,
      customerName: booking.customerName,
      packageTitle: booking.packageTitle,
      currency: booking.currency,
      balanceDueMinor,
      locale: booking.locale,
    });
    emailed = await sendPhotographyEmail({
      recipient: booking.customerEmail,
      template: 'photo_balance',
      email,
    });
  } else {
    url = `${SITE.url}/bookings/${encodeURIComponent(booking.ref)}#gallery`;
    const email = renderGalleryReadyEmail({
      ref: booking.ref,
      customerName: booking.customerName,
      packageTitle: booking.packageTitle,
      photoCount,
      locale: booking.locale,
    });
    emailed = await sendPhotographyEmail({
      recipient: booking.customerEmail,
      template: 'photo_gallery',
      email,
    });
  }

  return jsonOk({ url, emailed, balanceDueMinor });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
