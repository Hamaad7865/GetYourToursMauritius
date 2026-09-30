import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getBookingStatus } from '@/lib/services/bookings';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { buildGalleryResponse, galleryAccess } from '@/lib/booking/gallery-access';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

type Row = Record<string, unknown>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  order(column: string, opts: { ascending: boolean }): Builder;
  limit(n: number): Builder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

/**
 * GET /api/v1/bookings/:ref/gallery — the booking's private online gallery.
 *
 * Ownership FIRST, exactly like the invoice route: an RLS-gated read of the booking (as the
 * caller) throws not_found unless they own it (or are staff). Only THEN do we read booking_photos
 * through the service role, scoped to that already-owned booking id — no privilege escalation.
 * An empty gallery is `{ photos: [] }`, not a 404: the section simply doesn't render yet.
 *
 * WHO SEES WHAT is decided by `galleryAccess` (the twin of the booking_photos_select RLS policy):
 *   hidden  the studio has not confirmed the gallery complete (bookings.gallery_ready_at), or the
 *           booking is not live — `photos: []` and zero counts, so an unfinished upload leaks nothing;
 *   locked  delivered but the photography balance is unpaid — `photos: []` (the files sit in a PUBLIC
 *           bucket, so a URL handed to the browser is a bearer credential: the lock MUST live here,
 *           not in the UI) with `locked: true`, `balanceDueMinor` and truthful `meta.photoCount`
 *           so the page can draw the "pay the balance" teaser;
 *   open    delivered and paid in full — the photos, oldest first.
 * `meta` also carries the package title, shoot date and pickup location off the first booking item,
 * plus photo/video counts (videos detected by URL extension, the same isVideoUrl signal the
 * renderer uses).
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;

  const booking = await getBookingStatus(buildServiceContext(req), ref);
  const db = createServiceRoleClient() as unknown as {
    from(table: 'booking_photos' | 'booking_items' | 'bookings'): {
      select(columns: string): Builder;
    };
  };

  const [{ data, error }, { data: itemRows, error: itemError }, { data: bookingRow, error: bErr }] =
    await Promise.all([
      db
        .from('booking_photos')
        .select('id, url, position')
        .eq('booking_id', booking.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      db
        .from('booking_items')
        .select('activity_options(activities(title)), session_occurrences(starts_at)')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: true })
        .limit(1),
      db
        .from('bookings')
        .select('balance_due_minor, gallery_ready_at')
        .eq('id', booking.id)
        .maybeSingle(),
    ]);
  if (error)
    throw new Error(String((error as { message?: string })?.message ?? 'gallery read failed'));
  if (itemError)
    throw new Error(
      String((itemError as { message?: string })?.message ?? 'booking items read failed'),
    );
  if (bErr)
    throw new Error(String((bErr as { message?: string })?.message ?? 'booking read failed'));

  const photos = (data ?? []).map((r) => ({
    id: String(r.id ?? ''),
    url: String(r.url ?? ''),
    position: Number(r.position ?? 0),
  }));
  const balanceDueMinor = Number(bookingRow?.balance_due_minor ?? 0);
  const firstItem = (itemRows ?? [])[0];
  const activity = (firstItem?.activity_options as { activities?: { title?: string } } | null)
    ?.activities;
  const occurrence = firstItem?.session_occurrences as { starts_at?: string } | null;

  return jsonOk(
    buildGalleryResponse({
      access: galleryAccess({
        readyAt:
          typeof bookingRow?.gallery_ready_at === 'string' ? bookingRow.gallery_ready_at : null,
        balanceDueMinor,
        status: booking.status,
      }),
      photos,
      balanceDueMinor,
      packageTitle: activity?.title ?? null,
      shootDate: occurrence?.starts_at ?? null,
      location: booking.pickupLocation ?? null,
    }),
  );
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
