'use client';

import type { Note, NoteType } from '@/lib/notifications/inbox';
import { useT } from '@/components/site/PreferencesProvider';
import { IconBell, IconCheck, IconClock, IconInfo } from '@/components/ui/icons';

const TYPE_META: Record<NoteType, { icon: typeof IconCheck; chip: string; iconCls: string }> = {
  secured: { icon: IconCheck, chip: 'bg-teal-tint', iconCls: 'text-teal-dark' },
  expiring: { icon: IconClock, chip: 'bg-gold-light/15', iconCls: 'text-gold' },
  expired: { icon: IconClock, chip: 'bg-coral/10', iconCls: 'text-coral' },
  unavailable: { icon: IconInfo, chip: 'bg-ink/[0.06]', iconCls: 'text-ink-muted' },
  error: { icon: IconInfo, chip: 'bg-coral/10', iconCls: 'text-coral' },
};

function relativeTime(
  t: (key: string, vars?: Record<string, string | number>) => string,
  at: number,
): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} h ago', { n: hours });
  const days = Math.round(hours / 24);
  return t('{n} d ago', { n: days });
}

/**
 * The notifications inbox list, shared by the desktop profile dropdown ("Updates" view) and the
 * mobile menu. Purely presentational — the caller owns the inbox state (read/markAllRead) so the
 * unread badge clears wherever it's opened.
 */
export function NotificationsList({ notes }: { notes: Note[] }) {
  const t = useT();
  if (notes.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-teal-tint text-teal-dark">
          <IconBell width={18} height={18} aria-hidden />
        </span>
        <p className="mt-3 text-[13px] font-semibold text-ink">{t('No notifications yet')}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {t('Holds and booking updates will show here.')}
        </p>
      </div>
    );
  }
  return (
    <ul className="max-h-80 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      {notes.map((n, i) => {
        const meta = TYPE_META[n.type] ?? TYPE_META.unavailable;
        const Icon = meta.icon;
        // Messages arrive as "Subject — what happened"; the subject earns the bold, the rest the detail.
        const dash = n.message.indexOf(' — ');
        const head = dash > 0 ? n.message.slice(0, dash) : null;
        const body = dash > 0 ? n.message.slice(dash + 3) : n.message;
        return (
          <li
            key={n.id}
            className={`flex items-start gap-3 px-3 py-3 transition hover:bg-teal-tint/50 ${
              i > 0 ? 'border-t border-ink/5' : ''
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${meta.chip}`}
            >
              <Icon width={14} height={14} className={meta.iconCls} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-ink">
                {head && <b className="font-bold">{head} — </b>}
                <span className={head ? 'text-ink-muted' : ''}>{body}</span>
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-ink-muted/80">
                {relativeTime(t, n.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
