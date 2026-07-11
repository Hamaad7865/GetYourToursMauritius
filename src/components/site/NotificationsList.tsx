'use client';

import type { Note } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * The notifications inbox list, shared by the desktop profile dropdown ("Updates" view) and the
 * mobile menu. Purely presentational — the caller owns the inbox state (read/markAllRead) so the
 * unread badge clears wherever it's opened.
 */
export function NotificationsList({ notes }: { notes: Note[] }) {
  const t = useT();
  if (notes.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-ink-muted">{t('No notifications yet')}</p>
    );
  }
  return (
    <ul className="max-h-72 overflow-auto">
      {notes.map((n) => (
        <li key={n.id} className="rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream">
          {n.message}
        </li>
      ))}
    </ul>
  );
}
