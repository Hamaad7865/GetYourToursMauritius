'use client';

import { useState } from 'react';

/**
 * Contact / enquiry form. Registers a sales lead via the public POST /api/v1/leads endpoint.
 * The lead schema stores name + a free-text `contact` string, so we pack the email, phone and
 * message into `contact` (capped at the schema's 200 chars).
 */
export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot — must stay empty for real users
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    const contact = [email.trim(), phone.trim(), message.trim()]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 200);
    try {
      const res = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Website enquiry', contact, source: 'web', company }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not send your message.');
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-2xl border border-teal/30 bg-teal/5 p-6 text-center">
        <p className="text-lg font-bold text-ink">Thank you — message received!</p>
        <p className="mt-1.5 text-sm text-ink-muted">
          We&apos;ll get back to you shortly. For anything urgent, WhatsApp us for the fastest reply.
        </p>
      </div>
    );
  }

  const field =
    'w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/* Honeypot: off-screen, not for humans. Bots that auto-fill every field trip it. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
        <label>
          Company (leave this empty)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold text-ink">Name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold text-ink">Email</span>
          <input
            type="email"
            className={field}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-ink">Phone / WhatsApp (optional)</span>
        <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-bold text-ink">How can we help?</span>
        <textarea
          className={field}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what you're looking for — dates, party size, activities…"
          required
        />
      </label>
      {error && <p className="text-[13px] font-medium text-coral">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="mt-1 inline-flex w-fit items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-70"
      >
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
