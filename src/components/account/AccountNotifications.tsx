'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useInbox } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';
import { NotificationsList } from '@/components/site/NotificationsList';
import { AccountPanel, SignedOutPrompt, AccountSpinner } from './AccountChrome';

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
    // The page title and its intro live in the account hero (AccountChrome), which owns the h1.
    <AccountPanel className="!p-3 sm:!p-4">
      {notes.length > 0 && (
        <div className="flex justify-end px-2 pb-1 pt-1">
          <button
            type="button"
            onClick={clear}
            className="text-[13px] font-bold text-teal-dark hover:text-ink"
          >
            {t('Clear all')}
          </button>
        </div>
      )}
      <NotificationsList notes={notes} />
    </AccountPanel>
  );
}
