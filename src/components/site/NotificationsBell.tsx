'use client';
import { useState } from 'react';
import { useInbox } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';

export function NotificationsBell() {
  const { notes, unread, markAllRead } = useInbox();
  const t = useT();
  const [open, setOpen] = useState(false);
  const toggle = () => { setOpen((o) => { if (!o) markAllRead(); return !o; }); };
  return (
    <div className="relative">
      <button type="button" onClick={toggle} aria-label={t('Notifications')} className="relative grid place-items-center">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-2 -top-1.5 grid h-4 min-w-[1rem] place-items-center rounded-full bg-coral px-1 text-[10px] font-extrabold leading-none text-ink">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-ink/10 bg-white p-2 shadow-xl">
          {notes.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">{t('No notifications yet')}</p>
          ) : (
            <ul className="max-h-96 overflow-auto">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg px-3 py-2 text-sm text-ink hover:bg-cream">{n.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
