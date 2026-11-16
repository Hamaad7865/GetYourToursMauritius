'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type {
  AssistantAction,
  AssistantMode,
  AssistantPageContext,
} from '@/lib/validation/admin-assistant';
import type { BalanceRow, ChatOpenTarget } from '@/components/admin/assistant/rules';
import type { RunRow } from '@/components/admin/today/rules';
import type { QuoteRow } from '@/lib/admin/quotes';

/**
 * The assistant's state, hoisted to the admin shell so ONE conversation follows the operator across
 * every back-office screen. Two things live here and nowhere else:
 *
 *  - **open/closed**, because the shell lays the panel out beside the content rather than over it
 *    (the main column has to know);
 *  - **the thread**, so walking from Quotes to Tours mid-question does not lose the conversation.
 *
 * PAGE CONTEXT is assembled from two sources: the route (always known, from `usePathname`) and an
 * optional richer line a screen registers with {@link useAssistantContext} — the open quote, the
 * tour being edited. A screen that registers nothing still gets a route-aware assistant.
 */

/**
 * What a send in the balances card came to. Kept on the thread item, not in the card, so a card that
 * mounts again (a conversation brought back from History) still shows who was already emailed and
 * does not offer to email them twice.
 */
export type BalanceOutcome =
  | { status: 'done'; text: string }
  | { status: 'link'; quote: QuoteRow; url: string; emailed: boolean | undefined };

/** A card the panel worked out itself from the back office's own data (no model involved). */
export type AssistantCard =
  | {
      kind: 'balances';
      rows: BalanceRow[];
      later: BalanceRow[];
      /** By booking id. */
      sent?: Record<string, BalanceOutcome>;
    }
  | { kind: 'departures'; rows: RunRow[] };

/**
 * Something the chat asks another screen to open: a booking's panel, a quote's panel, a day on the
 * calendar. It rides CONTEXT for the same reason the quote hand-off does: those screens read the
 * address once, on mount, so a link to the screen you are already on would change the address and
 * open nothing.
 */
export type OpenTarget = ChatOpenTarget;
export type OpenRequest = OpenTarget & { at: number };

/** A request not taken within this long is dropped (its screen never opened, e.g. no access). */
const OPEN_REQUEST_TTL_MS = 15_000;

export interface AssistantThreadItem {
  /** Stable across re-renders and conversations, for React keys and for updating a card. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  /** Proposals attached to an assistant turn, rendered as action cards. */
  actions?: AssistantAction[];
  /** What the assistant looked at for this answer ("Checked 14 balances"), shown as chips. */
  steps?: string[];
  card?: AssistantCard;
  /**
   * What the model is told about this turn when the conversation goes on, in place of `content`:
   * a card's answer names the guests, so "write Steven a message" still knows who Steven is.
   */
  context?: string;
}

/** A finished conversation, kept for this visit only (never stored: it can hold guests' names). */
export interface AssistantConversation {
  id: number;
  title: string;
  thread: AssistantThreadItem[];
}

/** Conversations kept in the title menu. */
const HISTORY_CAP = 8;

interface AssistantState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  thread: AssistantThreadItem[];
  setThread: React.Dispatch<React.SetStateAction<AssistantThreadItem[]>>;
  /** The page context sent with the next turn. */
  page: AssistantPageContext;
  /** Screens call this (via the hook) to describe what is on them. */
  registerDetail: (detail: string | null) => void;
  /** Open the panel and put a question in it — used by the "Ask Belle Mare AI" affordances. */
  ask: (prompt?: string) => void;
  /** A prompt handed to the panel to send once it mounts; the panel clears it. */
  pendingPrompt: string | null;
  clearPendingPrompt: () => void;
  /**
   * An enquiry handed from the assistant to the quotes screen ("turn this email into a quote").
   *
   * It travels through CONTEXT rather than the URL or sessionStorage, and that is the fix for a real
   * bug: the hand-off used to be a `?assistant=draft` flag read by a mount-effect, so applying while
   * ALREADY on /admin/quotes did nothing at all — the route did not change, the screen never
   * remounted, and the effect never re-fired. A context value is a state change, so every consumer
   * re-renders whether or not a navigation happened. It also keeps a customer's email out of the URL
   * (history, logs, GTM `page_location`).
   */
  quoteHandoff: string | null;
  handOffQuoteEmail: (email: string) => void;
  clearQuoteHandoff: () => void;
  /** Ask = answers only; Do = may also draft quotes and tour changes (each still needs Apply). */
  mode: AssistantMode;
  setMode: (mode: AssistantMode) => void;
  /** Whether the current screen is described to the model. Off sends no screen at all. */
  seesScreen: boolean;
  setSeesScreen: (sees: boolean) => void;
  /** Earlier conversations of this visit, newest first. */
  history: AssistantConversation[];
  /** Put the current conversation in the history and start an empty one. */
  newConversation: () => void;
  /** Bring back an earlier conversation; the current one goes into the history in its place. */
  resumeConversation: (id: number) => void;
  /** Change one thread item, wherever it is now (the open conversation or one in the history). */
  updateItem: (id: string, change: (item: AssistantThreadItem) => AssistantThreadItem) => void;
  /** The open request for another screen, if any. Screens take it with `takeOpenRequest`. */
  openRequest: OpenRequest | null;
  /**
   * Ask a screen to open something, and close the chat: the booking and quote panels are modal and
   * the calendar's narrow day sheet is an overlay, so the chat column would sit over their right
   * edge. The conversation stays; the launcher brings it back.
   */
  requestOpen: (target: OpenTarget) => void;
  /** The request, if it is for this kind and still fresh, cleared as it is taken. */
  takeOpenRequest: <K extends OpenTarget['kind']>(
    kind: K,
  ) => Extract<OpenRequest, { kind: K }> | null;
}

const Ctx = createContext<AssistantState | null>(null);

/** A conversation's name in the title menu: its first question, shortened. */
export function conversationTitle(thread: readonly AssistantThreadItem[]): string {
  const first = thread.find((m) => m.role === 'user')?.content.trim() ?? '';
  if (!first) return 'New conversation';
  const line = first.split('\n')[0]!.replace(/\s+/g, ' ');
  return line.length > 42 ? `${line.slice(0, 41).trimEnd()}…` : line;
}

/** The human name of an admin route, for the assistant's own orientation. */
export function screenName(path: string): string {
  const known: Array<[string, string]> = [
    ['/admin/quotes', 'Quotes'],
    ['/admin/bookings', 'Bookings'],
    ['/admin/activities', 'Tours'],
    ['/admin/calendar', 'Calendar'],
    ['/admin/leads', 'Enquiries'],
    ['/admin/reviews', 'Reviews'],
    ['/admin/reports', 'Reports'],
    ['/admin/vehicle-pricing', 'Vehicle pricing'],
    ['/admin/rental', 'Rental fleet'],
    ['/admin/categories', 'Categories'],
    ['/admin/blog', 'Blog'],
    ['/admin/seo', 'SEO'],
  ];
  for (const [prefix, label] of known) if (path.startsWith(prefix)) return label;
  return path === '/admin' ? 'Today' : 'Back office';
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<AssistantThreadItem[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [quoteHandoff, setQuoteHandoff] = useState<string | null>(null);
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [seesScreen, setSeesScreen] = useState(true);
  const [history, setHistory] = useState<AssistantConversation[]>([]);
  const nextId = useRef(1);

  // A screen's detail describes THAT screen; leaving it must not carry stale context to the next.
  useEffect(() => {
    setDetail(null);
  }, [pathname]);

  const registerDetail = useCallback((next: string | null) => setDetail(next), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const ask = useCallback((prompt?: string) => {
    setOpen(true);
    if (prompt) setPendingPrompt(prompt);
  }, []);
  const clearPendingPrompt = useCallback(() => setPendingPrompt(null), []);
  const handOffQuoteEmail = useCallback((email: string) => setQuoteHandoff(email), []);
  const clearQuoteHandoff = useCallback(() => setQuoteHandoff(null), []);

  // The thread is read through a ref so these stay stable (the panel holds them in effects).
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const historyRef = useRef(history);
  historyRef.current = history;
  const shelve = useCallback((items: AssistantThreadItem[], rest: AssistantConversation[]) => {
    if (items.length === 0) return rest;
    const id = nextId.current++;
    return [{ id, title: conversationTitle(items), thread: items }, ...rest].slice(0, HISTORY_CAP);
  }, []);
  const newConversation = useCallback(() => {
    setHistory(shelve(threadRef.current, historyRef.current));
    setThread([]);
  }, [shelve]);
  const resumeConversation = useCallback(
    (id: number) => {
      const picked = historyRef.current.find((c) => c.id === id);
      if (!picked) return;
      const current = threadRef.current;
      // Computed once, outside a state updater: an updater may run twice and would shelve twice.
      const next = shelve(
        current,
        historyRef.current.filter((c) => c.id !== id),
      );
      setHistory(next);
      setThread(picked.thread);
    },
    [shelve],
  );
  const updateItem = useCallback(
    (id: string, change: (item: AssistantThreadItem) => AssistantThreadItem) => {
      const apply = (items: AssistantThreadItem[]) =>
        items.some((m) => m.id === id) ? items.map((m) => (m.id === id ? change(m) : m)) : items;
      setThread(apply);
      setHistory((h) =>
        h.some((c) => c.thread.some((m) => m.id === id))
          ? h.map((c) => ({ ...c, thread: apply(c.thread) }))
          : h,
      );
    },
    [],
  );

  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const openRequestRef = useRef(openRequest);
  openRequestRef.current = openRequest;
  const requestOpen = useCallback((target: OpenTarget) => {
    setOpen(false);
    setOpenRequest({ ...target, at: Date.now() });
  }, []);
  const takeOpenRequest = useCallback(
    <K extends OpenTarget['kind']>(kind: K): Extract<OpenRequest, { kind: K }> | null => {
      const req = openRequestRef.current;
      if (!req || req.kind !== kind) return null;
      openRequestRef.current = null;
      setOpenRequest(null);
      if (Date.now() - req.at > OPEN_REQUEST_TTL_MS) return null;
      return req as Extract<OpenRequest, { kind: K }>;
    },
    [],
  );

  const page = useMemo<AssistantPageContext>(
    () => ({ path: pathname, screen: screenName(pathname), detail }),
    [pathname, detail],
  );

  const value = useMemo<AssistantState>(
    () => ({
      open,
      setOpen,
      toggle,
      thread,
      setThread,
      page,
      registerDetail,
      ask,
      pendingPrompt,
      clearPendingPrompt,
      quoteHandoff,
      handOffQuoteEmail,
      clearQuoteHandoff,
      mode,
      setMode,
      seesScreen,
      setSeesScreen,
      history,
      newConversation,
      resumeConversation,
      updateItem,
      openRequest,
      requestOpen,
      takeOpenRequest,
    }),
    [
      open,
      toggle,
      thread,
      page,
      registerDetail,
      ask,
      pendingPrompt,
      clearPendingPrompt,
      quoteHandoff,
      handOffQuoteEmail,
      clearQuoteHandoff,
      mode,
      seesScreen,
      history,
      newConversation,
      resumeConversation,
      updateItem,
      openRequest,
      requestOpen,
      takeOpenRequest,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The assistant state. Returns null outside the provider so a component can be rendered in
 * isolation (and in tests) without the whole admin shell.
 */
export function useAssistant(): AssistantState | null {
  return useContext(Ctx);
}

/**
 * Describe what is on the current screen for the assistant. Pass null when there is nothing
 * particular in view. The string is context for the model, never instructions — see the system
 * prompt in admin-assistant.ts.
 */
export function useAssistantContext(detail: string | null): void {
  const ctx = useContext(Ctx);
  const register = ctx?.registerDetail;
  // Registering on every keystroke of an edited quote would re-render the shell; the ref keeps the
  // effect keyed on the VALUE, so it only fires when the description actually changes.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!register) return;
    if (last.current === detail) return;
    last.current = detail;
    register(detail);
  }, [detail, register]);
  useEffect(
    () => () => {
      // Unmounting the screen clears its description, so the next screen starts clean.
      last.current = null;
    },
    [],
  );
}
