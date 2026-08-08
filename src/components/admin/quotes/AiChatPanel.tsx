'use client';

import { useEffect, useRef, useState } from 'react';
import { askQuoteAssistant } from '@/lib/admin/quotes';
import type { AssistantMessage } from '@/lib/validation/quote-assistant';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';

/**
 * The chattable assistant — the Gemini side panel the owner asked for, drawn like the one in
 * Gmail: a floating full-height card that slides in from the right when the spark is pressed, a
 * gradient greeting while the thread is empty, and the "can make mistakes" line under the composer.
 *
 * The PANEL owns the conversation (the route holds no state): the visible thread is resent each
 * turn, capped to the newest turns so a long session never outgrows the request schema. It stays
 * MOUNTED once opened — closing only slides it away — so the thread survives close/reopen while
 * the operator works the screen; it is non-modal (no backdrop) for the same reason Gmail's is:
 * chat and quote are used together.
 *
 * Nothing here writes: the server tools are read-only, and every figure in a reply came from them
 * (see quote-assistant.ts). The disclaimer under the composer is the honest contract, verbatim in
 * spirit from the screenshot this panel copies.
 */

const THINKING_STEPS = [
  'Reading that…',
  'Checking your catalogue…',
  'Looking at fares & bookings…',
  'Writing a reply…',
];

/** The request cap is 24 messages; keep the newest turns and let the oldest fall off. */
const THREAD_CAP = 24;

const SUGGESTIONS = [
  'What departs on 20 October, and at what prices?',
  'Round-trip transfer from Belle Mare for 6 people?',
  'What does our rental fleet cost per day?',
];

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

interface ChatBubble extends AssistantMessage {
  /** A failed turn renders as the assistant apologising in the error tone, not as a toast. */
  error?: boolean;
}

export function AiChatPanel({
  open,
  onClose,
  quoteContext,
}: {
  open: boolean;
  onClose: () => void;
  /** A summary of the quote on screen, composed by the editor; null from the list. */
  quoteContext: string | null;
}) {
  const [thread, setThread] = useState<ChatBubble[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc closes, like every drawer on the screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Cycle the "thinking" line while a turn runs, holding on the last step if it runs long.
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)), 950);
    return () => clearInterval(id);
  }, [busy]);

  // Keep the newest exchange in view as bubbles and the thinking line arrive.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread, busy]);

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    const asked: ChatBubble[] = [...thread, { role: 'user', content: text }];
    setThread(asked);
    setBusy(true);
    try {
      const visible = asked
        .filter((m) => !m.error)
        .slice(-THREAD_CAP)
        .map(({ role, content }) => ({ role, content }));
      const result = await askQuoteAssistant(visible, quoteContext);
      setThread((cur) => [
        ...cur,
        result.available && result.reply
          ? { role: 'assistant', content: result.reply }
          : {
              role: 'assistant',
              content:
                'The assistant is not configured yet — the Gemini key is missing on the server, so I cannot answer. Everything else on this screen works without me.',
              error: true,
            },
      ]);
    } catch (err) {
      setThread((cur) => [
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

  return (
    <section
      aria-label="Gemini assistant"
      aria-hidden={!open}
      // The slide-in is a CSS ANIMATION keyed on the open class, not a JS-flipped transition: an
      // effect + requestAnimationFrame flip never fires while a tab is not compositing, which left
      // the panel mounted, "open", and still parked off-screen. The class replays the animation on
      // every open; the transition below still eases the slide-away on close.
      className={`fixed bottom-3 right-3 top-3 z-[70] flex w-[min(400px,calc(100vw-24px))] transform flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-2xl transition-all duration-300 ease-out motion-reduce:transition-none ${
        open
          ? 'translate-x-0 opacity-100 motion-safe:animate-[aiPanelIn_0.35s_ease-out]'
          : 'pointer-events-none translate-x-[calc(100%+12px)] opacity-0'
      }`}
    >
      <header className="flex items-center gap-2.5 border-b border-ink/[0.06] px-4 py-3">
        <GeminiSpark size={18} />
        <span className="text-[15px] font-bold text-ink">Gemini</span>
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted/70">
          Belle Mare Tours
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Gemini"
          className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {thread.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <GeminiSpark size={34} />
            <h2 className="ai-gradient-text text-[24px] font-semibold leading-tight">
              Ask about your tours
            </h2>
            <p className="max-w-[260px] text-[13px] leading-relaxed text-ink-muted">
              Prices, departures, transfer fares, bookings and quotes — answered from your own
              catalogue, never made up.
            </p>
            <div className="mt-3 flex flex-col items-stretch gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-ink/10 bg-[#EFF3FD]/60 px-4 py-2 text-[12.5px] font-semibold text-ink/80 transition-colors hover:border-[#4285F4]/40 hover:bg-[#EFF3FD]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {thread.map((message, index) => (
              <div
                key={index}
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
            ))}
            {busy && (
              <p aria-live="polite" className="ai-text-sheen self-start text-[13px] font-semibold">
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
        <div className="flex items-center gap-2 rounded-[22px] border border-ink/15 bg-white px-4 py-1.5 transition-colors focus-within:border-[#4285F4]">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Gemini"
            aria-label="Ask Gemini"
            disabled={busy}
            className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-muted/70 disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={busy || input.trim() === ''}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-ink/70 transition-colors hover:bg-ink/10 disabled:opacity-40"
          >
            <ArrowUp />
          </button>
        </div>
      </form>
      <p className="px-4 pb-2.5 text-center text-[10.5px] leading-snug text-ink-muted/80">
        Gemini can make mistakes, so double-check prices before they reach a guest.
      </p>
    </section>
  );
}
