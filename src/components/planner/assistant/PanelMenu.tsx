'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  relativeSavedAt,
  savedChatKind,
  savedStopCount,
  type SavedChat,
  type SavedChatKind,
} from '@/lib/planner/chat-history';
import { useT } from '@/components/site/PreferencesProvider';
import { IconChat, IconPlus, IconX } from '@/components/ui/icons';
import { Thumb } from '../Thumb';
import { IconList, IconTrash } from './icons';

export type MenuSection = 'recents' | 'trips';

const FILTERS: Array<{ id: 'all' | SavedChatKind; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'comparison', label: 'Comparison' },
];

/**
 * The assistant's menu: start again, come back to the current chat, or reopen an earlier one.
 *
 * "My trips" and "Recents" are the same shelf — conversations saved in this visitor's own browser
 * (there is no account behind the planner) — seen two ways: trips are the ones that produced a plan.
 */
export function PanelMenu({
  section,
  chats,
  currentId,
  onSection,
  onNewChat,
  onResume,
  onDelete,
  onClose,
}: {
  section: MenuSection;
  chats: SavedChat[];
  currentId: string;
  onSection: (section: MenuSection) => void;
  onNewChat: () => void;
  onResume: (chat: SavedChat) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<'all' | SavedChatKind>('all');
  // One clock reading per open, so every row's "2h ago" is measured against the same moment.
  const [now] = useState(() => Date.now());
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Handled here, so the dock does not also close the whole assistant.
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const rows = useMemo(() => {
    const withKind = chats.map((chat) => ({ chat, kind: savedChatKind(chat.snapshot) }));
    if (section === 'trips') return withKind.filter((r) => r.kind !== 'chat');
    return filter === 'all' ? withKind : withKind.filter((r) => r.kind === filter);
  }, [chats, section, filter]);

  const navRow = (active: boolean) =>
    `flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold transition-colors ${
      active ? 'bg-ink/[0.06] text-ink' : 'text-ink hover:bg-ink/[0.04]'
    }`;

  return (
    // Above the dates block (z-30) and the dates strip (z-20): the menu covers the whole panel.
    <div className="absolute inset-0 z-40">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('Close menu')}
        onClick={onClose}
        className="zilai-fade absolute inset-0 cursor-default bg-ink/25"
      />
      <div
        role="dialog"
        aria-label={t('ZilAi menu')}
        className="zilai-drawer absolute inset-y-0 left-0 flex w-[min(340px,88%)] flex-col bg-white shadow-[24px_0_50px_-28px_rgba(10,46,54,0.55)]"
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <span className="text-[17px] font-extrabold text-ink">ZilAi</span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('Close menu')}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
          >
            <IconX width={18} height={18} />
          </button>
        </div>

        <div className="flex flex-col gap-0.5 px-2">
          <button type="button" onClick={onNewChat} className={navRow(false)}>
            <IconPlus width={18} height={18} />
            {t('New chat')}
          </button>
          <button type="button" onClick={onClose} className={navRow(section === 'recents')}>
            <IconChat width={18} height={18} />
            {t('Chat')}
          </button>
          <button
            type="button"
            onClick={() => onSection(section === 'trips' ? 'recents' : 'trips')}
            aria-pressed={section === 'trips'}
            className={navRow(section === 'trips')}
          >
            <IconList width={18} height={18} />
            {t('My trips')}
          </button>
        </div>

        <div className="mt-4 px-4">
          <h3 className="m-0 text-[15px] font-extrabold text-ink">
            {section === 'trips' ? t('My trips') : t('Recents')}
          </h3>
          {section === 'recents' && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors ${
                    filter === f.id
                      ? 'border-ink bg-white text-ink shadow-[inset_0_0_0_1px_rgb(var(--color-ink))]'
                      : 'border-ink/20 text-ink hover:border-ink/40'
                  }`}
                >
                  {t(f.label)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="zilai-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {rows.length === 0 ? (
            <p className="m-0 px-2 py-6 text-[14px] leading-relaxed text-ink-muted">
              {section === 'trips'
                ? t(
                    'Plans you build with ZilAi are kept here, on this device, so you can come back to them.',
                  )
                : chats.length === 0
                  ? t('Your chats with ZilAi are kept here, on this device. Nothing yet.')
                  : t('Nothing saved matches that filter.')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {rows.map(({ chat, kind }) => {
                const s = chat.snapshot;
                const lead = s.places.find(
                  (p) =>
                    p.id === (s.days?.find((d) => d.stopIds.length)?.stopIds[0] ?? s.stopIds[0]),
                );
                const stopCount = savedStopCount(s);
                return (
                  <li
                    key={chat.id}
                    className="group relative border-b border-ink/[0.08] last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => onResume(chat)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 pr-11 text-left transition-colors hover:bg-ink/[0.04]"
                    >
                      {lead ? (
                        <Thumb place={lead} size={34} />
                      ) : (
                        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-teal-tint text-teal-dark">
                          <IconChat width={16} height={16} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">
                          {chat.title}
                        </span>
                        <span className="block truncate text-[12.5px] text-ink-muted">
                          {chat.id === currentId
                            ? t('This chat')
                            : relativeSavedAt(chat.savedAt, now)}
                          {kind !== 'chat' &&
                            ` · ${
                              s.days?.length
                                ? t('{n} days', { n: s.days.length })
                                : t('{n} stops', { n: stopCount })
                            }`}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(chat.id)}
                      aria-label={t('Delete “{title}”', { title: chat.title })}
                      className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-ink-muted opacity-0 transition hover:bg-coral/10 hover:text-coral-dark focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      <IconTrash width={16} height={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
