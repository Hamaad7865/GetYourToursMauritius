'use client';

import { useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * "Find my booking", for a guest with no account and no email to hand. The answer is deliberately the
 * same whether or not anything matched: the page never reveals that a booking exists.
 */
export function FindBookingForm() {
  const t = useT();
  const [ref, setRef] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/bookings/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: ref.trim(), email: email.trim() }),
      });
      if (res.status === 429) {
        setError(t('Too many tries — please wait a while and try again.'));
      } else if (res.status === 400) {
        setError(t('Please check your booking reference and email address.'));
      } else if (!res.ok) {
        setError(t('Something went wrong. Please try again.'));
      } else {
        setSent(true);
      }
    } catch {
      setError(t('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="mt-6 rounded-xl bg-teal/5 p-4 text-sm leading-relaxed text-ink">
        {t(
          'If that matches a booking, we’ve emailed a link to the address on it. It can take a few minutes to arrive.',
        )}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <label className="block text-[13px] font-semibold text-ink">
        {t('Booking reference')}
        <input
          required
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          autoComplete="off"
          placeholder="BMT…"
          className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal uppercase outline-none focus:border-teal"
        />
      </label>
      <label className="block text-[13px] font-semibold text-ink">
        {t('Email address')}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
        />
      </label>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:opacity-80"
      >
        {busy ? t('Sending…') : t('Email me a link')}
      </button>
    </form>
  );
}
