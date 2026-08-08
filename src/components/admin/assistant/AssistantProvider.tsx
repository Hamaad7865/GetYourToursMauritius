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
import type { AssistantPageContext } from '@/lib/validation/admin-assistant';

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

export interface AssistantThreadItem {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  /** Proposals attached to an assistant turn, rendered as action cards. */
  actions?: import('@/lib/validation/admin-assistant').AssistantAction[];
}

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
  /** Open the panel and put a question in it — used by the "Ask Gemini" affordances. */
  ask: (prompt?: string) => void;
  /** A prompt handed to the panel to send once it mounts; the panel clears it. */
  pendingPrompt: string | null;
  clearPendingPrompt: () => void;
}

const Ctx = createContext<AssistantState | null>(null);

/** The human name of an admin route, for the assistant's own orientation. */
function screenName(path: string): string {
  const known: Array<[string, string]> = [
    ['/admin/quotes', 'Quotes'],
    ['/admin/bookings', 'Bookings'],
    ['/admin/activities', 'Tours'],
    ['/admin/calendar', 'Calendar'],
    ['/admin/leads', 'Leads'],
    ['/admin/reviews', 'Reviews'],
    ['/admin/reports', 'Reports'],
    ['/admin/vehicle-pricing', 'Vehicle pricing'],
    ['/admin/rental', 'Rental fleet'],
    ['/admin/categories', 'Categories'],
    ['/admin/blog', 'Blog'],
    ['/admin/seo', 'SEO'],
  ];
  for (const [prefix, label] of known) if (path.startsWith(prefix)) return label;
  return path === '/admin' ? 'Dashboard' : 'Back office';
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<AssistantThreadItem[]>([]);
  const [detail, setDetail] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

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
    }),
    [open, toggle, thread, page, registerDetail, ask, pendingPrompt, clearPendingPrompt],
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
