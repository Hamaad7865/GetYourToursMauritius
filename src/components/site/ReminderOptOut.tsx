'use client';

import { useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { parseApiJson } from '@/lib/http/fetch-json';

/**
 * The "stop these" confirmation for checkout-recovery emails. A button, not an automatic call on page
 * load: mail scanners pre-fetch links, and an opt-out that fired on GET would quietly unsubscribe
 * people who never clicked.
 */
export function ReminderOptOut({ token }: { token: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid' | 'error'>('idle');

  async function stop() {
    setState('busy');
    try {
      const res = await fetch('/api/v1/checkout-reminders/opt-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then((r) => parseApiJson<{ stopped?: boolean }>(r));
      if (!res.ok) setState('error');
      else setState(res.data?.stopped ? 'done' : 'invalid');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className="text-sm font-medium text-ink">
        {t('Done — we won’t send you booking reminders like this again.')}
      </p>
    );
  }
  if (state === 'invalid') {
    return (
      <p role="alert" className="text-sm text-ink/70">
        {t(
          'This link is no longer valid. If you keep getting these emails, reply to one and we’ll stop them.',
        )}
      </p>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={stop}
        disabled={state === 'busy'}
        className="rounded-full bg-teal-dark px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:opacity-80"
      >
        {t('Stop booking reminders')}
      </button>
      {state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-coral-dark">
          {t('Something went wrong. Please try again in a moment.')}
        </p>
      )}
    </div>
  );
}
