import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { isPhotographyCategory, photographyCover } from '@/lib/catalogue/photography';
import { GALLERY_LIVE_STATUSES } from '@/lib/booking/gallery-access';
import { buildGalleryCard, type GalleryCard } from '@/lib/booking/gallery-cards';

export const runtime = 'edge';

type Row = Record<string, unknown>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  in(column: string, values: readonly string[]): Builder;
  not(column: string, operator: string, value: unknown): Builder;
  order(column: string, opts: { ascending: boolean }): Builder;
}

/** Turns a PostgREST error into a thrown one (the handler logs it and answers a generic 500). */
function check(what: string, error: unknown): void {
  if (error) {
    throw new Error(String((error as { message?: string })?.message ?? `${what} read failed`));
  }
}

/** What the first photography line of a booking tells us about its shoot. */
interface Shoot {
  title: string;
  shootDate: string | null;
  activityId: string | null;
  /** The package's own cover (`extra.photographyCover`) — null when none was set. */
  cover: string | null;
}

/**
 * GET /api/v1/account/galleries — the signed-in customer's photography galleries, one card per
 * DELIVERED shoot: open (paid in full) or locked (the balance is still owed). A shoot the studio has
 * not confirmed complete, a booking with no photos, a non-photography booking and a booking that is
 * not live never list, so a customer with nothing delivered gets `{ galleries: [] }` and the account
 * nav hides its Galleries tab.
 *
 * The reads go through the SERVICE ROLE (RLS is bypassed), so `user_id = caller` is the only thing
 * scoping them — never widen it. The photo files sit in a PUBLIC bucket, so a URL is a bearer
 * credential: only an OPEN gallery's first photo is ever handed out. A locked card shows the
 * package's public catalogue cover instead, and its photo URLs never leave this function
 * (`buildGalleryCard` applies the same `galleryAccess` rule as the gallery API and the RLS policy).
 */
export const GET = apiHandler(async (req) => {
  const user = await requireUser(req);
  const db = createServiceRoleClient() as unknown as {
    from(table: 'bookings' | 'booking_photos' | 'booking_items' | 'activity_images'): {
      select(columns: string): Builder;
    };
  };

  // Only delivered, live bookings are read at all; `galleryAccess` then sorts locked from open.
  const { data: bookings, error: bErr } = await db
    .from('bookings')
    .select('id, ref, status, balance_due_minor, gallery_ready_at')
    .eq('user_id', user.id)
    .in('status', GALLERY_LIVE_STATUSES)
    .not('gallery_ready_at', 'is', null)
    .order('created_at', { ascending: false });
  check('bookings', bErr);

  const own = bookings ?? [];
  if (own.length === 0) return jsonOk({ galleries: [] });
  const ids = own.map((b) => String(b.id));

  const [photoRes, itemRes] = await Promise.all([
    db
      .from('booking_photos')
      .select('booking_id, url, position')
      .in('booking_id', ids)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('booking_items')
      .select(
        'booking_id, session_occurrences(starts_at), activity_options(activity_id, activities(title, category, extra))',
      )
      .in('booking_id', ids)
      .order('created_at', { ascending: true }),
  ]);
  check('photos', photoRes.error);
  check('items', itemRes.error);

  const photosByBooking = new Map<string, string[]>();
  for (const r of photoRes.data ?? []) {
    const key = String(r.booking_id);
    const list = photosByBooking.get(key) ?? [];
    list.push(String(r.url ?? ''));
    photosByBooking.set(key, list);
  }

  // The first PHOTOGRAPHY line names the shoot; a booking without one (a tour with a stray photo
  // upload, say) is not a gallery.
  const shootByBooking = new Map<string, Shoot>();
  for (const r of itemRes.data ?? []) {
    const bookingId = String(r.booking_id);
    if (shootByBooking.has(bookingId)) continue;
    const option = r.activity_options as {
      activity_id?: string;
      activities?: { title?: string; category?: string; extra?: unknown } | null;
    } | null;
    const activity = option?.activities;
    if (!activity || !isPhotographyCategory(activity.category)) continue;
    const occurrence = r.session_occurrences as { starts_at?: string } | null;
    shootByBooking.set(bookingId, {
      title: activity.title ?? 'Photoshoot',
      shootDate: occurrence?.starts_at ?? null,
      activityId: option?.activity_id ?? null,
      cover: photographyCover(activity.extra),
    });
  }

  // A package with no cover of its own falls back to its first catalogue image — the same chain the
  // admin photography screen uses. Both are public site content, safe to show on a locked card.
  const needsImage = new Set<string>();
  for (const shoot of shootByBooking.values()) {
    if (!shoot.cover && shoot.activityId) needsImage.add(shoot.activityId);
  }
  const imageByActivity = new Map<string, string>();
  if (needsImage.size > 0) {
    const { data: imageRows, error: imgErr } = await db
      .from('activity_images')
      .select('activity_id, url, position')
      .in('activity_id', [...needsImage])
      .order('position', { ascending: true });
    check('covers', imgErr);
    for (const r of imageRows ?? []) {
      const activityId = String(r.activity_id);
      if (!imageByActivity.has(activityId)) imageByActivity.set(activityId, String(r.url ?? ''));
    }
  }

  const galleries: GalleryCard[] = [];
  for (const b of own) {
    const id = String(b.id);
    const urls = photosByBooking.get(id);
    if (!urls || urls.length === 0) continue; // nothing uploaded — no gallery at all
    const shoot = shootByBooking.get(id);
    if (!shoot) continue; // not a photography booking
    const catalogueImage = shoot.activityId
      ? (imageByActivity.get(shoot.activityId) ?? null)
      : null;
    const card = buildGalleryCard({
      ref: String(b.ref),
      packageTitle: shoot.title,
      shootDate: shoot.shootDate,
      photoUrls: urls,
      packageCover: shoot.cover ?? catalogueImage,
      readyAt: typeof b.gallery_ready_at === 'string' ? b.gallery_ready_at : null,
      balanceDueMinor: Number(b.balance_due_minor ?? 0),
      status: String(b.status ?? ''),
    });
    if (card) galleries.push(card);
  }

  return jsonOk({ galleries });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
