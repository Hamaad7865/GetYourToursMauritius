'use client';

import { useEffect, useState } from 'react';
import {
  loadGuestReviews,
  moderateReview,
  loadGoogleReviewsLive,
  type GuestReviewRow,
  type GoogleReviewsResult,
} from '@/lib/admin/reviews';
import { IconStar } from '@/components/ui/icons';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar
          key={i}
          width={14}
          height={14}
          className={i <= n ? 'text-gold-light' : 'text-ink/15'}
        />
      ))}
    </span>
  );
}

const STATUS_STYLE: Record<GuestReviewRow['status'], string> = {
  pending: 'bg-gold-light/20 text-gold',
  approved: 'bg-teal/10 text-teal-dark',
  rejected: 'bg-coral/10 text-coral',
};

/** The business's own Google place_id — the geo CID in SITE.profiles.google resolves to the same
 *  listing but Places API needs the place_id form. Set once the owner's place_id is known. */
const BUSINESS_PLACE_ID = 'REPLACE_WITH_PLACE_ID';

export function AdminReviews() {
  const [reviews, setReviews] = useState<GuestReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GuestReviewRow['status'] | 'all'>('pending');
  const [busy, setBusy] = useState<string | null>(null);

  const [google, setGoogle] = useState<GoogleReviewsResult | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await loadGuestReviews();
        if (active) setReviews(rows);
      } catch (err) {
        if (active) setError(errMessage(err, 'Could not load reviews.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const result = await loadGoogleReviewsLive(BUSINESS_PLACE_ID);
        if (active) setGoogle(result);
      } catch (err) {
        if (active) setGoogleError(errMessage(err, 'Could not load Google reviews.'));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function decide(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      await moderateReview(id, action);
      setReviews((rows) =>
        rows.map((r) =>
          r.id === id ? { ...r, status: action === 'approve' ? 'approved' : 'rejected' } : r,
        ),
      );
    } catch (err) {
      setError(errMessage(err, 'Could not update this review.'));
    } finally {
      setBusy(null);
    }
  }

  const shown = filter === 'all' ? reviews : reviews.filter((r) => r.status === filter);
  const pendingCount = reviews.filter((r) => r.status === 'pending').length;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Reviews</h1>
        {pendingCount > 0 && (
          <span className="rounded-full bg-gold-light/20 px-2.5 py-1 text-[12px] font-bold text-gold">
            {pendingCount} pending
          </span>
        )}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold text-ink">Your queue</h2>
        <div className="mb-4 flex gap-2">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${
                filter === f ? 'bg-teal text-white' : 'bg-ink/5 text-ink-muted hover:bg-ink/10'
              }`}
            >
              {f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {error && <p className="mb-3 text-sm text-coral">{error}</p>}
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing here yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((r) => (
              <article key={r.id} className="rounded-xl border border-ink/10 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Stars n={r.rating} />
                    <span className="text-sm font-bold text-ink">{r.customerName}</span>
                    <span className="text-xs text-ink-muted">· {r.activityTitle}</span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink/80">{r.body}</p>
                {r.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy === r.id}
                      onClick={() => decide(r.id, 'approve')}
                      className="rounded-full bg-teal px-4 py-1.5 text-[12.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busy === r.id}
                      onClick={() => decide(r.id, 'reject')}
                      className="rounded-full bg-ink/5 px-4 py-1.5 text-[12.5px] font-bold text-ink-muted hover:bg-ink/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold text-ink">Google reviews (live)</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Fetched fresh from Google each time you open this page — not stored.
        </p>
        {googleError && <p className="text-sm text-coral">{googleError}</p>}
        {!google && !googleError && <p className="text-sm text-ink-muted">Loading…</p>}
        {google && (
          <>
            <p className="mb-3 text-sm text-ink/80">
              {google.rating ?? '—'} average · {google.userRatingCount ?? 0} total reviews on Google
            </p>
            <div className="flex flex-col gap-3">
              {google.reviews.map((r, i) => (
                <article key={i} className="rounded-xl border border-ink/10 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{r.authorName}</span>
                    <Stars n={r.rating} />
                  </div>
                  {r.text && <p className="mt-2 text-sm text-ink/80">{r.text}</p>}
                  <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                    <span>{r.relativeTime}</span>
                    {r.googleMapsUri && (
                      <a
                        href={r.googleMapsUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal hover:underline"
                      >
                        View on Google
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
