'use client';

import { useEffect, useRef, useState } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Plan a relaxed day in the south',
  'Best beaches and a waterfall up north',
  'A culture + nature day near the centre',
];

/**
 * The co-pilot chat panel. Presentational: the shell owns the message list (so it can apply the AI's
 * chosen itinerary to the map). Shows quick-start prompts when empty, auto-scrolls on new messages,
 * and disables input while a turn is in flight.
 */
export function ChatCopilot({
  messages,
  busy,
  onSend,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-card border border-ink/10 bg-white">
      <header className="flex items-center gap-2 border-b border-ink/10 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-teal text-white" aria-hidden>
          ✦
        </span>
        <div>
          <p className="font-display text-base leading-none text-ink">Your local co-pilot</p>
          <p className="text-xs text-ink-muted">Ask for a day — I plan it on the map</p>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">
              Tell me the kind of day you want and I&apos;ll build a real route — grounded in actual
              places and drive times. Try:
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="rounded-full border border-teal/30 bg-teal/5 px-3 py-2 text-left text-sm text-teal-dark transition hover:bg-teal/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <p
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-teal px-3 py-2 text-sm text-white'
                    : 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-cream px-3 py-2 text-sm text-ink'
                }
              >
                {m.content}
              </p>
            </div>
          ))
        )}
        {busy && (
          <div className="flex justify-start">
            <p className="rounded-2xl rounded-bl-sm bg-cream px-3 py-2 text-sm text-ink-muted">
              Planning your day…
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-center gap-2 border-t border-ink/10 p-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. A scenic day with lunch by the sea"
          className="min-w-0 flex-1 rounded-full border border-ink/15 px-4 py-2 text-sm text-ink outline-none focus:border-teal"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="shrink-0 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
