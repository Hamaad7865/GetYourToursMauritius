'use client';

import { relativeSavedAt, type SavedChat } from '@/lib/planner/chat-history';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * The visitor's saved conversations, as a sheet over the chat column.
 *
 * Everything here came out of their own browser (see `chat-history.ts`), so there is no loading state
 * and no failure state — an empty shelf is just an empty list.
 */
export function ChatHistory({
  open,
  chats,
  currentId,
  now,
  onResume,
  onDelete,
  onClose,
}: {
  open: boolean;
  chats: SavedChat[];
  /** The session on screen — labelled, and resumed as a no-op rather than offered as "old". */
  currentId: string;
  /** Epoch ms for the relative labels. Passed in so this component never reads the clock itself. */
  now: number;
  onResume: (chat: SavedChat) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  if (!open) return null;
  const older = chats.filter((c) => c.id !== currentId);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-white/97 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 border-b border-[#EEF4F3] px-4 py-[13px]">
        <span className="font-display text-[15px] font-semibold text-ink">
          {t('Your saved chats')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="ml-auto cursor-pointer rounded-[9px] border border-[#EEF4F3] bg-white p-1.5 text-ink-muted hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {older.length === 0 ? (
          <p className="m-auto max-w-[260px] py-10 text-center text-[13px] leading-[1.5] text-ink-muted">
            {t(
              'Nothing saved yet. Your plans are kept on this device as you chat, so you can pick one back up here.',
            )}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {older.map((chat) => {
              const stops = chat.snapshot.days
                ? chat.snapshot.days.reduce((n, d) => n + d.stopIds.length, 0)
                : chat.snapshot.stopIds.length;
              return (
                <li
                  key={chat.id}
                  className="flex items-start gap-2 rounded-[13px] border border-[#EAF2F1] bg-white p-2.5 shadow-[0_4px_14px_rgba(10,46,54,.05)]"
                >
                  <button
                    type="button"
                    onClick={() => onResume(chat)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <div className="truncate text-[13.5px] font-bold text-ink">{chat.title}</div>
                    <div className="mt-0.5 text-[11.5px] font-semibold text-ink-muted">
                      {relativeSavedAt(chat.savedAt, now)}
                      {chat.snapshot.days?.length
                        ? ` · ${t('{n}-day trip', { n: chat.snapshot.days.length })}`
                        : ''}
                      {stops ? ` · ${t('{n} stops', { n: stops })}` : ''}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(chat.id)}
                    aria-label={t('Delete {title}', { title: chat.title })}
                    className="shrink-0 cursor-pointer rounded-lg p-1.5 text-ink-muted hover:text-coral"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M5 7h14M10 7V5h4v2m-7 0 .8 12a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1L17 7"
                        stroke="currentColor"
                        strokeWidth={1.7}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
