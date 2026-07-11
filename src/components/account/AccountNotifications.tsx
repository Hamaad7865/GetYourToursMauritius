'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useInbox } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';
import { NotificationsList } from '@/components/site/NotificationsList';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

/**
 * The full-page notifications view (the "Updates" popover's permanent home). Reads the same in-app
 * inbox the header badge uses, and marks everything read on open so the badge clears.
 */
export function AccountNotifications() {
  const t = useT();
  const { user, loading } = useAuth();
  const { notes, unread, markAllRead, clear } = useInbox();

  // Opening the page is "seeing" the notifications — clear the unread badge.
  useEffect(() => {
    if (unread > 0) markAllRead();
  }, [unread, markAllRead]);

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to see your notifications.')} />;

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-ink">{t('Notifications')}</h1>
        {notes.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-[13px] font-bold text-teal hover:text-teal-dark"
          >
            {t('Clear all')}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Updates about your cart holds and bookings.')}
      </p>
      <div className="mt-5 rounded-2xl border border-ink/10 bg-white p-2">
        <NotificationsList notes={notes} />
      </div>
    </div>
  );
}
