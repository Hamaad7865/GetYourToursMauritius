'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import { askAdminAssistant } from '@/lib/admin/assistant';
import { mauDay } from '@/lib/admin/format';
import { ActionCard } from '@/components/admin/assistant/ActionCard';
import { AiOrb, OrbAvatar } from '@/components/admin/assistant/AiOrb';
import { BalancesCard, DeparturesCard } from '@/components/admin/assistant/BalancesCard';
import {
  useAssistant,
  conversationTitle,
  type AssistantThreadItem,
} from '@/components/admin/assistant/AssistantProvider';
import {
  useAssistantData,
  useAssistantViewer,
} from '@/components/admin/assistant/useAssistantData';
import {
  balancesAnswer,
  departuresAnswer,
  greeting,
  homeSuggestions,
  openTargetFor,
  plural,
  seeingLabel,
  shortDay,
  type Suggestion,
  type SuggestionIcon,
} from '@/components/admin/assistant/rules';
import {
  IconChat,
  IconChevron,
  IconClock,
  IconMail,
  IconPin,
  IconPlus,
  IconWallet,
  IconX,
} from '@/components/ui/icons';

/**
 * Belle Mare AI — the side chat. A COLUMN of the admin layout, not a sheet over it.
 *
 * The owner's note was exact: the chat must narrow the screen beside it, never cover it. So this
 * renders as a flex sibling of the screen content (see AdminShell) and animates its own width; the
 * page reflows around it the way a real second column does. Below `lg` there is no room to split,
 * so it becomes an overlay sheet with a scrim, the only place a scrim is right here.
 *
 * What it answers by itself and what it asks the model:
 *  - the home view's cards, "chase the balances" and "today's departures" are worked out HERE from
 *    the same reads Today makes (see rules.ts), so every name and figure is the back office's own;
 *  - everything typed goes to the model, in Ask (answers only) or Do (may also draft a quote or a
 *    tour change, each still applied by a person) mode.
 *
 * The thread lives in the provider, so it survives moving between screens. Earlier conversations of
 * the visit are kept in memory only: they can hold guests' names, so they are never stored.
 */

/** What the assistant is doing, cycled while it works. */
const THINKING_STEPS = [
  'Reading that…',
  'Checking the catalogue…',
  'Looking at fares and bookings…',
  'Writing it up…',
];

/** The request cap is 24 messages; keep the newest turns and let the oldest fall off. */
const THREAD_CAP = 24;
/** What the model is told about a card's answer, at most (a message may be 20,000). */
const CONTEXT_CAP = 6000;

const PLACEHOLDER = 'Ask anything · @ a booking · / for actions';
const HINT_ASK =
  'Belle Mare AI runs on Gemini, and Gemini can make mistakes. Check amounts before you send anything.';
const HINT_DO =
  'Do can draft quotes and tour changes. Nothing changes until you press Apply, and nothing is sent until you confirm.';

const SUGGESTION_ICON: Record<SuggestionIcon, (p: { width: number; height: number }) => ReactNode> =
  {
    wallet: IconWallet,
    clock: IconClock,
    spark: IconMail,
    pin: IconPin,
    chat: IconChat,
  };

type Command = { key: string; label: string; hint: string };

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

const HistoryIcon = () => (
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
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);

const ExpandIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {expanded ? (
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    ) : (
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    )}
  </svg>
);

const StepCheck = () => (
  <svg
    width={11}
    height={11}
    viewBox="0 0 24 24"
    fill="none"
    stroke="#3FB5AC"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

function IconButton({
  label,
  onClick,
  children,
  className = '',
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      className={`bmai-icon-btn grid h-11 w-11 shrink-0 place-items-center rounded-[10px] sm:h-10 sm:w-10 ${className}`}
    >
      {children}
    </button>
  );
}

let itemSeq = 0;
/**
 * A thread item with an id of its own: React keys stay right when History swaps one conversation for
 * another, and a card's send outcomes can be written back to the item that showed it.
 */
function withId(item: AssistantThreadItem): AssistantThreadItem {
  return item.id ? item : { ...item, id: `m${++itemSeq}` };
}

/** The `@` token being typed just before the caret, if any. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([A-Za-z0-9-]{0,24})$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() };
}

export function AssistantPanel() {
  const assistant = useAssistant();
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const params = useSearchParams();
  const { profile } = useAuth();
  const access = useAdminAccess();
  const viewer = useAssistantViewer();
  const canDo = can(access, ['section.quotes', 'section.tours']);

  const [input, setInput] = useState('');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [placeholder, setPlaceholder] = useState(PLACEHOLDER);
  // Closing a popup with Esc must not also close the panel; this hides it until the input changes.
  const [popupDismissed, setPopupDismissed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);

  const open = assistant?.open ?? false;
  const thread = assistant?.thread ?? [];
  const mode = assistant?.mode ?? 'ask';
  const sees = assistant?.seesScreen ?? true;
  const { data, loading, ensure } = useAssistantData(open, viewer);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (open) {
      setNow(new Date());
      inputRef.current?.focus({ preventScroll: true });
    } else {
      setHistoryOpen(false);
    }
  }, [open]);

  /**
   * Grow the composer to fit what is in it, up to a cap. A `rows={1}` textarea keeps ONE line's
   * height no matter what is pasted, so a pasted email thread showed as a single scrolling line.
   * Driven by the VALUE rather than by the keystroke, so it is also right when text arrives
   * programmatically and when it is cleared after sending. `height = auto` first, or scrollHeight
   * can only ever ratchet upwards.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input, open]);

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

  // The history popup closes on a click anywhere else.
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [historyOpen]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // A prompt handed over by an "Ask" affordance elsewhere fires once, then is cleared.
  const pending = assistant?.pendingPrompt ?? null;
  useEffect(() => {
    if (!pending || busy) return;
    assistant?.clearPendingPrompt();
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const suggestions = useMemo(
    () =>
      homeSuggestions(
        {
          balances: data.balances,
          quotes: data.quotes,
          departures: data.departures,
          today: data.today,
          path: pathname,
        },
        viewer,
      ),
    [data, pathname, viewer],
  );
  const live = suggestions.some((s) => s.kind !== 'prompt');

  /* ----- the `/` actions and the `@` booking picker ----------------------------------------- */

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    if (viewer.showBookings)
      out.push({ key: 'balances', label: 'Chase overdue balances', hint: '/balances' });
    if (viewer.showDepartures)
      out.push({ key: 'departures', label: 'Today’s departures', hint: '/departures' });
    if (viewer.showQuotes)
      out.push({ key: 'quote', label: 'Turn an email into a quote', hint: '/quote' });
    out.push({ key: 'new', label: 'Start a new conversation', hint: '/new' });
    return out;
  }, [viewer]);

  const slash = /^\/([a-z]*)$/i.exec(input.trim());
  const slashMatches = slash
    ? commands.filter((c) => c.key.startsWith(slash[1]!.toLowerCase()))
    : [];
  const mention = viewer.showBookings ? mentionAt(input, caret) : null;
  const mentionMatches = useMemo(() => {
    if (!mention || !data.bookings) return [];
    const q = mention.query;
    return data.bookings
      .filter(
        (b) =>
          !q || b.ref.toLowerCase().includes(q) || (b.customerName ?? '').toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [mention, data.bookings]);
  const popup: 'slash' | 'mention' | null = popupDismissed
    ? null
    : slash && slashMatches.length > 0
      ? 'slash'
      : mention
        ? 'mention'
        : null;
  const popupCount = popup === 'slash' ? slashMatches.length : mentionMatches.length;

  if (!assistant) return null;
  const a = assistant;

  /** Close, and give keyboard focus back to the launcher rather than dropping it on the page. */
  function close() {
    const inside = document.activeElement?.closest('aside[aria-label="Belle Mare AI"]');
    a.setOpen(false);
    if (inside) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-assistant-launcher]')?.focus(),
      );
    }
  }

  /* ----- sending -------------------------------------------------------------------------- */

  function push(...items: AssistantThreadItem[]) {
    a.setThread((cur) => [...cur, ...items.map(withId)]);
  }

  async function send(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    const cmd = /^\/([a-z]+)$/i.exec(text);
    if (cmd) {
      const known = commands.find((c) => c.key === cmd[1]!.toLowerCase());
      if (known) {
        setInput('');
        void run(known.key);
        return;
      }
    }
    setInput('');
    setPopupDismissed(false);
    setPlaceholder(PLACEHOLDER);
    const asked: AssistantThreadItem[] = [...a.thread, withId({ role: 'user', content: text })];
    a.setThread(asked);
    setBusy(true);
    try {
      const visible = asked
        .filter((m) => !m.error)
        .slice(-THREAD_CAP)
        .map(({ role, content, context }) => ({
          role,
          content: (context ?? content).slice(0, CONTEXT_CAP),
        }));
      const result = await askAdminAssistant(visible, sees ? a.page : null, mode);
      push(
        result.available && result.reply
          ? {
              role: 'assistant',
              content: result.reply,
              actions: result.actions,
              steps: result.steps,
            }
          : {
              role: 'assistant',
              content:
                'Belle Mare AI is not set up yet: the Gemini key is missing on the server, so I cannot answer. Everything else in the back office works without me.',
              error: true,
            },
      );
    } catch (err) {
      push({
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Belle Mare AI did not answer. Try again.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  /** The answers worked out here, from the back office's own data. */
  async function run(key: string) {
    if (busy) return;
    if (key === 'new') {
      a.newConversation();
      return;
    }
    if (key === 'quote') {
      a.setMode('do');
      setPlaceholder('Paste the guest’s email here, then send');
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    const question =
      key === 'balances'
        ? 'Chase the balances for trips that are already done'
        : 'What departs today?';
    push({ role: 'user', content: question });
    setBusy(true);
    try {
      const d = await ensure();
      if (key === 'balances') {
        if (!d.balances) {
          push({
            role: 'assistant',
            content: 'I could not read the bookings just now. Try again in a moment.',
            error: true,
          });
          return;
        }
        const ans = balancesAnswer(d.balances, d.today, viewer.showMoney);
        const shownIds = new Set(ans.rows.map((r) => r.id));
        push({
          role: 'assistant',
          content: ans.text,
          steps: ans.steps,
          context: ans.context,
          card: {
            kind: 'balances',
            rows: ans.rows,
            later: d.balances.filter((r) => !shownIds.has(r.id)),
          },
        });
      } else {
        if (!d.departures) {
          push({
            role: 'assistant',
            content: 'I could not read today’s calendar just now. Try again in a moment.',
            error: true,
          });
          return;
        }
        const ans = departuresAnswer(d.departures);
        push({
          role: 'assistant',
          content: ans.text,
          steps: ans.steps,
          context: ans.context,
          card: { kind: 'departures', rows: ans.rows },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function showLater(rows: AssistantThreadItem['card']) {
    if (!rows || rows.kind !== 'balances' || rows.later.length === 0) return;
    const later = rows.later;
    const text = `${plural(later.length, 'booking')} with a trip still to come ${later.length === 1 ? 'has' : 'have'} a balance to collect.`;
    push(
      { role: 'user', content: 'Show the balances still to come' },
      {
        role: 'assistant',
        content: text,
        steps: [`Checked ${plural(later.length, 'balance')}`],
        context: [
          text,
          ...later.map(
            (r) => `${r.name} (${r.ref}), trip ${r.tripDay ? shortDay(r.tripDay) : 'not dated'}`,
          ),
        ].join('\n'),
        card: { kind: 'balances', rows: later, later: [] },
      },
    );
  }

  /**
   * Go where a card points. What it opens (a booking, a quote, a day) is handed over through context
   * and the chat closes, so it opens even on the screen you are already on: those screens read their
   * address only on arrival. Another screen is also given the address, which it reads as it mounts.
   */
  function go(href: string) {
    const target = openTargetFor(href);
    if (target) a.requestOpen(target);
    else a.setOpen(false);
    const [path] = href.split('?');
    if (path !== pathname) router.push(href);
  }

  function choose(s: Suggestion) {
    if (s.kind === 'open') go(s.href);
    else if (s.kind === 'prompt') void send(s.prompt);
    else void run(s.kind === 'email' ? 'quote' : s.kind);
  }

  function pickMention(ref: string) {
    if (!mention) return;
    const next = `${input.slice(0, mention.start)}${ref} ${input.slice(caret)}`;
    setInput(next);
    const at = mention.start + ref.length + 1;
    setCaret(at);
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.setSelectionRange(at, at);
    });
  }

  function choosePopup(i: number) {
    if (popup === 'slash') {
      const c = slashMatches[i];
      if (c) {
        setInput('');
        void run(c.key);
      }
    } else if (popup === 'mention') {
      const b = mentionMatches[i];
      if (b) pickMention(b.ref);
    }
  }

  function insertAt() {
    const el = inputRef.current;
    const at = el?.selectionStart ?? input.length;
    const before = input.slice(0, at);
    const glue = before && !/\s$/.test(before) ? ' @' : '@';
    const next = `${before}${glue}${input.slice(at)}`;
    setInput(next);
    setPopupDismissed(false);
    const pos = at + glue.length;
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(pos, pos);
    });
  }

  /* ----- pointer: glow and orb, on CSS variables (no re-render) ----------------------------- */

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return;
    const body = bodyRef.current;
    if (!body) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = body.getBoundingClientRect();
      body.style.setProperty('--mx', `${Math.round(clientX - box.left)}px`);
      body.style.setProperty('--my', `${Math.round(clientY - box.top)}px`);
      body.dataset.pointer = 'on';
      const orb = orbRef.current?.getBoundingClientRect();
      if (orb && orb.width > 0) {
        const dx = clientX - (orb.left + orb.width / 2);
        const dy = clientY - (orb.top + orb.height / 2);
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        body.style.setProperty('--nx', clamp(dx / 200).toFixed(3));
        body.style.setProperty('--ny', clamp(dy / 200).toFixed(3));
        body.style.setProperty('--near', Math.max(0, 1 - Math.hypot(dx, dy) / 160).toFixed(3));
      }
    });
  }

  function onPointerLeave() {
    const body = bodyRef.current;
    if (!body) return;
    cancelAnimationFrame(frame.current);
    body.dataset.pointer = 'off';
    body.style.setProperty('--nx', '0');
    body.style.setProperty('--ny', '0');
    body.style.setProperty('--near', '0');
  }

  /* ----- keyboard --------------------------------------------------------------------------- */

  // Esc, while focus is in the panel: a popup closes first, then the panel.
  function onPanelKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return;
    if (historyOpen) {
      setHistoryOpen(false);
      e.stopPropagation();
      return;
    }
    if (popup) {
      setPopupDismissed(true);
      e.stopPropagation();
      return;
    }
    // Stopped here so a screen's own Esc (the calendar's docked day sheet) does not close too.
    e.stopPropagation();
    close();
  }

  function onInputKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (popup && popupCount > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : popupCount - 1)) % popupCount);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choosePopup(Math.min(pick, popupCount - 1));
        return;
      }
    }
    // Enter sends; Shift+Enter is a newline — a pasted email thread needs newlines.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  /* ----- render ------------------------------------------------------------------------------ */

  const firstName = profile?.fullName?.trim() || null;
  const title = thread.length > 0 ? conversationTitle(thread) : 'New conversation';
  const width = expanded ? 'lg:w-[400px] xl:w-[520px] 2xl:w-[640px]' : 'lg:w-[400px] xl:w-[440px]';
  const label = seeingLabel(a.page.screen, pathname, params);
  const activeId =
    popup && popupCount > 0 ? `bmai-opt-${Math.min(pick, popupCount - 1)}` : undefined;

  return (
    <>
      {/* The scrim exists only where the panel must overlay (below lg) — on desktop it pushes. */}
      {open && (
        <button
          type="button"
          aria-label="Close Belle Mare AI"
          onClick={() => close()}
          className="ai-scrim fixed inset-0 z-[60] bg-ink/40 lg:hidden"
        />
      )}

      <aside
        aria-label="Belle Mare AI"
        aria-hidden={!open}
        // A closed panel is out of the tab order and the accessibility tree, not just out of sight.
        inert={!open}
        onKeyDown={onPanelKeyDown}
        // Below lg: a fixed sheet over the content. From lg: a real column — `lg:w-[400px]` (440 from
        // xl, wider still when expanded) when open and `lg:w-0` when closed, so the main column
        // reflows instead of being covered (Widen takes it to 520, 640 on the widest screens, so the
        // screen beside it keeps ~690px at 1440). The column owns no border or background: the dark card
        // inside it floats on the page ground, so a closed `lg:w-0` column leaves no seam.
        // `lg:sticky lg:top-0` — NOT `lg:static`. A static column is exactly one viewport tall and
        // scrolls away with the page, leaving white space beside a long form. Sticky is still
        // in-flow, so it keeps its width and keeps pushing the content, but stays pinned.
        // `lg:z-auto`: as a column it overlaps nothing, and a screen's modal (the booking and quote
        // panels, the pickers, the calendar's day sheet) must cover it rather than open beneath it.
        className={`bmai-panel fixed inset-y-0 right-0 z-[61] w-[min(440px,100vw)] shrink-0 transform-gpu overflow-clip transition-[transform,width,opacity] duration-300 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:translate-x-0 ${
          open
            ? `translate-x-0 lg:opacity-100 ${width}`
            : 'pointer-events-none translate-x-full lg:w-0 lg:opacity-0'
        }`}
      >
        {/* The inner column keeps its width while the wrapper animates to 0, so the contents slide
            out cleanly instead of reflowing into a sliver mid-transition. */}
        <div className={`flex h-dvh w-[min(440px,100vw)] flex-col lg:py-2 lg:pr-2 ${width}`}>
          <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0A1517] text-[#ECF3F2] shadow-2xl lg:rounded-[18px] lg:border lg:border-white/[0.07] lg:shadow-[0_18px_50px_rgba(6,24,26,0.35)]">
            <header className="relative z-[3] flex shrink-0 items-center gap-0.5 border-b border-white/[0.06] py-2.5 pl-[18px] pr-2.5">
              <div ref={historyRef} className="relative -ml-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setHistoryOpen((v) => !v)}
                  aria-expanded={historyOpen}
                  aria-controls="bmai-history"
                  className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-[10px] px-2 text-[15px] font-semibold text-white transition-colors hover:bg-white/[0.06]"
                >
                  <span className="truncate">{title}</span>
                  <IconChevron width={14} height={14} className="shrink-0 text-[#8FA5A3]" />
                </button>
                {historyOpen && (
                  <div
                    id="bmai-history"
                    className="absolute left-0 top-full z-10 mt-1.5 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-white/10 bg-[#0F1D20] shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
                  >
                    <p className="px-3.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#7E9593]">
                      Earlier in this visit
                    </p>
                    {a.history.length === 0 ? (
                      <p className="px-3.5 pb-3 text-[12.5px] leading-relaxed text-[#A9BDBB]">
                        Nothing yet. Conversations are kept here until you reload the page, and are
                        never saved.
                      </p>
                    ) : (
                      <ul className="pb-1.5">
                        {a.history.map((c) => (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => {
                                a.resumeConversation(c.id);
                                setHistoryOpen(false);
                              }}
                              className="block w-full truncate px-3.5 py-2 text-left text-[13px] text-[#DCE7E5] transition-colors hover:bg-white/[0.06] hover:text-white"
                            >
                              {c.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <span className="ml-auto" />
              <IconButton label="New conversation" onClick={() => a.newConversation()}>
                <IconPlus width={17} height={17} />
              </IconButton>
              <IconButton
                label="History"
                onClick={() => setHistoryOpen((v) => !v)}
                expanded={historyOpen}
              >
                <HistoryIcon />
              </IconButton>
              <IconButton
                label={expanded ? 'Narrow the panel' : 'Widen the panel'}
                onClick={() => setExpanded((v) => !v)}
                className="hidden xl:grid"
              >
                <ExpandIcon expanded={expanded} />
              </IconButton>
              <IconButton label="Close Belle Mare AI" onClick={() => close()}>
                <IconX width={18} height={18} />
              </IconButton>
            </header>

            <div
              ref={bodyRef}
              data-pointer="off"
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              className="relative flex min-h-0 flex-1 flex-col"
            >
              <div aria-hidden="true" className="bmai-dots pointer-events-none absolute inset-0" />
              <div
                aria-hidden="true"
                className="bmai-glow-dots pointer-events-none absolute inset-0"
              />
              <div
                aria-hidden="true"
                className="bmai-glow-wash pointer-events-none absolute inset-0"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-[#0A1517] to-transparent"
              />

              <div
                ref={scrollRef}
                className="slim-bar-dark relative z-[1] flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3.5"
              >
                <div className="flex items-center gap-2.5 rounded-[14px] border border-white/[0.07] bg-[#0E1B1E] py-2 pl-3.5 pr-2">
                  <span
                    aria-hidden="true"
                    className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                      sees ? 'bg-[#3FB5AC] shadow-[0_0_0_3px_rgba(63,181,172,0.18)]' : 'bg-white/25'
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[#C8D8D6]">
                    {sees ? (
                      <>
                        Sees <span className="font-semibold text-white">{label}</span>
                      </>
                    ) : (
                      'Doesn’t see this screen'
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => a.setSeesScreen(!sees)}
                    title={
                      sees
                        ? 'Stop telling Belle Mare AI what is on this screen'
                        : 'Let Belle Mare AI see this screen again'
                    }
                    className="bmai-chip min-h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-medium"
                  >
                    {sees ? 'Hide' : 'Show'}
                  </button>
                </div>

                {thread.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-6 py-5">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <div ref={orbRef}>
                        <AiOrb />
                      </div>
                      <div>
                        <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-white">
                          {greeting(firstName, now)}
                        </h2>
                        <p className="mt-0.5 text-[13px] text-[#8FA5A3]">
                          {live
                            ? 'Here’s what needs you right now.'
                            : loading
                              ? 'Looking at what needs you…'
                              : 'Ask about prices, departures, transfers or a booking.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex w-full max-w-[330px] flex-col gap-2">
                      {suggestions.map((s, i) => {
                        const Icon = SUGGESTION_ICON[s.icon];
                        return (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => choose(s)}
                            style={{ animationDelay: `${i * 60}ms` }}
                            className="bmai-sug ai-suggestion flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-[#0E1A1C] px-3 py-2.5 text-left"
                          >
                            <span
                              aria-hidden="true"
                              className="bmai-sug-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#131F22] text-[#8FA5A3] transition-colors"
                            >
                              <Icon width={15} height={15} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-white">
                                {s.title}
                              </span>
                              <span className="block truncate text-[12px] text-[#8FA5A3]">
                                {s.sub}
                              </span>
                            </span>
                            {'urgent' in s && s.urgent && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F4B860]"
                                aria-label="Needs you"
                                role="img"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {data.failed.length > 0 && (
                      <p className="text-center text-[12px] text-[#FF9C8A]">
                        Couldn’t load the {data.failed.join(' and ')} just now.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 px-0.5 pb-2 pt-[18px]">
                    {thread.map((m, index) =>
                      m.role === 'user' ? (
                        <div
                          key={m.id ?? index}
                          className="ai-msg-in max-w-[82%] self-end whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border border-[rgba(63,181,172,0.25)] bg-[#16312F] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white"
                        >
                          {m.content}
                        </div>
                      ) : (
                        <div key={m.id ?? index} className="ai-msg-in flex gap-2.5">
                          <OrbAvatar />
                          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-[4px_16px_16px_16px] border border-white/[0.07] bg-[#0C181A] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
                            {m.steps && m.steps.length > 0 && (
                              <ul aria-label="What it looked at" className="flex flex-wrap gap-1.5">
                                {m.steps.map((s) => (
                                  <li
                                    key={s}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] px-2.5 py-[3px] text-[12px] text-[#A9BDBB]"
                                  >
                                    <StepCheck />
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p
                              className={`whitespace-pre-wrap break-words text-[13.5px] leading-relaxed ${
                                m.error ? 'text-[#FF9C8A]' : 'text-[#DCE7E5]'
                              }`}
                            >
                              {m.content}
                            </p>
                            {m.card?.kind === 'balances' && (
                              <BalancesCard
                                rows={m.card.rows}
                                showMoney={viewer.showMoney}
                                sent={m.card.sent}
                                onSent={(rowId, outcome) => {
                                  const itemId = m.id;
                                  if (!itemId) return;
                                  a.updateItem(itemId, (item) =>
                                    item.card?.kind === 'balances'
                                      ? {
                                          ...item,
                                          card: {
                                            ...item.card,
                                            sent: { ...item.card.sent, [rowId]: outcome },
                                          },
                                        }
                                      : item,
                                  );
                                }}
                                onOpen={go}
                              />
                            )}
                            {m.card?.kind === 'departures' && (
                              <DeparturesCard rows={m.card.rows} onOpen={go} />
                            )}
                            {m.actions?.map((action, i) => (
                              <ActionCard key={i} action={action} />
                            ))}
                            {m.card?.kind === 'balances' && m.card.later.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => showLater(m.card)}
                                  disabled={busy}
                                  className="bmai-chip min-h-8 rounded-full px-3 text-[12px] font-medium text-[#A9BDBB]"
                                >
                                  Show the {plural(m.card.later.length, 'trip')} still to come
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ),
                    )}
                    {busy && (
                      <div className="flex items-center gap-2.5">
                        <OrbAvatar size={22} />
                        <p aria-live="polite" className="bmai-sheen text-[13px] font-semibold">
                          {THINKING_STEPS[step]}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
                className="relative z-[2] shrink-0 px-3.5 pb-3.5 pt-2.5"
              >
                {popup && (
                  <div
                    id="bmai-popup"
                    role="listbox"
                    aria-label={popup === 'slash' ? 'Actions' : 'Bookings'}
                    className="absolute inset-x-3.5 bottom-full mb-1 overflow-hidden rounded-xl border border-white/10 bg-[#0F1D20] py-1 shadow-[0_-12px_32px_rgba(0,0,0,0.4)]"
                  >
                    {popup === 'slash' &&
                      slashMatches.map((c, i) => (
                        <button
                          key={c.key}
                          id={`bmai-opt-${i}`}
                          type="button"
                          role="option"
                          aria-selected={i === Math.min(pick, popupCount - 1)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choosePopup(i)}
                          className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-[13px] ${
                            i === Math.min(pick, popupCount - 1)
                              ? 'bg-white/[0.07] text-white'
                              : 'text-[#DCE7E5]'
                          }`}
                        >
                          <span className="flex-1">{c.label}</span>
                          <span className="text-[12px] text-[#7E9593]">{c.hint}</span>
                        </button>
                      ))}
                    {popup === 'mention' &&
                      (data.bookings === null ? (
                        <p className="px-3.5 py-2 text-[12.5px] text-[#8FA5A3]">
                          {loading ? 'Loading bookings…' : 'Bookings could not be loaded.'}
                        </p>
                      ) : mentionMatches.length === 0 ? (
                        <p className="px-3.5 py-2 text-[12.5px] text-[#8FA5A3]">
                          No booking matches. Type a reference or a guest’s name.
                        </p>
                      ) : (
                        mentionMatches.map((b, i) => (
                          <button
                            key={b.id}
                            id={`bmai-opt-${i}`}
                            type="button"
                            role="option"
                            aria-selected={i === Math.min(pick, popupCount - 1)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => choosePopup(i)}
                            className={`flex w-full items-center gap-3 px-3.5 py-2 text-left ${
                              i === Math.min(pick, popupCount - 1) ? 'bg-white/[0.07]' : ''
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-white">
                                {b.customerName || 'Guest'}
                              </span>
                              <span className="block truncate text-[12px] text-[#8FA5A3]">
                                {b.ref}
                                {b.startsAt ? ` · ${shortDay(mauDay(new Date(b.startsAt)))}` : ''}
                              </span>
                            </span>
                          </button>
                        ))
                      ))}
                  </div>
                )}
                <div className="rounded-2xl border border-white/[0.09] bg-[#111D20] pb-2 pl-3.5 pr-2.5 pt-3 transition-colors focus-within:border-[rgba(244,184,96,0.45)]">
                  <label htmlFor="bmai-input" className="sr-only">
                    Message Belle Mare AI
                  </label>
                  <textarea
                    id="bmai-input"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setCaret(e.target.selectionStart ?? e.target.value.length);
                      setPopupDismissed(false);
                      setPick(0);
                    }}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                    onKeyDown={onInputKeyDown}
                    rows={1}
                    placeholder={placeholder}
                    disabled={busy}
                    aria-controls={popup ? 'bmai-popup' : undefined}
                    aria-activedescendant={activeId}
                    aria-autocomplete="list"
                    // The height is driven by the effect above; the cap here matches its 168px so the
                    // box scrolls internally past ~7 lines instead of eating the thread.
                    className="slim-bar-dark max-h-[168px] min-h-[24px] w-full resize-none bg-transparent text-[14px] leading-relaxed text-white outline-none placeholder:text-[#6F8684] disabled:opacity-60"
                  />
                  <div className="mt-1.5 flex items-center gap-1">
                    {canDo && (
                      <div
                        role="group"
                        aria-label="Mode"
                        className="inline-flex rounded-full border border-white/10 p-[3px]"
                      >
                        {(['ask', 'do'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={mode === m}
                            onClick={() => {
                              a.setMode(m);
                              if (m === 'ask') setPlaceholder(PLACEHOLDER);
                            }}
                            className={`min-h-7 rounded-full px-3 text-[12px] font-semibold transition-colors ${
                              mode === m
                                ? 'bg-white/10 text-white'
                                : 'text-[#8FA5A3] hover:text-white'
                            }`}
                          >
                            {m === 'ask' ? 'Ask' : 'Do'}
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="ml-auto" />
                    {viewer.showBookings && (
                      <button
                        type="button"
                        onClick={insertAt}
                        aria-label="Mention a booking"
                        title="Mention a booking"
                        className="bmai-icon-btn grid h-11 w-11 place-items-center rounded-[9px] text-[16px] font-semibold sm:h-[34px] sm:w-[34px]"
                      >
                        @
                      </button>
                    )}
                    {/* 44×44 on touch, tightened to 34 from sm where a mouse is doing the aiming. */}
                    <button
                      type="submit"
                      aria-label="Send"
                      disabled={busy || input.trim() === ''}
                      className="bmai-send-btn grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-40 sm:h-[34px] sm:w-[34px]"
                    >
                      <ArrowUp />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-center text-[11px] leading-snug text-[#7E9593]">
                  {mode === 'do' && canDo ? HINT_DO : HINT_ASK}
                </p>
              </form>
            </div>
          </section>
        </div>
      </aside>
    </>
  );
}
