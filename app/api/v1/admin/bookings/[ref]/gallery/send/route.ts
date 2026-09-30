import { z } from 'zod';
import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { getServerEnv } from '@/lib/config/env';
import { isSiteUrlConfiguredForLive } from '@/lib/config/runtime';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { renderGalleryReadyEmail } from '@/lib/email/photography';
import { SITE } from '@/lib/seo/site';
import { ConfigError, ConflictError } from '@/lib/services/errors';
import {
  assertDeliverable,
  countGalleryPhotos,
  loadPhotographyBookingDelivery,
  markGalleryReady,
  requireStaffSender,
  sendPhotographyEmail,
  type PhotoDeliveryClient,
} from '@/lib/admin/photography-mail';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/admin/bookings/:ref/gallery/send — email a photography guest their private gallery
 * link (/bookings/:ref#gallery), authenticated by their account like every other booking link — no
 * token rides in the URL. The manual resend for a gallery that is already paid in full; the normal
 * delivery is gallery/complete ("Confirm gallery complete"), which also handles a balance still owed.
 *
 * Mirrors the other delivery routes' gates (shared in lib/admin/photography-mail): staff only
 * (profiles.role through the service role, never the JWT role), live site URL required, and 409s for
 * anything it should not email about — not a photography booking, not a live booking, no gallery
 * photos uploaded yet, or a balance still owed (the gallery is locked behind it, so the link would
 * open a payment teaser rather than the photos the email promises).
 *
 * Sending the link IS delivery, so it stamps bookings.gallery_ready_at — without the stamp the guest
 * would open the link to nothing (the gallery API and RLS policy hide an unconfirmed gallery). A send
 * failure is NOT a failed request: the link is simply the gallery URL, returned for the operator to
 * copy.
 */

const bodySchema = z.object({});

export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await rateLimit(req, 'admin_gallery_send', 20, 60);
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
  if (booking.balanceDueMinor > 0) {
    throw new ConflictError(
      `Booking ${ref} still owes ${booking.currency} ${(booking.balanceDueMinor / 100).toFixed(2)} — ` +
        'the guest cannot open the gallery until it is paid. Use “Confirm gallery complete” to ' +
        'email them the balance link instead.',
    );
  }

  await markGalleryReady(db, booking.id);

  const url = `${SITE.url}/bookings/${encodeURIComponent(booking.ref)}#gallery`;
  const email = renderGalleryReadyEmail({
    ref: booking.ref,
    customerName: booking.customerName,
    packageTitle: booking.packageTitle,
    photoCount,
    locale: booking.locale,
  });
  const emailed = await sendPhotographyEmail({
    recipient: booking.customerEmail,
    template: 'photo_gallery',
    email,
  });

  return jsonOk({ url, emailed, photoCount });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
