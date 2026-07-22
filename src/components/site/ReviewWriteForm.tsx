'use client';

import { useState } from 'react';
import { IconStar } from '@/components/ui/icons';

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  return fallback;
}

export function ReviewWriteForm({
  token,
  activityTitle,
  googleReviewUrl,
}: {
  token: string;
  activityTitle: string;
  googleReviewUrl: string;
}) {
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      setError('Pick a star rating.');
      return;
    }
    if (body.trim().length < 5) {
      setError('A few words about your trip helps other travellers.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/reviews/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, rating, name, body }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? 'Could not submit your review.');
      }
      setDone(true);
    } catch (err) {
      setError(errMessage(err, 'Could not submit your review — please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center">
        <h2 className="text-xl font-extrabold text-ink">Thank you!</h2>
        <p className="mt-2 text-sm text-ink/70">
          Your review has been sent to our team. Enjoyed the experience? We&apos;d love a Google
          review too — it takes a minute and really helps.
        </p>
        <a
          href={googleReviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          Review us on Google
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink/10 bg-white p-6">
      <h1 className="text-xl font-extrabold text-ink">Reviewing: {activityTitle}</h1>
      <div className="mt-4 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} out of 5 stars`}
            className="p-0.5"
          >
            <IconStar
              width={28}
              height={28}
              className={n <= rating ? 'text-gold-light' : 'text-ink/15'}
            />
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm font-bold text-ink" htmlFor="review-name">
        Your name
      </label>
      <input
        id="review-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      <label className="mt-4 block text-sm font-bold text-ink" htmlFor="review-body">
        Your review
      </label>
      <textarea
        id="review-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        minLength={5}
        maxLength={2000}
        rows={5}
        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-5 rounded-full bg-teal px-6 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit review'}
      </button>
    </form>
  );
}
