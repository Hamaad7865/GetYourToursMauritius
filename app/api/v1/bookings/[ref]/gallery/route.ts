import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { buildServiceContext } from '@/lib/http/context';
import { getBookingStatus } from '@/lib/services/bookings';
import { createServiceRoleClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

type Row = Record<string, unknown>;
interface Builder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): Builder;
  order(column: string, opts: { ascending: boolean }): Builder;
}

/**
 * GET /api/v1/bookings/:ref/gallery — the booking's private online gallery.
 *
 * Ownership FIRST, exactly like the invoice route: an RLS-gated read of the booking (as the
 * caller) throws not_found unless they own it (or are staff). Only THEN do we read booking_photos
 * through the service role, scoped to that already-owned booking id — no privilege escalation.
 * An empty gallery is `{ photos: [] }`, not a 404: the section simply doesn't render yet.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { ref } = await params;

  const booking = await getBookingStatus(buildServiceContext(req), ref);
  const db = createServiceRoleClient() as unknown as {
    from(table: 'booking_photos'): { select(columns: string): Builder };
  };
  const { data, error } = await db
    .from('booking_photos')
    .select('id, url, position')
    .eq('booking_id', booking.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error)
    throw new Error(String((error as { message?: string })?.message ?? 'gallery read failed'));
  return jsonOk({
    photos: (data ?? []).map((r) => ({
      id: String(r.id ?? ''),
      url: String(r.url ?? ''),
      position: Number(r.position ?? 0),
    })),
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
