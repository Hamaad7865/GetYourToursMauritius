import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Admin data layer for the review moderation queue. Reads go straight through the browser client
 * (RLS: is_staff() full access to guest_reviews — see the migration). The moderation ACTION goes
 * through the RPC, not a direct .update(), because approving must atomically mirror into `reviews`
 * and recompute the activity's rating — see api_moderate_guest_review.
 */

/** PostgREST embeds a to-one relation as an object|array|null; normalise to a single row. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export interface GuestReviewRow {
  id: string;
  activityTitle: string;
  customerName: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
}

export async function loadGuestReviews(): Promise<GuestReviewRow[]> {
  const { data, error } = await getBrowserSupabase()
    .from('guest_reviews')
    .select('id, customer_name, rating, body, status, submitted_at, activities(title)')
    .order('submitted_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    activityTitle:
      one(
        (r as unknown as { activities: { title: string } | { title: string }[] | null }).activities,
      )?.title ?? 'Unknown activity',
    customerName: r.customer_name,
    rating: r.rating,
    body: r.body,
    status: r.status,
    submittedAt: r.submitted_at,
  }));
}

export async function moderateReview(id: string, action: 'approve' | 'reject'): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_moderate_guest_review', {
    p: { id, action },
  });
  if (error) throw error;
}

export interface GoogleReviewRow {
  authorName: string;
  authorPhotoUrl: string | null;
  rating: number;
  text: string | null;
  relativeTime: string | null;
  googleMapsUri: string | null;
}

export interface GoogleReviewsResult {
  rating: number | null;
  userRatingCount: number | null;
  reviews: GoogleReviewRow[];
}

/** Live fetch through the staff-gated API route (needs the server-only maps key). Never cached. */
export async function loadGoogleReviewsLive(placeId: string): Promise<GoogleReviewsResult> {
  const {
    data: { session },
  } = await getBrowserSupabase().auth.getSession();
  const res = await fetch(`/api/v1/reviews/google-live?placeId=${encodeURIComponent(placeId)}`, {
    headers: session ? { authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!res.ok) {
    let msg = 'Could not load Google reviews.';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) msg = body.error.message;
    } catch {
      /* non-JSON (e.g. a gateway error) — keep the generic message */
    }
    throw new Error(msg);
  }
  return (await res.json()) as GoogleReviewsResult;
}
