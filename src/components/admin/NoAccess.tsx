'use client';

import { useState } from 'react';
import { BTN_PRIMARY } from '@/components/admin/ui';

/**
 * Shown in place of an admin screen the person's role does not include — or, when their permissions
 * could not be read at all, a way to try again (a role they may well have is not the same as a role
 * they lack, and the screen should not say it is).
 */
export function NoAccess({
  loadFailed = false,
  onRetry,
}: {
  loadFailed?: boolean;
  onRetry?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (!onRetry) return;
    setBusy(true);
    try {
      await onRetry();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">
          {loadFailed ? 'We couldn’t load your permissions.' : 'No access'}
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          {loadFailed
            ? 'Check your connection and try again. If it keeps happening, let the owner know.'
            : 'Your role doesn’t include this section. Ask the owner if you need it.'}
        </p>
        {loadFailed && onRetry && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className={`${BTN_PRIMARY} mt-4`}
          >
            {busy ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
    </div>
  );
}
