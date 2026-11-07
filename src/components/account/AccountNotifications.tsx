'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useInbox } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';
import { UpdatesInbox } from '@/components/site/NotificationsList';
import { AccountPanel, SignedOutPrompt, AccountSpinner } from './AccountChrome';

/**
 * The full-page notifications view (the "Updates" popover's permanent home). Reads the same in-app
 * inbox the header badge uses; the inbox marks everything read once shown, so the badge clears.
 */
export function AccountNotifications() {
  const t = useT();
  const { user, loading } = useAuth();
  const { notes, unread, markAllRead, clear } = useInbox();

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to see your notifications.')} />;

  return (
    // The page title and its intro live in the account hero (AccountChrome), which owns the h1.
    <AccountPanel className="!p-3 sm:!p-5">
      <UpdatesInbox
        notes={notes}
        unread={unread}
        markAllRead={markAllRead}
        onClear={clear}
        showTitle={false}
        variant="page"
      />
    </AccountPanel>
  );
}
