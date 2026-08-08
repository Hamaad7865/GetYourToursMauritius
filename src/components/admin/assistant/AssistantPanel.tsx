'use client';

import { useEffect, useRef, useState } from 'react';
import { askAdminAssistant } from '@/lib/admin/assistant';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';
import { ActionCard } from '@/components/admin/assistant/ActionCard';
import { useAssistant } from '@/components/admin/assistant/AssistantProvider';

/**
 * The assistant panel — a COLUMN of the admin layout, not a sheet over it.
 *
 * The owner's note was exact: Gmail's Gemini does not cover the mail list, it narrows it. So this
 * renders as a flex sibling of the screen content (see AdminShell) and animates its own width;
 * nothing is ever occluded, and the page reflows around it the way a real second column does.
 * Below `lg` there is no room to split, so it becomes an overlay sheet with a scrim — the standard
 * adaptive answer, and the only place a scrim is correct here.
 *
 * The thread lives in the provider, so it survives navigating between screens: ask a question on
 * Tours, walk to Quotes, the answer is still there.
 */

/** What the assistant is doing, cycled while it works — the steps are the real ones, in order. */
const THINKING_STEPS = [
  'Reading that…',
  'Checking your catalogue…',
  'Looking at fares & bookings…',
  'Writing it up…',
];

/** The request cap is 24 messages; keep the newest turns and let the oldest fall off. */
const THREAD_CAP = 24;

/** Openers per screen — what an operator most often wants where they are standing. */
function suggestionsFor(path: string): string[] {
  if (path.startsWith('/admin/quotes')) {
    return [
      'Paste a customer enquiry here and I’ll draft the quote',
      'What departs on 20 October, and at what prices?',
      'Round-trip transfer from Belle Mare for 6 people?',
    ];
  }
  if (path.startsWith('/admin/activities')) {
    return [
      'Build a draft tour for a sunset catamaran cruise',
      'Copy the highlights from the Ile aux Cerfs catamaran to this tour',
      'Rewrite this tour’s description to be warmer and more specific',
    ];
  }
  if (path.startsWith('/admin/bookings') || path.startsWith('/admin/calendar')) {
    return [
      'What’s the status of booking BMT…?',
      'Which tours run this week?',
      'What does our rental fleet cost per day?',
    ];
  }
  return [
    'What can you help me with?',
    'What does our rental fleet cost per day?',
    'Build a draft tour for a sunset catamaran cruise',
  ];
}

const ArrowUp = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const CloseIcon = () => (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const NewChatIcon = () => (
  <svg
    width={17}
    height={17}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export function AssistantPanel() {
  const assistant = useAssistant();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const open = assistant?.open ?? false;
  const thread = assistant?.thread ?? [];
  const page = assistant?.page;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc closes — the panel is not modal on desktop, but Esc is still the expected way out.
  useEffect(() => {
    if (!open || !assistant) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') assistant.setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, assistant]);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)), 950);
    return () => clearInterval(id);
  }, [busy]);

  // Keyed on the thread LENGTH, not the array: `thread` is a fresh `[]` on every render when the
  // provider is absent, which would re-fire this on each paint.
  const threadCount = thread.length;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [threadCount, busy]);

  // A prompt handed over by an "Ask Gemini" affordance elsewhere fires once, then is cleared.
  const pending = assistant?.pendingPrompt ?? null;
  useEffect(() => {
    if (!pending || busy) return;
    assistant?.clearPendingPrompt();
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  if (!assistant) return null;

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy || !assistant) return;
    setInput('');
    const asked = [...assistant.thread, { role: 'user' as const, content: text }];
    assistant.setThread(asked);
    setBusy(true);
    try {
      const visible = asked
        .filter((m) => !m.error)
        .slice(-THREAD_CAP)
        .map(({ role, content }) => ({ role, content }));
      const result = await askAdminAssistant(visible, assistant.page);
      assistant.setThread((cur) => [
        ...cur,
        result.available && result.reply
          ? { role: 'assistant', content: result.reply, actions: result.actions }
          : {
              role: 'assistant',
              content:
                'The assistant is not configured yet — the Gemini key is missing on the server, so I cannot answer. Everything else in the back office works without me.',
              error: true,
            },
      ]);
    } catch (err) {
      assistant.setThread((cur) => [
        ...cur,
        {
          role: 'assistant',
          content: err instanceof Error ? err.message : 'The assistant did not answer — try again.',
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = suggestionsFor(page?.path ?? '/admin');

  return (
    <>
      {/* The scrim exists only where the panel must overlay (below lg) — on desktop it pushes. */}
      {open && (
        <button
          type="button"
          aria-label="Close the assistant"
          onClick={() => assistant.setOpen(false)}
          className="ai-scrim fixed inset-0 z-[60] bg-ink/40 lg:hidden"
        />
      )}

      <aside
        aria-label="Gemini assistant"
        aria-hidden={!open}
        // Below lg: a fixed sheet over the content. From lg: a real column — `w-[400px]` when open
        // and `w-0` when closed, so the main column reflows instead of being covered. The width
        // transition is what makes the content "diminish" rather than get hidden.
        // The left border belongs to the OPEN state only: a closed `lg:w-0` column that still owns
        // a 1px border draws a hairline seam down the edge of every admin screen.
        className={`fixed inset-y-0 right-0 z-[61] w-[min(400px,100vw)] shrink-0 transform-gpu overflow-hidden bg-white transition-[transform,width,opacity] duration-300 ease-out motion-reduce:transition-none lg:static lg:h-dvh lg:translate-x-0 lg:shadow-none ${
          open
            ? 'translate-x-0 border-l border-[#E7EBEE] shadow-2xl lg:w-[400px] lg:opacity-100'
            : 'pointer-events-none translate-x-full border-l-0 shadow-none lg:w-0 lg:opacity-0'
        }`}
      >
        {/* The inner column keeps its 400px while the wrapper animates to 0, so the contents slide
            out cleanly instead of reflowing into a 0px sliver mid-transition. */}
        <div className="flex h-dvh w-[min(400px,100vw)] flex-col lg:sticky lg:top-0">
          <header className="flex items-center gap-2.5 border-b border-[#E7EBEE] px-4 py-3">
            <GeminiSpark size={18} />
            <span className="text-[15px] font-bold text-ink">Gemini</span>
            {page?.screen && (
              <span className="ai-chip truncate rounded-full bg-[#EFF3FD] px-2 py-0.5 text-[10.5px] font-bold text-[#4285F4]">
                {page.screen}
              </span>
            )}
            <span className="ml-auto flex items-center gap-0.5">
              {thread.length > 0 && (
                <button
                  type="button"
                  onClick={() => assistant.setThread([])}
                  aria-label="New chat"
                  title="New chat"
                  className="grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink sm:h-9 sm:w-9"
                >
                  <NewChatIcon />
                </button>
              )}
              <button
                type="button"
                onClick={() => assistant.setOpen(false)}
                aria-label="Close Gemini"
                className="grid h-11 w-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink sm:h-9 sm:w-9"
              >
                <CloseIcon />
              </button>
            </span>
          </header>

          <div ref={scrollRef} className="slim-bar flex-1 overflow-y-auto px-4 py-4">
            {thread.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <GeminiSpark size={34} className="ai-spark-float" />
                <h2 className="ai-gradient-text text-[24px] font-semibold leading-tight">
                  How can I help?
                </h2>
                <p className="max-w-[280px] text-[13px] leading-relaxed text-ink-muted">
                  Ask about prices, departures, transfers or a booking — or tell me to build a tour,
                  rewrite one, or turn a customer’s email into a quote.
                </p>
                <div className="mt-3 flex w-full flex-col items-stretch gap-2">
                  {suggestions.map((suggestion, i) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="ai-suggestion rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-left text-[12.5px] font-semibold leading-snug text-ink/80 transition-colors hover:border-[#4285F4]/40 hover:bg-[#EFF3FD]/70"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {thread.map((message, index) => (
                  <div key={index} className="ai-msg-in flex flex-col gap-2">
                    <div
                      className={
                        message.role === 'user'
                          ? 'max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#EFF3FD] px-3.5 py-2 text-[13.5px] leading-relaxed text-ink'
                          : `max-w-full self-start whitespace-pre-wrap text-[13.5px] leading-relaxed ${
                              message.error ? 'text-coral' : 'text-ink'
                            }`
                      }
                    >
                      {message.content}
                    </div>
                    {message.actions?.map((action, i) => (
                      <ActionCard key={i} action={action} />
                    ))}
                  </div>
                ))}
                {busy && (
                  <p
                    aria-live="polite"
                    className="ai-text-sheen self-start text-[13px] font-semibold"
                  >
                    {THINKING_STEPS[step]}
                  </p>
                )}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="px-3 pb-1.5 pt-1"
          >
            <div className="flex items-end gap-2 rounded-[22px] border border-ink/15 bg-white px-4 py-1.5 transition-colors focus-within:border-[#4285F4]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter is a newline — a pasted email thread needs newlines.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask Gemini, or paste an enquiry"
                aria-label="Ask Gemini"
                disabled={busy}
                className="slim-bar max-h-32 min-h-[36px] w-full flex-1 resize-none bg-transparent py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-muted/70 disabled:opacity-60"
              />
              {/* 44×44 on touch, tightened to 32 from sm where a mouse is doing the aiming. */}
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || input.trim() === ''}
                className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-ink/70 transition-all hover:bg-ink/10 disabled:opacity-40 sm:h-8 sm:w-8"
              >
                <ArrowUp />
              </button>
            </div>
          </form>
          <p className="px-4 pb-2.5 text-center text-[10.5px] leading-snug text-ink-muted/80">
            Gemini can make mistakes, so double-check prices before they reach a guest.
          </p>
        </div>
      </aside>
    </>
  );
}
